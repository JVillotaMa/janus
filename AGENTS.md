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

Funciona el bucle mínimo: llamada real entrando por Asterisk, interpretada por
`engine.js` sobre el grafo de `flow.json`.

```
src/
  types.ts       tipos compartidos. Solo declaraciones, se importa con `import type`
  cancel.ts      cancelable + Hungup. El primitivo del que depende todo lo demas
  time.ts        callVars
  nodes.ts       NODES: say, gather, dial, hangup
  interpreter.ts run, nextNode
  server.ts      la API HTTP del flujo
  store.ts       persistencia de la traza (SQLite)
  calls.ts       script: imprime las ultimas llamadas
  main.ts        entrypoint: conecta ARI y ata las piezas
flow.json        el grafo, a mano
tests/           63 tests, deterministas, sin Asterisk   -> pnpm test
  fake-channel.js    dobles de canal, bridge y cliente ARI
  interpreter.test.js  bucle, aristas, horario, cancelacion
  nodes.test.js        say / gather / hangup, con timers simulados
  dial.test.js         originate, bridge, causas Q.931, handback
  time.test.js         zonas IANA, DST, weekday ISO
  store.test.js        guardado y lectura, con base en memoria
ui/              editor React Flow (Vite)   -> cd ui && npm run dev
janus-lab/etc    config de Asterisk (montada en el contenedor)
janus-lab/sounds sonidos core, montados en /var/lib/asterisk/sounds
```

Nodos implementados: `say`, `gather`, `dial`, `hangup`. Falta `branch`,
`ai_agent`, `http`, `answer`.

`dial` origina la pata saliente con `appArgs: DIALED`. El handler de
`StasisStart` la ignora por esa marca; sin ella trataria la pata saliente como
una llamada entrante nueva y arrancaria el flujo sobre el que contesta.

El enrutado por horario NO es un tipo de nodo: `callVars` siembra `hhmm`,
`weekday` y `date` en `ctx.vars` al entrar la llamada, y las aristas los
comparan con jsonlogic normal. La zona sale de `flow.timezone` (IANA, nunca un
offset) y se calcula una sola vez desde `ctx.startedAt`, no en cada nodo.

El motor sirve `GET/PUT http://localhost:3000/api/flow` con `node:http`.
ponytail: son dos rutas. Cuando haya que servir la UI compilada o pasen de
media docena, migrar a Express o Hono son diez lineas — hasta entonces no. Un PUT reescribe
`flow.json` y cambia el flujo en caliente: las llamadas en curso conservan el
que tenian al entrar (`flowAtStart`), las nuevas cogen el nuevo. Es el invariante
de versiones inmutables, gratis.

**Gestores de paquetes:** la raiz usa pnpm, `ui/` usa npm. No es descuido: pnpm
bloquea el script de build de esbuild y la UI no arranca. No los unifiques sin
resolver eso antes.

La traza se guarda en `janus.db` (SQLite via `better-sqlite3`) al terminar cada
llamada, con su `outcome`: `completed`, `hungup` o `error`. Se lee con
`pnpm calls`. Es un fichero, no hay servidor ni contenedor que mantener.

`better-sqlite3` trae binarios precompilados, asi que no hace falta compilador.
pnpm bloquea su script de instalacion; ya esta resuelto con
`pnpm approve-builds better-sqlite3`, que deja `ignoredBuiltDependencies` en
package.json. Si vuelve a saltar, ese es el comando (el nombre va como argumento,
si no es interactivo).

Se descarto `node:sqlite`: hace lo mismo sin dependencias, pero es experimental.

El grafo sigue siendo un fichero. El versionado del README todavia no existe, asi
que `calls` no guarda con que version entro la llamada.

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
  -v $PWD/janus-lab/etc:/etc/asterisk \
  -v $PWD/janus-lab/sounds:/var/lib/asterisk/sounds \
  andrius/asterisk
pnpm start              # y marcar 100 desde el softphone
```
