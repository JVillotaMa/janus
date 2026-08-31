# AGENTS.md

Instrucciones para agentes de código que trabajen en Janus.
El **qué** y el **por qué** están en `README.md`. Este fichero es el **cómo** y,
sobre todo, el **qué no**.

---

## Contexto mínimo

Janus interpreta un grafo de flujo de llamada y lo ejecuta sobre Asterisk vía
ARI. El grafo es un dato (JSON), no configuración compilada. Asterisk es un
motor de medios tonto; toda la lógica vive en el motor, en código normal.

Lee `README.md` antes de tocar nada. No dupliques su contenido aquí.

---

## Git: no es tuyo

**Los commits y los push los hace SIEMPRE el dueño del repo.** Nunca ejecutes
`git commit` ni `git push`, ni siquiera al terminar un cambio que funciona y
tiene sus tests en verde. Deja el arbol sucio y di que esta listo para revisar.

`git add`, `git status`, `git diff` y `git log` si, son de lectura o preparan.

---

## Invariantes

No negociables. Si un cambio los rompe, el cambio está mal:

1. **El dialplan son tres líneas.** Todo va a `Stasis()`. Si te ves añadiendo
   lógica a `extensions.conf` — condicionales, Gosub, macros, AEL — has tomado
   el camino equivocado. Esa lógica va en el motor.
2. **El grafo se interpreta, nunca se compila.** Nada de codegen, nada de
   generar dialplan ni JS desde el grafo. Un bucle que lee el nodo actual,
   lo ejecuta y sigue la arista.
3. **El estado vive en el motor y en la BBDD, nunca en Asterisk.** No guardes
   estado de flujo en variables de canal. Asterisk tiene que ser desechable.
4. **Las versiones de flujo son inmutables.** Publicar crea versión nueva. Cada
   llamada se ancla a la versión con la que entró y la conserva hasta colgar.
5. **Las condiciones son jsonlogic.** No inventes un DSL. No añadas un parser.
6. **Toda transición de nodo se escribe en `call_steps`.** La traza no es un
   extra de debug, es una feature de producto. Nada de rutas silenciosas.

---

## Trampas de este dominio

Aquí es donde un agente se equivoca con toda la confianza del mundo:

- **`chan_sip` y `sip.conf` están MUERTOS** (eliminados en Asterisk 21). Usa
  `chan_pjsip` y `pjsip.conf`. Gran parte del material de entrenamiento sobre
  Asterisk es anterior a 2020 y te va a llevar ahí. No lo sigas.
- **`app_queue` no está expuesto en ARI.** Las colas de Asterisk se gestionan
  por AMI. Por ahora no se usan colas: `dial` a varios endpoints con timeout.
- **AGI y AMI no son la respuesta.** AGI es síncrono y un proceso por llamada.
  AMI es gestión, no control de llamada. Este proyecto es ARI.
- **`DEVICE_STATE()` y `QUEUE_MEMBER()` son funciones de dialplan, no de ARI.**
  El equivalente en ARI es `GET /endpoints/{tech}/{resource}`: mira `state` y
  si `channel_ids` viene vacío.
- **El cuelgue llega en cualquier momento.** Todo nodo que espera algo (DTMF,
  respuesta de dial, HTTP) tiene que ser **cancelable**. Si llega `StasisEnd` o
  `ChannelHangupRequest` mientras hay un `await` pendiente, ese await se cancela
  y el bucle termina. En el código eso significa: **toda espera pasa por
  `cancelable(signal, subscribe)`**. Un `await` crudo dentro de un nodo es el bug. Sin esto se acumulan llamadas zombi y el síntoma sale tres
  semanas después, no en tu softphone. **Es el bug número uno del proyecto.**
- **Un nodo `dial` no es terminal.** Se deshace el bridge y el bucle continúa.
  Ese handback es la razón de ser del proyecto; si lo tratas como final, has
  reimplementado `Dial()`.

---

## Alcance: qué NO construir

Nada de esto se añade sin que lo pida explícitamente el dueño del repo:

