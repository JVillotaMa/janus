## Context

Janus interpreta un grafo de llamada sobre Asterisk vía ARI. El motor controla las llamadas
pero no sabe por dónde entran: la configuración de endpoints vive en `pjsip.conf`, escrita a
mano, y el dialplan que entrega la llamada a Stasis está fijado a una extensión concreta.

Estado del que se parte:

- `pjsip.conf` tiene dos extensiones escritas a mano (`jaime`, `ana`), con `context=jaime`.
- `extensions.conf` tiene `exten => 100,1,Answer()` seguido de `Stasis(janus)` **sin
  `${EXTEN}`**, así que hoy el DID no llega al motor y `ctx.vars.did` es siempre `null`.
- El grafo vive en la tabla `flows` de `janus.db`, con versiones inmutables y append-only.
- La API (`node:http`, tres rutas) escucha en `0.0.0.0` sin autenticación.
- El motor arranca con `node src/main.ts` y ya tiene un cliente ARI conectado.

Restricciones que no se negocian, de `AGENTS.md`:

1. El dialplan son tres líneas, todo a `Stasis()`.
2. El grafo se interpreta, nunca se compila.
3. El estado de llamada vive en el motor y en la BBDD, nunca en Asterisk.
4. Las versiones de flujo son inmutables.
6. Toda transición de nodo se escribe en `call_steps`.

## Goals / Non-Goals

**Goals:**

- Que dar de alta una troncal SIP no exija abrir un fichero ni entrar por SSH.
- Que el usuario vea si lo que guardó llegó a Asterisk, sin salir de la UI.
- Que el grafo tenga un punto de entrada explícito y se pueda ramificar al entrar sin ejecutar
  nada antes.
- Que las credenciales SIP no acaben en el grafo, que se sirve sin autenticación y no se puede
  reescribir hacia atrás.

**Non-Goals:**

- Aprovisionar extensiones desde la UI. Siguen a mano.
- Enrutar por DID. Hay un flujo y atiende todo lo que entre.
- Autenticación en la API.
- Cifrar las contraseñas en reposo.
- PJSIP Realtime.
- Versionar las troncales.
- Alta disponibilidad, multi-caja o multi-tenant.

## Decisions

### 1. Generar ficheros de configuración y recargar, en vez de PJSIP Realtime

**Alternativas:** (a) PJSIP Realtime con sorcery + ODBC, que haría que Asterisk leyese los
endpoints de la base directamente; (b) generar ficheros y recargar.

Realtime es la respuesta correcta a escala y no tiene recargas. Pero exige `res_config_odbc`,
unixODBC y en la práctica MySQL o Postgres, cuando la decisión explícita del proyecto es que la
base sea un fichero SQLite sin servidor. El generador da casi todo el valor por una fracción del
coste, y la tabla `trunks` que se crea aquí es casi el esquema que Realtime necesitaría después:
migrar sería sustituir el generador por unas tablas, sin tocar el resto del motor.

### 2. El motor escribe exactamente un fichero, y es el único que no va a git

La configuración de Asterisk vive versionada en `asterisk-config/etc/`, incluida la línea
`#include pjsip_janus.conf` de `pjsip.conf`. Lo único que el motor escribe es
`pjsip_janus.conf`, que reescribe entero y nunca lee.

El criterio no es de propiedad —la misma persona administra Asterisk y contrata la troncal—
sino de **qué se puede commitear**: `pjsip_janus.conf` es el único fichero con contraseñas de
proveedor, así que es el único que se queda fuera del repositorio.

**Alternativa descartada:** que el motor sea dueño de `pjsip.conf` entero. Tendría que generar
también el transporte y los softphones, y entonces o las extensiones pasan a ser entidades de la
base —que está explícitamente fuera de alcance— o desaparecen en el primer guardado.

Consecuencia buscada: el fichero generado es **derivado**. Se puede borrar y vuelve al arrancar.
La fuente de verdad es siempre la tabla.

### 3. El dialplan no se genera: es constante y está versionado

`asterisk-config/etc/extensions.conf` contiene un único contexto que no depende del grafo ni de
las troncales:

```
[janus]
exten => _X.,1,Answer()
 same => n,Stasis(janus,${EXTEN})
 same => n,Hangup()
```

Todos los endpoints generados apuntan a él con `context=janus`. Lo que el proyecto rechazó fue
**generar dialplan desde el grafo** — lógica compilada que crece con cada nodo y hay que recargar
con llamadas vivas. Esto es lo contrario: una constante. El invariante de las tres líneas pasa de
depender de la disciplina a estar garantizado por construcción.

Ese `${EXTEN}` corrige de paso el hueco actual: sin él ninguna troncal podría distinguir DIDs el
día que haya más de un flujo.

Generarlo se llegó a plantear, y se descartó al versionar `asterisk-config/etc/`: generar una
constante en cada arranque es código que no compra nada. Commitearla se lee mejor y se borra
antes.

