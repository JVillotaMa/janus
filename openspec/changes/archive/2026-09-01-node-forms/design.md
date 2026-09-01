## Context

El editor pinta el grafo con React Flow y edita el elemento seleccionado con un `<textarea>` de
JSON en la barra derecha de `App.jsx`. Funciona, y por eso ha durado, pero pide saber de memoria
el vocabulario entero del motor.

Estado del que se parte:

- `src/nodes.ts` es el único sitio donde consta qué campos usa cada tipo: `config.media`,
  `config.timeout ?? 5000`, `config.endpoint`, `config.timeout ?? 30`. Están dentro del cuerpo de
  cada implementación, no declarados.
- `src/validate.ts` comprueba ids, aristas, alcanzabilidad y tipos de nodo, pero **ni mira los
  configs**. Un `say` sin `media` se publica y falla en llamada real.
- `ui/src/graph.js` ya traduce jsonlogic a castellano con `describe()`, y **ya recorre árboles**:
  sabe `and`, `or` y `!` recursivamente, más `== != > >= < <= in`. Cualquier otro operador cae al
  JSON crudo. Es, sin haberlo llamado así, el allowlist de lo que el editor sabe representar.
- `ui/src/graph.test.js` son 13 tests con `node:test`, sin dependencias, que ya entran en los 137
  porque `node --test` los encuentra desde la raíz.
- `ui/src/Trunks.jsx` es el único formulario de campos que existe, para el nodo `entry`. Es el
  precedente de estilo.
- `App.jsx` genera ids con `nodo-${nodes.length + 1}`, que colisiona en cuanto se borra un nodo
  intermedio y se crea otro. Y el id es a la vez el nombre: es lo que se pinta en el lienzo y lo
  que sale en la traza.

Evidencia de las 15 versiones publicadas en `janus.db`:

```
aristas:  103 sin when · 30 con ==  ·  15 con and(<=, >=, <)
          0 anidadas · 0 or · 0 in · 0 !
variables usadas:  weekday  hhmm  digit  dial
literales:  hhmm/weekday números · digit/dial cadenas ("1", "answered")
configs:    say.media · gather.media · gather.timeout · dial.endpoint · dial.timeout
            ningún nodo sin un campo obligatorio
```

Lo publicado hasta hoy es plano, pero el constructor se hace en árbol a propósito: es la forma que
`describe()` ya tiene, hace la vuelta desde jsonlogic casi total en vez de parcial, y quita la
pregunta "¿y si necesito un O dentro de un Y?" antes de que se haga.

Restricciones que no se negocian, de `AGENTS.md`:

- El diff más corto que funcione; sin ruta nueva si cabe en las que hay. `server.ts` está en seis,
  que es el techo que marca su propio comentario `ponytail:`.
- Identificadores en inglés, comentarios y textos en español. Pocos ficheros.
- Toda lógica no trivial deja una comprobación ejecutable.

## Goals / Non-Goals

**Goals:**

- Que se pueda construir un flujo entero sin escribir una llave.
- Que el vocabulario de cada tipo de nodo esté declarado en un sitio y lo lean el motor y la UI.
- Que lo que el formulario produce sea siempre un grafo que el motor acepta, y que eso lo diga un
  test y no la confianza.
- Que el editor no pueda perder ni deformar en silencio una condición que no sabe representar.
- Que los nodos se puedan nombrar y renombrar sin que eso reescriba la traza de las llamadas
  pasadas.

**Non-Goals:**

- Subir audios o elegir `media` de una lista. Va en `sound-library`, el cambio siguiente.
- Unificar la unidad de `timeout`.
- Editar `meta.start` o `meta.timezone`.
- Autocompletar `endpoint` con los endpoints que Asterisk conoce.
- Sustituir React Flow o tocar el lienzo más allá de lo que pinta cada nodo.

## Decisions

### 1. El esquema vive en `src/schema.ts` y la UI lo importa

Un módulo de datos, sin comportamiento: por tipo de nodo su etiqueta, sus campos y las variables
que produce; por variable su tipo y sus valores cerrados. Lo importan `validate.ts`, `nodes.ts`
(para los defectos) y la UI.

**Alternativa descartada: duplicar la tabla en `ui/`.** Son dos verdades que hay que acordarse de
mover a la vez, y la que se queda vieja no falla: acepta un campo que el motor ignora.