| No construyas | Por qué |
|---|---|
| Tipos de nodo nuevos | Son ocho (ver `README.md`). Se amplía cuando falte uno de verdad, no por si acaso. |
| Multi-tenancy | Una caja, un tenant. La columna `tenant_id` existe y con eso basta de momento. |
| Kamailio, clustering, HA | Una caja aguanta 300-1000 concurrentes. No es el problema. |
| Un editor de grafos propio | Es React Flow. |
| Un DSL de condiciones | Es jsonlogic. |
| Tablas de nodos y aristas | El grafo entero va en una columna JSONB. Siempre se lee completo. |
| Capa de abstracción sobre ARI | `ari-client` ya es esa capa. No la envuelvas otra vez. |
| Colas, IVR anidados, grabación | Después. Primero el bucle. |

Regla general: **el diff más corto que funciona.** Si dudas entre dos opciones y
las dos valen, coge la que menos código añade. Si algo se puede resolver con la
stdlib o con una dependencia ya instalada, no metas una nueva.

Marca las simplificaciones deliberadas con un comentario `ponytail:` que diga
cuál es el techo y cuál la salida:

```js
// ponytail: primera arista que casa; aristas ordenadas. Si hace falta prioridad
// explícita, añadir campo `priority` y ordenar antes de evaluar.
```

---

## Convenciones

Todavía no hay código. Cuando lo haya:

- **Identificadores en inglés, comentarios y textos en español.**
- Docstrings en **JSDoc** (`/** */`) en todo lo exportado: resumen en una
  frase, luego `@param` / `@return` / `@throws`. Dentro del cuerpo, código
  claro en vez de comentarios; los únicos comentarios sueltos son `ponytail:`.
- Un fichero por familia de responsabilidad, no por clase. Pocos ficheros.
- Las implementaciones de nodo son funciones con la misma firma:
  `(channel, config, ctx) -> Promise<vars|void>`. Añadir un nodo = añadir una
  función y una entrada en el registro. Nada de clases ni de interfaces con una sola
  implementación.
- Sin abstracciones especulativas: nada de factories, ni de config para valores
  que nunca cambian, ni de interfaces con un solo implementador.
- Errores: los de un nodo se propagan al bucle, que los escribe en la traza y
  toma la arista de error si existe. No los tragues.

---

## Definición de hecho

Todo cambio con lógica no trivial (una rama, un bucle, un parser, el bucle del
intérprete, el plumbing de cancelación) deja **una** comprobación ejecutable:
un `test_*` pequeño o un self-check con `assert`. Sin frameworks, sin fixtures,
sin una suite por función. Los one-liners triviales no necesitan test.

El intérprete y la cancelación por cuelgue **sí** llevan test siempre.

---

## Estado actual

Funciona el bucle completo: llamada real entrando por Asterisk, interpretada
sobre el grafo que vive en SQLite, con su traza guardada al colgar. Las troncales
se dan de alta desde la UI y el motor configura Asterisk solo.

```
src/
  types.ts       tipos compartidos. Solo declaraciones, se importa con `import type`
  cancel.ts      cancelable + Hungup. El primitivo del que depende todo lo demas
  time.ts        callVars
  nodes.ts       NODES: entry, say, gather, dial, hangup
  interpreter.ts run, nextNode
  validate.ts    comprobaciones del grafo antes de aceptarlo
  pjsip.ts       genera la config PJSIP de las troncales. Funcion pura
  asterisk.ts    escribe el fichero, recarga y pregunta por endpoints
  server.ts      la API HTTP
  store.ts       persistencia: flows, trunks y la traza (SQLite)
  calls.ts       script: imprime las ultimas llamadas
  main.ts        entrypoint: conecta ARI y ata las piezas
flow.json        SOLO la semilla de una base vacia. El grafo vive en la BBDD
tests/           137 tests, deterministas, sin Asterisk   -> pnpm test
  fake-channel.ts    dobles de canal, bridge y cliente ARI
  interpreter.test.ts  bucle, aristas, horario, cancelacion, nodo entry
  nodes.test.ts        say / gather / hangup, con timers simulados
  dial.test.ts         originate, bridge, causas Q.931, handback
  time.test.ts         zonas IANA, DST, weekday ISO
  store.test.ts        flows, trunks, llamadas y la migracion de una base vieja
  server.test.ts       la API sobre un puerto de verdad, sin Asterisk
  validate.test.ts     reglas del grafo y del nodo de entrada
  pjsip.test.ts        los dos modos de troncal, y el dialplan del repo
  asterisk.test.ts     escritura del fichero generado, sobre un tmpdir
ui/              editor React Flow (Vite)   -> cd ui && npm run dev
  App.jsx            el lienzo, el borrador y lo que se esta mirando
  Calls.jsx          las llamadas, cada una con su version
  Versions.jsx       las versiones publicadas: ver y cargar en el editor
asterisk-config/etc    config de Asterisk, versionada y montada en el contenedor
asterisk-config/sounds sonidos core, montados en /var/lib/asterisk/sounds
```