### 4. La recarga va por ARI, no por AMI ni por shell

`PUT /ari/asterisk/modules/res_pjsip`, disponible desde Asterisk 13. Mantiene el proyecto en un
solo protocolo — `AGENTS.md` es explícito en que AGI y AMI no son la respuesta — y reutiliza el
cliente que el motor ya tiene conectado.

**Alternativas:** AMI (otro protocolo y otra conexión que mantener) o `asterisk -rx` por shell
(exige compartir espacio de procesos o `docker exec`, más frágil que compartir un volumen).

Recargar `res_pjsip` no corta las llamadas en curso, a diferencia de un `reload` global.

### 5. La tabla `trunks` no se versiona

Las troncales son infraestructura, no flujo. El invariante de inmutabilidad protege el grafo
porque una llamada tiene que terminar con la versión con la que entró; una troncal no participa
de esa semántica. `UPDATE` normal.

### 6. Una ruta, la colección entera

`GET/PUT /api/trunks` con la lista completa, igual que `/api/flow`. Sin rutas por identificador
y sin `DELETE`: borrar es enviar una lista que no incluye esa troncal.

La contraseña es de solo escritura, con una convención explícita: **una troncal que llega sin el
campo conserva la que tuviera guardada**. Es lo que permite que la UI reenvíe la lista que acaba
de leer sin manejar secretos.

Deja `server.ts` en cuatro rutas. Su propio comentario `ponytail:` marca media docena como el
punto de migrar a Express o Hono; aguanta esta ronda.

**Trade-off aceptado:** dos pestañas abiertas se pisan, gana la última. No hay bloqueo optimista
y no merece la pena para un operador.

### 7. `listen(port, '127.0.0.1')` en vez de autenticación o filtro por IP

Desde este cambio hay contraseñas SIP detrás del puerto. El acceso remoto se hace por túnel SSH,
que aporta una autenticación mejor que cualquiera que se escribiese aquí.

**Descartado comprobar `req.socket.remoteAddress`**, que era la primera intuición: falla en tres
escenarios reales. Con un proxy delante (nginx, Caddy) todas las peticiones llegan desde
`127.0.0.1` y el filtro aprueba a todo el mundo; con Docker publicando el puerto, el origen es la
gateway del bridge y o bloquea siempre o hay que abrir la subred entera; y es código con estados,
mientras que no abrir el socket no tiene bug posible.

Consecuencia: la UI se sirve desde el propio motor (mismo origen, sin CORS) o se abre por túnel.
Una UI alojada aparte obligaría a exponer la API y por tanto a escribir autenticación.

### 8. `entry` es un no-op en el registro de nodos, no un caso especial del intérprete

El intérprete ejecuta `nodes[node.type]` sin excepciones. Añadir una rama para saltarse el nodo
de entrada sería más código y una asimetría en el bucle. Una función vacía en `NODES` cuesta una
línea y de regalo hace que `validate` acepte el tipo, porque saca los tipos válidos de
`Object.keys(NODES)`.

El nodo aparece en `call_steps` como primer paso, que es lo correcto: la traza empieza donde
empieza el flujo (invariante 6).

**Nombre:** `entry` y no `trunk_entry`. Los tipos de nodo quedan escritos para siempre en cada
versión publicada, y hoy la entrada real es un softphone registrado, no una troncal.

### 9. El nodo nombra la troncal; el secreto vive en la tabla

`config: { trunk: "<nombre>" }` y nada más. El grafo se sirve por `GET /api/flow` sin
autenticación y sus versiones son append-only: un secreto escrito ahí queda publicado y no hay
forma de retirarlo sin romper el invariante 4.

### 10. El generador es una función pura

`render(trunks) -> string`, separada de escribir en disco y de recargar. Se prueba con un
`assert` sin Asterisk, sin disco y sin dobles. Es la comprobación ejecutable de todo el
aprovisionamiento y el sitio donde un bug se manifestaría en producción como "la troncal no
registra y no sé por qué".

### 11. El estado del endpoint se consulta en cada lectura

`GET /api/trunks` pregunta a Asterisk por cada troncal en el momento. Sin caché ni sondeo de
fondo: son unas pocas troncales y el dato solo importa cuando alguien está mirando. Si Asterisk
no responde, las troncales se devuelven igual con el estado sin determinar — la UI tiene que
seguir funcionando con Asterisk apagado.

### 12. La UI: un `if` por tipo de nodo, no un generador de formularios

`entry` se dibuja como nodo con handle solo de salida, así que la regla "nadie apunta a la
entrada" la aplica React Flow por su cuenta. Un click lo selecciona y pinta el formulario en el
panel; un doble click abre el mismo componente en un modal, donde cabe el estado y la
configuración generada. El resto de nodos siguen con el editor de JSON.

**Descartado:** formularios generados desde un esquema. Es un tipo de nodo, no cinco; con un
segundo caso se replantea.

## Risks / Trade-offs