**Alternativa descartada: servirlo por `GET /api/node-types`.** Es la séptima ruta, y el comentario
`ponytail:` de `server.ts` dice que la séptima es migrar a Hono. Pagar una migración por una tabla
estática que cambia cuando se añade un tipo de nodo —una vez al año— no sale.

Que la UI importe del árbol del motor es un import relativo dentro del mismo repo; Vite compila
`.ts` sin configuración. El acoplamiento que introduce es exactamente el que queremos: si el motor
cambia el vocabulario, el editor se entera al compilar.

### 2. La condición es un árbol de grupos, no una lista

```
Grupo    = { join: 'and' | 'or', negated: boolean, children: (Grupo | Cláusula)[] }
Cláusula = { var, op, value }
```

Un grupo tiene su unión, puede estar negado, y de él cuelgan cláusulas y otros grupos. Mezclar Y y
O es meter un grupo dentro de otro, que es exactamente lo que significa la mezcla y lo que evita la
ambigüedad de precedencia: no hay "¿y esto se evalúa antes que aquello?", hay cajas dentro de cajas.

```
┌ se cumple  [todas ▾]  ────────────────────────┐
│                                               │
│   weekday  ≤  5                          [×]  │
│                                               │
│   ┌ se cumple  [alguna ▾]  ──────────────┐    │
│   │   digit  =  1                   [×]  │    │
│   │   digit  =  2                   [×]  │    │
│   │   [+ condición]  [+ grupo]            │   │
│   └───────────────────────────────────────┘   │
│                                               │
│   [+ condición]   [+ grupo]                   │
└───────────────────────────────────────────────┘
```

`!` no es un operador de cláusula sino la casilla "negado" de un grupo. Negar una comparación
suelta ya se hace cambiando el operador (`!(a == b)` es `a != b`), así que ponerlo en los dos
sitios sería dar dos formas de escribir lo mismo.

La ida a jsonlogic es total. La vuelta sigue siendo **parcial y lo admite**: si el `when` contiene
un operador fuera del allowlist o algo que no es un árbol de comparaciones, devuelve `null` y el
editor enseña el JSON en solo lectura. Que la función declare que no puede en vez de devolver una
aproximación es lo importante: una condición mutilada al reabrirla es el fallo que se descubre
cuando una llamada real toma la rama que no era.

**Alternativa descartada: la lista plana** que dictaban los datos (cero anidamientos en 15
versiones). Cubre lo publicado hasta hoy pero obliga a rehacer el modelo la primera vez que haga
falta un O dentro de un Y, y el sitio donde eso crece es justo este.

### 3. El árbol se normaliza al volver, y la normalización se declara

La vuelta desde jsonlogic no siempre devuelve el mismo JSON de partida:

- `{"and": [X]}` —un `and` de un solo hijo— vuelve como `X` pelado.
- Un grupo sin hijos es "sin condición": el `when` desaparece de la arista.

Son las dos únicas normalizaciones y son idempotentes: aplicarlas otra vez no cambia nada. Se
declaran aquí y se prueban, porque el test de ida y vuelta contra las versiones reales tiene que
saber contra qué compara. Un `and` de un solo hijo no aparece en ninguna de las 15 versiones; si
apareciese, se republicaría simplificado y significando lo mismo.

### 4. Los operadores que se ofrecen son un subconjunto de los que `describe()` sabe pintar

Si el constructor pudiera fabricar un operador que `describe()` no traduce, la etiqueta de esa
arista en el lienzo sería JSON crudo: construyes con el formulario algo que el propio editor no
sabe leer. Se ofrecen `== != < <= > >=` e `in`, más `and`, `or` y `!` como estructura del árbol.
Que es, exactamente, todo lo que `describe()` conoce hoy.

### 5. Las variables que ofrece una arista salen del nodo del que sale

`ctx.vars` no es un saco fijo: `caller`, `did`, `hhmm`, `weekday` y `date` los siembra `callVars` al
entrar; `digit` solo existe después de un `gather` y `dial` solo después de un `dial`.

```
la arista sale de…        ofrece
────────────────────────────────────────────────────────
entry · say · hangup      caller did hhmm weekday date
gather                    … y digit   (0-9 * # o sin pulsación)
dial                      … y dial    (answered busy noanswer failed)
```