Nodos implementados: `entry`, `say`, `gather`, `dial`, `hangup`. Falta
`ai_agent`. `branch`, `http` y `answer` estan descartados a proposito.

`entry` es obligatorio y unico: es el arranque del grafo, no ejecuta nada (la
llamada la contesta el dialplan) y solo nombra la troncal por la que entra. Como
es mudo, se puede ramificar nada mas entrar sin reproducir nada antes. En la UI
tiene handle solo de salida, asi que no se le puede dibujar una arista de
entrada; `validate.ts` lo comprueba igual, porque la API no es solo la UI.

`dial` origina la pata saliente con `appArgs: DIALED`. El handler de
`StasisStart` la ignora por esa marca; sin ella trataria la pata saliente como
una llamada entrante nueva y arrancaria el flujo sobre el que contesta.

El enrutado por horario NO es un tipo de nodo: `callVars` siembra `hhmm`,
`weekday` y `date` en `ctx.vars` al entrar la llamada, y las aristas los
comparan con jsonlogic normal. La zona sale de `flow.timezone` (IANA, nunca un
offset) y se calcula una sola vez desde `ctx.startedAt`, no en cada nodo.

El motor sirve seis rutas con `node:http`, **solo en `127.0.0.1`**:

```
GET/PUT /api/flow           el grafo vivo. El PUT publica version nueva
GET     /api/flows          las versiones publicadas; con ?version=N, ese grafo
GET     /api/calls          las ultimas llamadas con su traza y su version
GET/PUT /api/trunks         las troncales. El PUT recarga Asterisk
GET     /api/trunks/config  la config generada, con las contrasenas tapadas
```

Seis es el techo que marca el comentario `ponytail:` de `server.ts`: la
siguiente ruta que haga falta se atiende migrando a Hono, no anadiendo otro
`if`.

No hay autenticacion y no la va a haber mientras el puerto no salga de la
maquina: se llega por tunel SSH, que autentica mejor que nada que escribieramos.
**No cambies el bind a `0.0.0.0`**: desde que hay contrasenas SIP en la base, ese
puerto es una maquina de recolectar credenciales. Filtrar por IP de origen no
vale — con un proxy delante todo llega de `127.0.0.1` y el filtro aprueba a todos.

Un PUT del flujo publica una version nueva y lo cambia en caliente: las llamadas
en curso conservan el que tenian al entrar (`flowAtStart`), las nuevas cogen el
nuevo. Es el invariante de versiones inmutables, gratis.

**Gestores de paquetes:** la raiz usa pnpm, `ui/` usa npm. No es descuido: pnpm
bloquea el script de build de esbuild y la UI no arranca. No los unifiques sin
resolver eso antes.

La traza se guarda en `janus.db` (SQLite via `better-sqlite3`) al terminar cada
llamada, con su `outcome`: `completed`, `hungup` o `error`. Se lee con
`pnpm calls`. Es un fichero, no hay servidor ni contenedor que mantener.

**No borres `janus.db` sin mirar antes si hay un motor corriendo** (`ss -ltn |
grep 3000`). SQLite mantiene abierto el inode aunque borres el fichero, asi que
el motor sigue escribiendo en algo que ya no existe y se pierden llamadas reales
sin ningun error. Son datos del dueno del repo, no material de pruebas.

`better-sqlite3` trae binarios precompilados, asi que no hace falta compilador.
pnpm bloquea su script de instalacion; ya esta resuelto con
`pnpm approve-builds better-sqlite3`, que deja `ignoredBuiltDependencies` en
package.json. Si vuelve a saltar, ese es el comando (el nombre va como argumento,
si no es interactivo).

Se descarto `node:sqlite`: hace lo mismo sin dependencias, pero es experimental.

El grafo vive en la tabla `flows`, append-only: publicar inserta, nunca
actualiza. `flow.json` solo siembra la version 1 de una base vacia.

