## Why

La tabla `flows` es append-only desde el primer día: cada publicación inserta una versión nueva
y las anteriores quedan intactas. Pero nada de eso se puede ver ni usar. Solo se lee la última,
las llamadas no guardan con cuál entraron, y no hay forma de volver a una versión anterior que no
sea rehacer el grafo a mano.

Eso convierte la iluminación de la traza en una mentira silenciosa. El camino de una llamada se
guarda como una lista de ids de nodo y el editor la pinta sobre el grafo **actual**: en cuanto se
publica dos veces, las llamadas de ayer encienden nodos que ya no son esos, o no encienden nada, y
en ninguno de los dos casos avisa. Justo ahora que toca montar flujos de verdad y publicar a
menudo, la herramienta de diagnóstico empieza a mentir.

## What Changes

**El motor**

- `calls` gana la versión de flujo con la que entró la llamada. El motor ya captura el grafo al
  entrar (`flowAtStart`); pasa a llevar también su número.
- `store` sabe listar las versiones publicadas y devolver el grafo de una cualquiera. Hoy solo
  sabe publicar y leer la última.
- Migración por `ALTER TABLE`: `janus.db` tiene llamadas reales del dueño y no se recrea. Las
  llamadas ya guardadas se quedan sin versión, que es la verdad — no se inventa ninguna.

**La API**

- Ruta nueva `GET /api/flows`: la lista de versiones publicadas, y con `?version=N` el grafo de
  una concreta. Una sola ruta para las dos lecturas.
- `GET /api/calls` devuelve la versión de cada llamada, o `null` para las anteriores a este cambio.

**El editor**

- Banda izquierda con dos pestañas: **Llamadas** (lo que hay hoy) y **Versiones**.
- Pinchar una llamada lleva el lienzo a la versión con la que corrió y enciende el camino
  **sobre ese grafo**. Mientras se mira una versión el lienzo es de solo lectura: editar una
  versión publicada no significa nada, y dejar hacerlo acabaría publicando una mezcla.
- Apagar la llamada devuelve el borrador **tal cual estaba**, con las ediciones sin aplicar
  incluidas. Mirar el pasado no puede costar el trabajo en curso.
- Volver a una versión anterior es cargarla en el editor como borrador y publicarla con el botón
  de siempre, que crea versión nueva. Sin ruta de "restaurar" y sin republicar de un click: el
  invariante de inmutabilidad sale gratis y se ve lo que se va a publicar antes de publicarlo.
- Una llamada sin versión guardada se sigue pintando sobre el flujo actual, como hoy, diciendo
  que no se sabe sobre qué grafo corrió.

**Fuera de alcance** (deliberado, no olvidado)

- Diff entre dos versiones. Se ven de una en una.
- Nombrar o etiquetar versiones. Son el número y su fecha.
- Borrar o podar versiones antiguas. Un grafo son unos kilobytes.
- Versionar las troncales. Son infraestructura, no flujo, y eso ya se decidió.
- Enseñar en la lista de versiones cuántas llamadas atendió cada una.

## Capabilities

### New Capabilities

- `flow-versioning`: las versiones publicadas del grafo como algo navegable — listarlas, leer
  cualquiera de ellas, anclar cada llamada a la suya para que su traza se pinte sobre el grafo que
  de verdad recorrió, y volver a una anterior publicándola de nuevo.

### Modified Capabilities

Ninguna. `flow-entry-node` y `trunk-provisioning` no cambian de comportamiento.

## Impact

**Código**

| Fichero | Qué le pasa |
|---|---|
| `src/store.ts` | columna `flow_version` en `calls` con su migración; listar versiones y leer una por número |
| `src/main.ts` | el flujo vivo pasa a llevar su número, y la llamada lo guarda |
| `src/server.ts` | ruta `GET /api/flows`; `/api/calls` devuelve la versión |
| `ui/src/App.jsx` | el lienzo dibuja el borrador o una versión mirada; solo lectura mientras se mira |
| `ui/src/Calls.jsx` | pestañas, y la llamada lleva su versión |
| `ui/src/Versions.jsx` | nuevo: la lista de versiones, ver y cargar en el editor |
| `tests/store.test.ts` | migración, versión de la llamada, listar y leer por número |

**Datos**

`janus.db` se migra en caliente con `ALTER TABLE`. No hay pérdida: las llamadas viejas conservan
todo lo que tienen y su versión queda a `NULL`.

**API**

`GET /api/calls` gana un campo. Ninguna respuesta existente cambia de forma. `server.ts` pasa a
seis rutas, que es exactamente el techo que marca su propio comentario `ponytail:`: la siguiente
ruta que haga falta se atiende migrando a Hono, no añadiendo otro `if`.

**Dependencias**

Ninguna nueva.