Por eso el esquema declara, por tipo de nodo, **qué variables deja al salir**: es el dato que
convierte un constructor de reglas genérico en uno que sabe de telefonía. Ofrecer `digit` en una
arista que sale del `entry` es ofrecer una condición que no casa nunca.

`ponytail:` se mira solo el nodo inmediatamente anterior, no todos los caminos que llegan hasta él.
Con flujos lineales acierta; el día que haga falta, se recorre hacia atrás desde la arista.

### 6. Cada variable declara su tipo, porque los literales no son homogéneos

`hhmm` y `weekday` se comparan con números (`900`, `7`); `digit` y `dial` con cadenas (`"1"`,
`"answered"`). Un `<input>` devuelve siempre texto, así que sin el tipo declarado el formulario
emitiría `{"==": [{"var":"digit"}, 1]}` donde tu `flow.json` dice `"1"`.

Funcionaría —jsonlogic compara con `==` flojo— y precisamente por eso es peligroso: no falla, solo
deja de ser el mismo JSON. La ida y vuelta contra tus versiones reales es el test que lo caza.

### 7. El nombre es un campo del nodo; el id vuelve a ser un id

Hoy el id hace dos trabajos: identificar el nodo para las aristas y `call_steps`, y ser el rótulo
que se lee en el lienzo y en la traza. Por eso no se puede renombrar nada sin romper aristas.

Se separan. `name` es un campo opcional del nodo, al lado de `id`, `type` y `position`, y **el motor
lo ignora igual que ignora `position`**: no entra en ninguna decisión de enrutado, no viaja en
`ctx.vars` y no se guarda en `call_steps`. El id pasa a generarse aleatorio y neutro (`n-` más
cuatro hex), no se edita y no se enseña.

Un prefijo por tipo (`say-7f3a`) parecía más legible hasta caer en que el tipo ahora se cambia con
un selector: el prefijo se queda mintiendo en cuanto conviertes ese `say` en un `gather`. El id no
puede llevar información que caduca, porque las aristas y `call_steps` lo referencian y no se puede
regenerar.

Nombres repetidos son un **aviso**, no un error: el nombre no identifica nada, y prohibirlo obliga a
inventar sufijos por un problema que no existe.

### 8. La traza se lee resolviendo contra la versión de la llamada, y por eso renombrar es seguro

`call_steps` guarda ids. Para rotularlos hace falta un grafo, y el grafo correcto es **el de la
versión con la que corrió esa llamada** — que existe desde `flow-versions` y que el editor ya se
trae al pinchar la llamada.

El efecto secundario es el que hace que renombrar no dé miedo: si renombras `saluda` a `bienvenida`
y publicas, las llamadas de ayer siguen ancladas a su versión, en la que ese nodo se llamaba
`saluda`, y su traza lo sigue diciendo. **Renombrar no reescribe el pasado.** Sin el anclaje de
versión, renombrar habría sido una forma silenciosa de falsificar el historial.

El rótulo es `name`, y si no hay nombre, el tipo más un resumen de su config (`Reproducir ·
sound:hello-world`). El id no aparece nunca. Una llamada sin `flow_version` —las anteriores a
`flow-versions`— no tiene grafo contra el que resolver: enseña los ids pelados, como hoy, que es la
misma verdad que ya cuenta su aviso de "este grafo puede no ser el que recorrió".

### 9. Cambiar el tipo conserva lo que coincide y dice lo que tira

`say → gather` conserva `media`. `dial → say` tiene que tirar `endpoint` y `timeout`. Se conservan
los campos que son **el mismo campo** —mismo nombre, mismo tipo y misma unidad— y el resto se
descartan, con **la línea de estado nombrando los descartados**.

Lo de la unidad salió al implementarlo y no es remilgo: `gather.timeout` y `dial.timeout` se llaman
igual y son los dos números, pero uno cuenta milisegundos y el otro segundos. Conservarlo por el
nombre convertiría una espera de cinco segundos en una llamada sonando cinco mil, en silencio y en
el sitio exacto donde este cambio prometía que ya no habría trampas de unidades. Tirar datos sin decirlo es el fallo silencioso de siempre; pedir
confirmación por algo que se deshace volviendo a cambiar el tipo es ceremonia. El `name` no se
toca: es del nodo, no del tipo.