**[La recarga de módulos por ARI puede no estar disponible en la imagen]** → Es la dependencia
crítica de todo el aprovisionamiento y `ari-client` genera sus métodos descargando el Swagger de
Asterisk al conectar, así que no se puede verificar sin el laboratorio levantado. Se comprueba
**antes de escribir nada** con `curl -su janus:janus -X PUT
http://localhost:8088/ari/asterisk/modules/res_pjsip`. Si no responde, el plan B es AMI y el
diseño de la recarga cambia.

**[El motor y Asterisk quedan casados a la misma máquina]** → Comparten sistema de ficheros. Se
acepta: el laboratorio ya monta `janus-lab/etc` en el contenedor y el destino previsto es una
caja con los dos servicios. Cierra definitivamente la opción de alojar el motor separado de
Asterisk, que ya era inviable por el rango UDP del RTP.

**[Las contraseñas SIP quedan en claro en `janus.db` y en el fichero generado]** → Igual que hoy
están en claro en `pjsip.conf`; Asterisk necesita el secreto en claro para autenticarse. Se
mitiga con el bind a localhost, con que la contraseña no salga por ningún GET y con permisos
restrictivos en el fichero generado. Cifrarlas exigiría una clave que estaría en la misma
máquina, así que no añade seguridad real.

**[Un endpoint borrado sigue apareciendo en ARI]** → PJSIP lo retira de verdad —`pjsip show
endpoints` deja de listarlo— pero el registro de ARI conserva el nombre hasta que Asterisk
reinicia, y `GET /endpoints/PJSIP/{name}` sigue respondiendo `offline` en vez de 404. No afecta:
la UI solo pregunta por troncales que están en la base, así que un fantasma nunca se consulta.
El estado `unknown` queda reservado a endpoints que ARI no ha visto nunca.

**[Alguien edita a mano un fichero generado y su cambio desaparece]** → Cabecera visible de "no
editar, generado por Janus" y regeneración al arrancar, para que la pérdida ocurra pronto y de
forma evidente en vez de tres semanas después.

**[Una troncal se borra y el nodo `entry` sigue nombrándola]** → El grafo y las troncales se
editan por separado. Se resuelve con un aviso de validación, no un error: es un estado
intermedio legítimo mientras se reconfigura.

**[Recargar con llamadas en curso]** → `pjsip reload` no corta llamadas establecidas. El riesgo
real sería recargar el dialplan, y ese fichero es constante: se escribe una vez y no cambia.

## Migration Plan

**Fase 0 — verificar.** Levantar el laboratorio y comprobar la recarga de módulos por ARI. Sin
esto en verde no se empieza.

**Fase 1 — la base, sin tocar Asterisk.** Bind a localhost; tabla `trunks`; ruta `/api/trunks`;
el generador como función pura con su test. Todo se prueba con `pnpm test`.

**Fase 2 — el enganche.** Escritura de los ficheros generados, `#include` idempotente, recarga
por ARI y estado en vivo.

**Fase 3 — el grafo.** El tipo `entry`, las reglas de validación con su test, y la migración del
flujo publicado: se añade el nodo delante y se publica versión nueva. El `flow.json` semilla
también lo lleva, para que una base virgen arranque con un flujo válido. El nodo `say` de
bienvenida que hoy hace de entrada se conserva; lo que se mueve a las aristas del nodo mudo es la
ramificación por horario.

**Fase 4 — la UI.** Nodo con solo salida, doble click, formulario y alta de troncales.

**Rollback:** los ficheros generados se borran y se quita el `#include`; Asterisk vuelve a su
configuración anterior con una recarga. La tabla `trunks` puede quedarse, no la lee nadie más. El
flujo vuelve atrás publicando de nuevo la versión anterior, que sigue en la base intacta.

## Open Questions

Resueltas durante la implementación:

- **Codecs del endpoint generado** → `alaw` fijo, que es lo que usan las troncales españolas.
  Transcodificar es lo que desploma la concurrencia; si un proveedor pide otro, el arreglo es un
  campo `codec` por troncal y está marcado con un `ponytail:`.
- **`from_user`** → se emite en modo `register` cuando la troncal tiene usuario. Varios
  proveedores lo exigen para aceptar el registro y no cuesta nada.
- **Permisos del fichero generado** → `0600`. En la imagen `andrius/asterisk` el proceso corre
  como root, así que lo lee igual. Si algún día corre como usuario `asterisk`, hace falta un
  grupo compartido y pasa a `0640`.

Sigue abierta:

- **Qué hacer con `exten => 100`.** De momento `[jaime]` se queda como contexto aparte, con el
  `${EXTEN}` añadido para que `ctx.vars.did` deje de ser `null`. La alternativa es apuntar los
  endpoints `jaime` y `ana` a `context=janus` y borrar ese contexto: un solo camino, el mismo que
  recorren las llamadas de verdad, y `_X.` casa el 100 igual. Es un cambio en la config del
  laboratorio, no en el motor.
