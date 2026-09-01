## 1. Comprobaciones previas

- [x] 1.1 Comprobar que un `.js` bajo `node --test` puede importar un `.ts` del motor: la fase 2
      entera se apoya en ello, así que se verifica antes de escribirla
- [x] 1.2 Comprobar que Vite resuelve `../../src/*.ts` desde `ui/src/`, que está fuera de su raíz
      de proyecto. Si se queja, alias en `vite.config.js`

## 2. El esquema: una sola verdad

- [x] 2.1 `src/schema.ts`: por tipo de nodo su etiqueta, sus campos (nombre, tipo, unidad,
      obligatoriedad, valor por defecto) y las variables que deja al salir; por variable su tipo y
      sus valores cerrados si los tiene. `gather.timeout` en ms y `dial.timeout` en segundos: la
      unidad es una columna, no se unifica
- [x] 2.2 `src/types.ts`: `NodeSpec` gana `name?: string`, documentado como ignorado por el motor
      igual que `position`
- [x] 2.3 `src/validate.ts`: comprueba los configs contra el esquema — campo obligatorio ausente y
      campo con el tipo equivocado son **error**; campo que el tipo no declara es aviso
- [x] 2.4 `src/validate.ts`: dos nodos con el mismo `name` son aviso, no error — el nombre no
      identifica nada
- [x] 2.5 `src/nodes.ts`: los defectos en línea (`?? 5000`, `?? 30`) pasan a leerse del esquema
- [x] 2.6 Test: un nodo sin campo obligatorio no se publica; uno con el tipo cambiado tampoco; uno
      con un campo de más se publica con aviso
- [x] 2.7 Test: las 15 versiones publicadas de `janus.db` pasan la validación nueva — se ejecuta
      contra una **copia** de la base, nunca contra la de verdad
- [x] 2.8 Test: el defecto que aplica el motor al ejecutar un nodo es el mismo que declara el
      esquema

## 3. La lógica pura de la UI

- [x] 3.1 `ui/src/graph.js`: `toWhen(grupo)` construye el jsonlogic del árbol — `and`/`or` con sus
      hijos, `!` cuando el grupo está negado, y nada cuando el grupo está vacío
- [x] 3.2 `ui/src/graph.js`: `fromWhen(when)` devuelve el árbol, o `null` si contiene algo que el
      constructor no ofrece. `null` es "no cabe", nunca una aproximación
- [x] 3.3 `ui/src/graph.js`: las dos normalizaciones declaradas en el diseño — un `and`/`or` de un
      solo hijo vuelve pelado, y un grupo sin hijos es "sin condición"
- [x] 3.4 `ui/src/graph.js`: `coerce(field, texto)` convierte lo que devuelve un input al tipo que
      declara el esquema, para que `digit` salga como `"1"` y `hhmm` como `900`
- [x] 3.5 `ui/src/graph.js`: `nodeLabel(node)` devuelve el `name`, y si no hay, el tipo más un
      resumen de su config. Nunca el id
- [x] 3.6 `ui/src/graph.js`: `varsAt(flow, edge)` son las variables de la llamada más las que deja
      el nodo del que sale la arista
- [x] 3.7 Test cartesiano cerrado: para cada variable × operador × valor, `toWhen` → `fromWhen`
      devuelve lo mismo que entró
- [x] 3.8 Test de árboles: anidado, Y dentro de O, O dentro de Y, y grupos negados, en las dos
      direcciones
- [x] 3.9 Test de ida y vuelta abierta: cada `when` de `flow.json` y de las 15 versiones publicadas
      sobrevive `fromWhen` → `toWhen` idéntico, salvo las normalizaciones de 3.3
- [x] 3.10 Test de la zona negativa: un operador fuera del allowlist, y una expresión que no es un
      árbol de comparaciones, devuelven `null` — y el `when` original se guarda intacto
- [x] 3.11 Test que cierra el círculo: todo grafo construible con el esquema y el constructor pasa
      `validate()` del motor, importado desde `../../src/validate.ts`