`entry` no aparece en el selector de creación ni en el de cambio de tipo, en ninguna dirección:
crear un segundo `entry` o convertir el que hay deja el grafo inválido, y el editor no debería
ofrecer caminos que `validate` rechaza después.

### 10. Validar los configs es error, no aviso

La distinción que ya usa `validate.ts` es clara: error lo que reventaría en una llamada real, aviso
lo que es un estado intermedio legítimo mientras construyes. Un `say` sin `media` revienta. Es error.

Comprobado contra las 15 versiones de `janus.db`: **ninguna cae por la comprobación nueva**. Las
v1 y v2 dan error, pero por no tener nodo `entry` —obligatorio desde `trunk-provisioning`, y ellas
son de antes—, así que ya eran irrepublicables sin tocarlas. De la v3 en adelante, que es todo lo
publicado desde que existe el nodo de entrada, pasan las quince menos esas dos.

Así que endurecer no rompe el flujo de "cargar una versión anterior en el editor y republicarla"
que se acaba de construir, que era el único riesgo real de este endurecimiento.

### 11. Dos runners, y la frontera es la extensión del fichero

`node --test` no transforma JSX y no hay forma barata de que lo haga. Lo que necesita DOM se va a
`vitest` dentro de `ui/`, que reutiliza la configuración de Vite que ya existe.

```
*.test.js   →  node --test desde la raíz   lógica pura, puede importar src/*.ts
*.test.jsx  →  vitest dentro de ui/         componentes, jsdom
```

La frontera se aplica sola: los patrones por defecto de `node --test` no incluyen `.jsx`, así que
no los ve. `vitest` se limita a `*.test.jsx` para no correr los puros dos veces.

`@testing-library/react` entra como tercera dependencia en vez de renderizar a pelo con
`react-dom/client`: escribir en un `<input>` controlado de React necesita el truco del setter
nativo del prototipo, y escribir uno mismo esa trampa para ahorrarse una dependencia de desarrollo
es exactamente el ahorro que se paga a las 3am.

### 12. La lógica pura crece dentro de `graph.js`, sin fichero nuevo

`graph.js` ya es "traducción entre `flow.json` y lo que entiende la UI": ahí viven `describe`,
`edgeLabel` y `layout`. La ida y vuelta del árbol de condiciones, la coerción de un valor de
formulario según su tipo declarado y cómo se rotula un nodo son la misma familia, y su test ya
existe. Pasa de 79 líneas a unas 200, que sigue siendo un fichero que se lee entero.

Lo que sí son ficheros nuevos son los dos formularios, `NodeForm.jsx` y `WhenForm.jsx`, porque
`App.jsx` elige uno u otro según se haya pinchado un nodo o una arista.

### 13. `timeout` no se unifica de unidad

`gather` cuenta en milisegundos y `dial` en segundos. Unificarlo reinterpretaría los configs de 15
versiones publicadas e inmutables: un `dial` con `timeout: 20` pasaría a ser de 20 ms. La unidad se
declara como columna del esquema y se escribe en la etiqueta del input, que es donde el usuario la
necesita.

### 14. El árbol que se edita es estado del formulario, no una lectura del JSON

El constructor no vuelve a derivar su árbol del `when` guardado en cada render: lo tiene en estado
y lo relee solo al cambiar de arista.

Salió al implementarlo, y es consecuencia directa de la decisión 3. Crear un grupo lo deja con un
solo hijo, y un grupo de un solo hijo **se guarda pelado** — esa es la normalización. Si el
formulario se releyera del JSON, el grupo recién creado desaparecería en el mismo render en que se
crea, justo antes de poder meterle la segunda condición que le da sentido. Nunca podrías construir
un anidamiento a mano.

La forma general del fallo: un formulario controlado sobre una proyección que pierde información
no puede tener estados intermedios. El JSON es cómo se guarda una condición, no cómo se edita.

## Risks / Trade-offs

**[El constructor en árbol es bastante más UI que una lista]** → Es el precio de mezclar Y y O, y se
paga una vez. La recursión ya está resuelta en `describe()`, así que la etiqueta de la arista sale
gratis por muy anidada que esté la condición.