**Cada llamada guarda con que version entro** (`calls.flow_version`), capturada
al entrar y no al guardarla: una llamada de diez minutos durante la cual se
publica dos veces se guarda con la que recorrio. Version y grafo viajan en el
mismo objeto (`FlowVersion`), asi que capturar uno captura los dos y no pueden
separarse. Las llamadas anteriores a esto tienen `NULL`, que es la verdad: no se
les inventa una version, porque pintar la traza sobre el grafo equivocado es
justo el fallo que esta columna quita.

Cual es la version en vivo no se guarda en ningun sitio: **es la mas alta**,
porque publicar es lo unico que la cambia e inserta al final. Por eso
`GET /api/flow` sigue devolviendo el grafo pelado. El dia que el motor pueda
quedarse fijado a una version que no sea la ultima, eso deja de valer.

Una base creada antes de esa columna se migra sola al abrirla, comprobando con
`PRAGMA table_info` antes del `ALTER TABLE`. **No lo cambies por un `try/catch`
alrededor del ALTER**: ese catch se traga tambien una base corrupta o sin
permisos y deja el motor escribiendo contra una tabla que no es la que cree.

En el editor, mirar una llamada o una version publicada **no toca el borrador**:
el lienzo dibuja uno u otro (`viewing`) y lo que estabas editando sigue en su
sitio. Mientras se mira, todo es de solo lectura — una version publicada es
inmutable, y dejar editarla acabaria publicando una mezcla. Volver a una version
anterior es cargarla en el editor y publicarla con el boton de siempre, que crea
version nueva; no hay ruta de "restaurar" ni republicado de un click.

## Troncales: el motor configura Asterisk

Se dan de alta desde la UI y acaban en la tabla `trunks`. De ahi el motor genera
**un solo fichero**, `asterisk-config/etc/pjsip_janus.conf`, y recarga con
`PUT /ari/asterisk/modules/res_pjsip.so` por el mismo cliente ARI que ya tiene
conectado. Nada de AMI ni de `asterisk -rx`.

Reglas que no conviene romper:

- **El resto de `asterisk-config/etc/` esta versionado y el motor no lo toca.**
  La linea `#include pjsip_janus.conf` de `pjsip.conf` y el contexto `[janus]` de
  `extensions.conf` son texto commiteado, no generado. Generar una constante en
  cada arranque no compra nada.
- **`pjsip_janus.conf` es el unico fichero fuera de git**, porque es el unico con
  contrasenas de proveedor. Es un derivado: se borra y vuelve al arrancar.
- **Las contrasenas no entran en el grafo.** El nodo `entry` solo guarda el
  nombre de la troncal. El grafo se sirve sin auth y sus versiones son
  inmutables: un secreto escrito ahi queda publicado y no se puede retirar.
- **La contrasena no vuelve en ningun GET.** Una troncal que llega en el PUT sin
  ese campo conserva la que tuviera guardada; asi la UI reenvia la lista que
  acaba de leer sin manejar secretos.
- Un endpoint borrado desaparece de `pjsip show endpoints` pero **sigue en el
  registro de ARI hasta que Asterisk reinicia**, respondiendo `offline` en vez de
  404. No molesta: solo se pregunta por troncales que estan en la base.

**TypeScript sin build.** Node 24 ejecuta `.ts` directamente por borrado de
tipos, asi que no hay `tsc` ni bundler en el bucle de desarrollo:

```bash
pnpm start       # node src/main.ts
pnpm test        # node --test, encuentra los .ts solo
pnpm typecheck   # tsc --noEmit
```

Consecuencias del borrado de tipos, y no son opcionales:

- Importar tipos SIEMPRE con `import type`. Un import normal de `types.ts`
  fallaria en runtime: ese modulo no exporta nada ejecutable.
- Las importaciones llevan extension `.ts` explicita.
- Nada de `enum`, `namespace` ni propiedades de parametro en el constructor:
  no son borrables. `erasableSyntaxOnly` en tsconfig lo caza al escribirlo.

Los tipos de ARI (`Channel`, `AriClient`, `Bridge`) son **estructurales** y
describen solo lo que el motor usa. Por eso los dobles de `tests/` encajan sin
heredar de nada ni castear.

Levantar el laboratorio:

```bash
docker run -d --rm --name asterisk --network host \
  -v $PWD/asterisk-config/etc:/etc/asterisk \
  -v $PWD/asterisk-config/sounds:/var/lib/asterisk/sounds \
  andrius/asterisk
pnpm start              # y marcar 100 desde el softphone
```
