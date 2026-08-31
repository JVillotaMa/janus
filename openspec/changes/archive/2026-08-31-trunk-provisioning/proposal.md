## Why

Para que entre una llamada por una troncal SIP hoy hay que entrar por SSH, escribir a mano
las secciones de `pjsip.conf`, añadir un contexto en `extensions.conf` y recargar Asterisk.
Eso deja Janus fuera del alcance de cualquiera que no sea ingeniero de telefonía, que es
exactamente el problema que el proyecto existe para resolver. El motor ya controla las
llamadas por ARI, pero no sabe por dónde entran ni puede hacer nada para que entren.

Y el grafo no tiene punto de entrada: `flow.start` es un id suelto que puede señalar a
cualquier nodo, así que el nodo que ramifica al empezar tiene que ejecutar algo (hoy suena
un audio) solo para poder tener aristas.

## What Changes

**Aprovisionamiento**

- Tabla `trunks` en `janus.db`: nombre, host, modo (`register` o `identify`), usuario,
  contraseña y IP. Es la fuente de verdad de la configuración de entrada.
- Ruta `GET/PUT /api/trunks`: se lee y se escribe la lista entera, igual que el flujo.
  La contraseña es de solo escritura y no vuelve nunca en un GET.
- El motor genera `pjsip_janus.conf` y es su dueño exclusivo: lo reescribe entero y nunca
  lo parsea. El resto de la configuración de Asterisk pasa a estar versionada en
  `asterisk-config/etc/`, con la línea `#include` y el contexto de dialplan ya escritos. El
  fichero generado es el único que se queda fuera de git, porque es el único con
  contraseñas de proveedor.
- Tras cada cambio, el motor recarga Asterisk con `PUT /ari/asterisk/modules/res_pjsip`.
  Si la recarga falla, el PUT falla: nada de guardar en la base y que Asterisk se quede atrás.
- `GET /api/trunks` consulta `GET /endpoints/PJSIP/{name}` y devuelve el estado real de cada
  troncal, para que la UI confirme que lo que guardaste se aplicó.
- **BREAKING**: la API pasa a escuchar solo en `127.0.0.1`. Se llega por túnel SSH y la
  autenticación la hace SSH. Hoy escucha en `0.0.0.0` sin nada delante, y a partir de este
  cambio hay contraseñas SIP detrás de ese puerto.
- El dialplan deja de estar atado a una extensión concreta: un contexto de tres líneas al
  que apuntan todas las troncales, versionado y constante. No se genera, porque generar una
  constante no compra nada.

**El grafo**

- Tipo de nodo `entry`: obligatorio, único por flujo, sin comportamiento en runtime, y sin
  aristas de entrada. Contesta el dialplan, no el flujo, así que el nodo no ejecuta nada.
- `validate` gana tres reglas: existe exactamente un `entry`, `flow.start` apunta a él, y
  ninguna arista termina en él.
- **BREAKING**: un flujo sin nodo `entry` deja de validar. El flujo publicado hoy se migra
  publicando una versión nueva con el nodo delante — que es para lo que existe la tabla
  `flows`. El `flow.json` semilla también lo lleva.
- Como el `entry` es mudo, ramificar al entrar deja de exigir ejecutar algo antes.

**La UI**

- El nodo `entry` se dibuja con handle solo de salida, así que la regla de "nadie apunta a la
  entrada" la aplica el propio editor.
- Un click lo selecciona y muestra su formulario en la banda derecha; un doble click lo abre
  en un modal con sitio para el estado y la config generada. El resto de nodos siguen con su
  editor de JSON.
- El formulario da de alta troncales y enseña si Asterisk las reconoce.

**Fuera de alcance** (deliberado, no olvidado)

- Extensiones desde la UI: se siguen escribiendo a mano. Solo troncales.
- Enrutado por DID: hay un solo flujo y atiende todo lo que entre.
- Autenticación en la API: la sustituye el bind a localhost.
- Cifrado de las contraseñas en reposo: quien puede leer `janus.db` ya está dentro.
- PJSIP Realtime: el generador da casi todo su valor por una fracción del coste.
- Versionado de troncales: son infraestructura, no flujo.

## Capabilities

### New Capabilities

- `trunk-provisioning`: dar de alta, modificar y borrar troncales SIP desde la API, generar
  la configuración de Asterisk correspondiente, aplicarla sin intervención manual y reportar
  su estado real.
- `flow-entry-node`: el punto de entrada del grafo como nodo explícito — obligatorio, único,
  sin comportamiento y sin aristas entrantes — y las reglas de validación que lo sostienen.

### Modified Capabilities

Ninguna. `openspec/specs/` está vacío: no hay requisitos previos que cambien.

## Impact

**Código**

| Fichero | Qué le pasa |
|---|---|
| `src/store.ts` | tabla `trunks` y su lectura/escritura |
| `src/pjsip.ts` | nuevo: generar el texto de la config a partir de las troncales |
| `src/server.ts` | ruta `/api/trunks`; bind a `127.0.0.1` |
| `src/main.ts` | asegurar los `#include` al arrancar; recarga por ARI |
| `src/nodes.ts` | el tipo `entry` |
| `src/validate.ts` | las tres reglas del nodo de entrada |
| `flow.json` | la semilla gana el nodo `entry` |
| `ui/src/App.jsx` | nodo custom, doble click, formulario |
| `tests/` | generador, reglas de validación, tabla de troncales |

**Asterisk**

`janus-lab/` pasa a llamarse `asterisk-config/` y su `etc/` entra en el repositorio, así que
desaparece `etc.example/` y el paso de reconstruir la configuración desde la imagen. `pjsip.conf`
lleva ya la línea `#include pjsip_janus.conf` y `extensions.conf` el contexto `[janus]`. El único
fichero generado es `pjsip_janus.conf`, fuera de git y regenerable: se borra y vuelve.

**Dependencias**

Ninguna nueva. La recarga usa el cliente ARI que ya está conectado.

**Riesgo que hay que despejar antes de empezar**

Todo el aprovisionamiento depende de que ARI exponga la recarga de módulos
(`PUT /ari/asterisk/modules/{moduleName}`, disponible desde Asterisk 13). `ari-client` genera
sus métodos descargando el Swagger de Asterisk al conectar, así que no se puede comprobar sin
el laboratorio levantado. Si la imagen no lo expone, la recarga tendría que pasar por AMI y
eso cambia el diseño.

**Seguridad**

A partir de este cambio `janus.db` contiene contraseñas SIP. Una credencial de troncal
filtrada son miles de euros en una noche, así que el bind a `127.0.0.1` y que la contraseña
no salga por ningún GET no son detalles de implementación: son la condición para que esto
salga de una máquina de desarrollo.