**[Un árbol muy profundo produce una etiqueta ilegible en el lienzo]** → No se limita la
profundidad: quien anide cinco niveles tiene un problema de diseño de flujo, no de editor. Si
molesta, la etiqueta se recorta con puntos suspensivos y la condición entera se lee en el panel.

**[La vuelta desde jsonlogic normaliza y no es idéntica al byte]** → Las dos normalizaciones están
declaradas en la decisión 3 y probadas. Ninguna aparece en las 15 versiones reales.

**[Validar configs rechaza un PUT que antes pasaba]** → Comprobado contra las 15 versiones reales:
ninguna cae por la comprobación nueva. El riesgo que queda es un cliente de la API distinto del
editor, que hoy no existe.

**[Las v1 y v2 no se pueden cargar y republicar]** → No lo causa este cambio: les falta el nodo
`entry`, obligatorio desde `trunk-provisioning`. Cargarlas en el editor funciona —el lienzo las
pinta— y para republicarlas hay que añadirles la entrada, que es exactamente lo que aquel cambio
decidió al no reescribir lo ya publicado.

**[El textarea de solo lectura se convierte en la salida habitual]** → Con el árbol, solo cae ahí un
operador fuera del allowlist. Si empieza a aparecer, es la señal de que falta un operador, y se
añade con datos delante.

**[La UI importa del árbol del motor]** → Acopla el build de la UI al código del motor. Viven en el
mismo repo y se despliegan juntos, así que el acoplamiento ya existía de hecho; lo que cambia es
que ahora se nota al compilar en vez de en una llamada.

**[Tres dependencias nuevas de desarrollo]** → Todas dentro de `ui/`, ninguna llega al motor ni se
publica. El motor sigue con tres dependencias en total.

**[Los ids viejos conviven con los nuevos]** → `entrada`, `saluda` y `menu` siguen llamándose así en
el grafo publicado; solo los nodos que se creen desde ahora llevan `n-`. No hay migración y no hace
falta: el id es opaco para todo el mundo menos para la traza, y la traza ya no lo enseña.

## Migration Plan

**Fase 1 — el esquema.** `src/schema.ts` con los cinco tipos y sus campos. `validate.ts` lo usa
para comprobar configs. `nodes.ts` lee de él los defectos. `types.ts` gana `name`. Todo con
`node --test`, sin tocar la UI.

**Fase 2 — la lógica pura de la UI.** La ida y vuelta del árbol, la coerción de valores y el rótulo
de un nodo dentro de `graph.js`, con su batería en `graph.test.js`: el cartesiano cerrado, árboles
anidados y mezclados, la vuelta contra `flow.json` y las 15 versiones, la zona negativa, y que todo
lo construible pase `validate()`.

**Fase 3 — los formularios.** `NodeForm.jsx` y `WhenForm.jsx`, el selector de creación, el campo de
nombre, y `App.jsx` sin textarea. `vitest` y jsdom entran aquí.

**Fase 4 — los ids y la traza.** Ids aleatorios, el nodo pinta nombre o tipo y resumen, y la traza
resuelta en el editor y en `pnpm calls`.

**Rollback:** por fases. La 1 se queda sola sin problema —el esquema validando de más es útil
aunque no haya formularios—. Las 3 y 4 son la UI, que no tiene estado propio: se revierte el
fichero. Ninguna versión publicada se toca en ningún momento, y un grafo hecho con los formularios
lo sigue leyendo el editor viejo: `name` es un campo que quien no lo conoce ignora.

## Open Questions

Ninguna que bloquee. Dos comprobaciones baratas antes de construir encima, y dos techos anotados:

- **¿Un `.js` bajo `node --test` puede importar un `.ts`?** El borrado de tipos de Node 24 se aplica
  por fichero, así que debería, pero la fase 2 entera se apoya en ello. Se comprueba en la primera
  tarea, no se supone.
- **¿Vite resuelve `../../src/schema.ts` desde `ui/src/`?** Fuera de su raíz de proyecto. Si se
  queja, se arregla con un alias en `vite.config.js`; conviene saberlo antes de la fase 3.
- `ponytail:` las variables que ofrece una arista se deducen solo del nodo anterior inmediato.
- `ponytail:` no hay límite de profundidad en el árbol de condiciones.