## 4. Los formularios

- [x] 4.1 `ui/package.json`: `vitest`, `jsdom` y `@testing-library/react` como devDependencies, y
      script `test`. La configuración limita vitest a `*.test.jsx` para no correr dos veces los
      tests puros
- [x] 4.2 `package.json` de la raíz: `pnpm test` encadena `node --test` y el de `ui/`
- [x] 4.3 `ui/src/NodeForm.jsx`: un control por campo según el esquema, con etiqueta y unidad;
      desplegable para los campos de valores cerrados
- [x] 4.4 `ui/src/NodeForm.jsx`: el campo de nombre del nodo
- [x] 4.5 `ui/src/NodeForm.jsx`: selector de tipo — conserva los campos que coinciden, descarta el
      resto y deja dicho en la línea de estado cuáles. El nodo `entry` no lo lleva
- [x] 4.6 `ui/src/NodeForm.jsx`: el selector de creación, con los tipos disponibles menos `entry`,
      creando el nodo ya con sus valores por defecto
- [x] 4.7 `ui/src/WhenForm.jsx`: el árbol — grupo con su unión y su negación, añadir condición,
      añadir grupo, borrar; las variables salen de `varsAt` y los valores cerrados de su desplegable
- [x] 4.8 `ui/src/WhenForm.jsx`: cuando `fromWhen` devuelve `null`, el JSON en solo lectura con el
      aviso de que no cabe en el formulario
- [x] 4.9 `ui/src/App.jsx`: fuera el `<textarea>` y `applyDraft`; el panel pinta `NodeForm` o
      `WhenForm` según lo seleccionado, y `Trunks` sigue siendo el del nodo `entry`
- [x] 4.10 Test jsdom: escribir en un campo cambia el borrador con el tipo correcto
- [x] 4.11 Test jsdom: cambiar el tipo enseña otros campos, conserva los que coinciden y nombra los
      descartados
- [x] 4.12 Test jsdom: el selector de creación no ofrece `entry`, y el nodo de entrada no deja
      cambiar de tipo
- [x] 4.13 Test jsdom: construir un grupo con un grupo dentro produce el jsonlogic esperado, y una
      condición que no cabe se pinta en solo lectura

## 5. Los ids, los nombres y la traza

- [x] 5.1 `ui/src/App.jsx`: los ids de nodo nuevos se generan aleatorios y neutros (`n-` más cuatro
      hex), sustituyendo a `nodo-${nodes.length + 1}`, que colisiona tras borrar un nodo
- [x] 5.2 `ui/src/App.jsx`: el nodo del lienzo pinta `nodeLabel` — nombre, o tipo y resumen — en vez
      de `id · type`
- [x] 5.3 `ui/src/App.jsx`: la traza de la llamada seleccionada se rotula contra el grafo de su
      versión, que ya se trae `viewing`; una llamada sin versión enseña los pasos tal cual
- [x] 5.4 `src/calls.ts`: `pnpm calls` rotula igual, leyendo `flowAt(call.flowVersion)`
- [x] 5.5 Test: renombrar un nodo y publicar no cambia cómo se lee la traza de una llamada anterior
- [x] 5.6 Test: dos nodos creados después de borrar uno intermedio no comparten id

## 6. Cierre

- [x] 6.1 `pnpm test` y `pnpm typecheck` en verde, con las dos cifras de tests
- [x] 6.2 Prueba a mano en el editor: creado el flujo de la v18 sin escribir una llave — nodos
      desde el selector, nombrados ("Saludo", "LLamar a Ana") y configurados campo a campo
- [x] 6.3 Llamada real 2026-09-01 06:37, v18: la traza se lee
      `Entrada → Saludo → Pedir una tecla · sound:janus/… → Colgar`, con los nombres puestos
- [x] 6.4 Actualizar `AGENTS.md` y `README.md`: el esquema compartido, los formularios, `name`, los
      ids generados, los dos runners y el número de tests
