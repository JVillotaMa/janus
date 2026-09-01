## Why

El grafo se edita hoy con un `<textarea>` de JSON en la barra lateral. Eso pide al usuario que
sepa que un `gather` lleva `media` y `timeout`, que el timeout va en milisegundos pero el del
`dial` va en segundos, y que una condición se escribe en jsonlogic. Es la misma barrera que el
proyecto existe para quitar: se ha sacado la lógica del dialplan para acabar pidiendo que se
escriba a mano el AST de una expresión.

Y no hay red debajo. `validate.ts` comprueba el grafo —ids, aristas, tipos de nodo— pero **no
mira los configs**: un `say` sin `media` se publica tan tranquilo y revienta en una llamada real
con `outcome: error`. El único sitio donde está escrito qué campos tiene cada tipo de nodo es el
cuerpo de su implementación.

## What Changes

**El esquema: una sola verdad**

- `src/schema.ts` declara, por tipo de nodo: su etiqueta, sus campos (nombre, tipo, unidad,
  obligatoriedad y valor por defecto) y las variables que ese nodo deja en `ctx.vars` al salir.
  Y por variable: su tipo y sus valores cerrados, si los tiene.
- **BREAKING**: `validate.ts` pasa a comprobar los configs contra el esquema y a devolver
  **error**, no aviso. Un `say` sin `media` deja de publicarse. Comprobado contra las 15
  versiones publicadas de `janus.db`: **la comprobación nueva no rechaza ninguna**. Las dos
  primeras sí dan error, pero por el nodo `entry`, que es obligatorio desde `trunk-provisioning`
  y ellas son anteriores: ya no se podían republicar antes de este cambio.
- Los valores por defecto salen de `nodes.ts` (`?? 5000`, `?? 30`) y pasan a leerse del esquema,
  para que el formulario y el motor no puedan discrepar sobre cuál es el defecto.
- La UI importa `src/schema.ts` directamente. **Sin ruta nueva**: `server.ts` se queda en seis.

**El editor: se acabó el JSON**

- Crear un nodo abre un selector con los tipos disponibles; se pincha uno y se crea ya con sus
  valores por defecto. `entry` no está en el selector: tiene que haber exactamente uno y ya existe.
- La barra lateral pinta un input por campo, con su etiqueta y su unidad, en vez del textarea.
- El tipo de nodo se cambia con un selector. Se conservan los campos cuyo nombre coincide y la
  línea de estado dice cuáles se descartan. El nodo `entry` no se puede convertir.
- Las condiciones `when` se construyen como un **árbol**: un grupo tiene su unión —Y u O—, puede
  estar negado, y cuelgan de él cláusulas `variable · operador · valor` y otros grupos. Se pueden
  mezclar Y y O anidando, que es para lo que sirve el grupo.
- Las variables que se ofrecen dependen del nodo del que sale la arista —`digit` solo detrás de un
  `gather`, `dial` solo detrás de un `dial`— y las que tienen valores cerrados se eligen de un
  desplegable.
- Lo que sigue sin caber —un operador que el constructor no ofrece, una expresión jsonlogic que no
  es un árbol de comparaciones— se enseña en un textarea de **solo lectura**. Se ve, no se mutila.

**Los nodos tienen nombre, y el id deja de ser ese nombre**

- Un nodo gana `name`, un campo opcional que se escribe, se ve en el lienzo y se puede cambiar
  cuando quieras. El motor lo ignora, igual que ignora `position`.
- Los ids se generan aleatorios y neutros (`n-7f3a`) y no se editan. Hoy se generan como
  `nodo-${nodes.length + 1}`, que produce ids repetidos en cuanto borras un nodo y creas otro.
- El lienzo y la traza pasan a enseñar el nombre; sin nombre, el tipo y un resumen de su config.
  El id no se enseña en ningún sitio: es fontanería.
- **La traza se lee resolviendo cada paso contra el grafo de la versión con la que corrió esa
  llamada**, que es lo que `calls.flow_version` acaba de hacer posible. Así renombrar un nodo no
  reescribe el pasado: las llamadas viejas siguen enseñando el nombre que tenía entonces. Aplica al
  detalle de la llamada en el editor y a `pnpm calls`.

**Fuera de alcance** (deliberado, no olvidado)

- Subir audios y elegir `media` de una lista. Va en un cambio propio, `sound-library`, justo
  después de este: trae ruta nueva en la API, un segundo sitio donde el motor escribe dentro de
  `asterisk-config` y dependencia de ffmpeg. Aquí `media` sigue siendo un campo de texto.
- Unificar la unidad de `timeout`. Reinterpretaría en silencio los configs de versiones ya
  publicadas, que son inmutables. La unidad se declara y se escribe en la etiqueta.
- Editar `meta.start` y `meta.timezone`, que siguen sin tener editor.
- Un selector de endpoints para `dial`. Sigue siendo texto libre.

## Capabilities

### New Capabilities

- `visual-flow-editing`: editar el grafo sin escribir JSON — crear nodos desde un selector de
  tipos, nombrarlos, configurarlos campo a campo, construir las condiciones de las aristas como un
  árbol de grupos a partir de las variables que de verdad existen en ese punto del flujo, y que el
  motor declare y valide ese esquema en vez de que viva repartido por las implementaciones de nodo.

### Modified Capabilities

- `flow-entry-node`: el requisito "la configuración de la entrada se edita con un formulario"
  se justificaba en que era el único nodo con formulario mientras los demás usaban el editor de
  JSON. Desde este cambio todos tienen formulario, así que el requisito pasa a decir lo que sigue
  siendo cierto: el de la entrada es un caso especial porque elige de entre las troncales dadas de
  alta y enseña su estado, no porque los demás sean JSON.

## Impact

**Código**

| Fichero | Qué le pasa |
|---|---|
| `src/schema.ts` | nuevo: campos, unidades, defectos y variables por tipo de nodo |
| `src/types.ts` | `NodeSpec` gana `name?`, que el motor ignora igual que `position` |
| `src/validate.ts` | valida los configs contra el esquema, como error |
| `src/nodes.ts` | los defectos dejan de estar en línea y se leen del esquema |
| `src/calls.ts` | la traza se imprime resuelta contra la versión de la llamada |
| `ui/src/graph.js` | gana la ida y vuelta entre jsonlogic y el árbol de grupos, la coerción de valores según el esquema y cómo se rotula un nodo |
| `ui/src/NodeForm.jsx` | nuevo: el selector de tipos, el de creación, el nombre y los inputs por campo |
| `ui/src/WhenForm.jsx` | nuevo: el constructor de condiciones |
| `ui/src/App.jsx` | fuera el textarea y `addNode`; ids aleatorios; el nodo pinta nombre o tipo y resumen; la traza se resuelve |

**Datos**

Ninguno. No se toca la base. El grafo gana un campo opcional por nodo (`name`) que ni el motor ni
las versiones ya publicadas necesitan: un grafo sin `name` es válido y se pinta como siempre.

**Dependencias**

Tres, todas de desarrollo y todas dentro de `ui/`: `vitest`, `jsdom` y
`@testing-library/react`. Ninguna llega al motor ni se publica. `node --test` no sabe leer JSX y
no hay forma barata de que lo aprenda, así que lo que toca el DOM necesita su propio runner.

**Tests**

`pnpm test` pasa a encadenar los dos runners, y el "137 tests" de `AGENTS.md` y `README.md` pasa a
ser dos cifras.

**Orden**

Este cambio da por hecho que cada llamada guarda su versión. Conviene archivar `flow-versions`
antes de empezar; solo le queda la prueba de extremo a extremo con un softphone.
