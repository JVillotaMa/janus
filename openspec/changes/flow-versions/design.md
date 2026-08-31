## Context

La tabla `flows` es append-only desde el principio: `publish()` inserta y nadie actualiza nunca.
La inmutabilidad ya está, lo que falta es poder usarla.

Estado del que se parte:

- `store.ts` expone `publish(graph)` y `latestFlow()`. No hay forma de listar versiones ni de leer
  una por número, aunque la columna `version` sea la clave primaria.
- `calls` no guarda con qué versión entró la llamada. La traza es una lista de ids de nodo en
  `call_steps` y nada dice sobre qué grafo significan.
- `main.ts` hace `(store.latestFlow() ?? store.publish(await seed())).graph`: se queda el grafo y
  tira el número. Cada llamada captura `flowAtStart = flow`, así que ya conserva el **grafo**
  correcto durante toda la llamada; lo que no conserva es su identidad.
- `server.ts` sirve cinco rutas con `node:http` en `127.0.0.1`. Su comentario `ponytail:` marca
  media docena como el punto de migrar a Hono.
- `ui/src/App.jsx` guarda el borrador en estado React (`meta`, `nodes`, `edges`) y pinta el camino
  de la llamada seleccionada **encima**, en `litNodes`/`litEdges`, sin tocar lo que se va a
  guardar. Ese patrón de capa de encima es donde encaja lo nuevo.
- `ui/src/Calls.jsx` es hoy la banda izquierda entera: su propio `<aside>`, su cabecera y su lista.
- `janus.db` tiene llamadas reales del dueño. Se migra, no se recrea.

Restricciones que no se negocian, de `AGENTS.md`:

4. Las versiones de flujo son inmutables. Publicar crea versión nueva.
6. Toda transición de nodo se escribe en `call_steps`.
   La API no sale de `127.0.0.1`.
   El diff más corto que funcione; sin ruta nueva si cabe en las que hay.

## Goals / Non-Goals

**Goals:**

- Que la traza de una llamada se pinte sobre el grafo que esa llamada recorrió de verdad, y no
  sobre el que hay ahora.
- Que las versiones publicadas se puedan listar y mirar sin salir del editor.
- Que volver a una versión anterior no exija rehacer el grafo a mano.
- Que mirar el pasado no cueste el trabajo en curso: el borrador sin aplicar vuelve intacto.

**Non-Goals:**

- Diff entre versiones.
- Nombrar, etiquetar o comentar versiones.
- Borrar o podar versiones antiguas.
- Recuperar el borrador tras recargar la página. Vive en estado React hoy y sigue igual.
- Fijar el motor a una versión que no sea la última.
- Versionar las troncales.

## Decisions

### 1. La llamada guarda el número de versión, no una copia del grafo

Una columna `flow_version` en `calls` que apunta a `flows.version`. La alternativa —guardar el
grafo entero junto a la llamada— duplicaría kilobytes por llamada para tener exactamente el mismo
dato, porque `flows` es append-only y esa fila no se va a mover nunca. La inmutabilidad es
justamente lo que convierte la referencia en segura.

El número se captura **al entrar la llamada**, en el mismo sitio donde ya se captura el grafo
(`flowAtStart`), no al guardarla. Una llamada de diez minutos durante la cual se publica dos veces
se guarda con la versión con la que entró, que es la que recorrió.

### 2. La migración se decide con `PRAGMA table_info`, no con un `try/catch`

SQLite no tiene `ADD COLUMN IF NOT EXISTS`. Las dos formas de hacerlo son envolver el `ALTER
TABLE` en un `try/catch` que se trague el error de columna duplicada, o preguntar antes por las
columnas.

Se pregunta antes. Cuestan lo mismo y el `try/catch` se traga también lo que no es una columna
duplicada — una base corrupta, un fichero sin permisos — y lo convierte en un arranque
aparentemente normal contra una tabla sin migrar. En una base con llamadas reales, un fallo de
migración tiene que verse.

### 3. La versión en vivo es siempre la más alta, así que `/api/flow` no cambia

El motor recarga su flujo en el único sitio donde se publica, y publicar inserta al final. La
versión que está sirviendo llamadas es, por construcción, `max(version)`. La lista de versiones ya
dice cuál es: la primera.

Eso deja `GET /api/flow` exactamente como está, devolviendo el grafo pelado, y la UI que ya lo
consume no se entera de este cambio. La alternativa —devolver `{version, graph}`— rompía al
editor para dar un dato que se deduce.

`ponytail:` el día que el motor pueda quedarse fijado a una versión que no sea la última (un
rollback que no publique, o una versión en pruebas), la más alta deja de ser la viva y
`GET /api/flow` tiene que decir cuál es.

### 4. Una sola ruta para las dos lecturas de versiones

`GET /api/flows` devuelve la lista; `GET /api/flows?version=N` devuelve el grafo de esa. Un `if`
por ruta, no dos, y `server.ts` se queda en seis — el techo que marca su propio comentario. La
siguiente ruta que haga falta se atiende migrando a Hono.

La lista lleva número, fecha y cuántos nodos y aristas tiene cada versión. Los contadores exigen
parsear el grafo de cada fila, que es barato para las versiones que va a haber; sin ellos la lista
es una columna de números y fechas y no hay forma de reconocer la versión que buscas.

Devolver los grafos enteros en la lista se descartó: con doscientas versiones publicadas son
cientos de kilobytes por cada vez que se abre la pestaña, para pintar una lista.

### 5. El lienzo dibuja el borrador **o** una versión mirada, y el borrador no se toca

Un estado `viewing`: `null` cuando se está editando, y `{version, flow}` cuando se está mirando
algo publicado. El lienzo dibuja uno u otro. `meta`, `nodes` y `edges` —el borrador— no se tocan
en ningún momento, así que al salir vuelven intactos sin necesidad de guardarlos ni restaurarlos.
No hay copia que sincronizar ni estado que pueda quedar a medias.

La iluminación se queda donde está: `litNodes`/`litEdges` se aplican sobre lo que se esté
dibujando, sea el borrador o una versión.

**Alternativa descartada:** volcar la versión mirada sobre `nodes`/`edges` y guardar el borrador
aparte para restaurarlo al salir. Es la misma pantalla con dos copias del grafo y un camino de
vuelta que puede fallar; y si falla, lo que se pierde es el trabajo sin aplicar del usuario.

### 6. Mirar una versión es de solo lectura

Mientras `viewing` no es `null` no se arrastra, no se conecta, no se borra y no se publica. Una
versión publicada es inmutable, así que editarla no significa nada; y si se dejase editar, el
botón de publicar mandaría una mezcla del grafo antiguo con los retoques, atribuida a "volver a la
v5". La salida es explícita: **cargar en el editor**, que trae esa versión al borrador y desde ahí
se edita y se publica como cualquier otro cambio.

### 7. Volver a una versión es publicarla otra vez, desde el editor

Cargar la versión en el borrador y publicar con el botón de siempre. Publicar inserta, así que
volver a la v5 produce la v8 y la v5 sigue donde estaba: el invariante de inmutabilidad no hay que
defenderlo, se cumple solo.

**Alternativa descartada:** un `POST /api/flows/5/restore` que republicase de un click. Es una ruta
más, publica sin que nadie haya visto lo que publica, y pisa el borrador sin avisar. El caso que
justificaría el atajo —rollback de pánico con algo roto en producción— hoy no existe: es una caja,
un operador y el editor abierto delante.

### 8. Una llamada sin versión se pinta como hoy, diciendo que no se sabe

Las llamadas anteriores a este cambio tienen `flow_version` a `NULL`, y eso es la verdad: no se
sabe sobre qué grafo corrieron. Inventarles la versión 1, o la última, sería exactamente el fallo
silencioso que este cambio existe para quitar.

Se pintan sobre lo que haya en el lienzo, como hoy, con un aviso de que el grafo puede no
corresponder. El aviso desaparece solo: en cuanto se acumulen llamadas nuevas, ninguna lo lleva.

### 9. La banda izquierda pasa a `App.jsx` y `Calls` se queda con la lista

Hoy `Calls.jsx` es el `<aside>`, la cabecera y la lista. Como ahora comparte banda con
`Versions.jsx`, el `<aside>` y las pestañas suben a `App.jsx` y cada componente se queda con su
lista. Es mover quince líneas, y la alternativa —que cada uno traiga su propio `<aside>` y sus
propias pestañas— duplica la banda en dos ficheros que tienen que coincidir.

### 10. La versión mirada se pide cada vez, sin caché

Pinchar una llamada dispara un `GET /api/flows?version=N`. Son unos kilobytes contra `127.0.0.1`
y solo cuando alguien pincha.

`ponytail:` si se nota al pasar rápido de una llamada a otra, un `Map` de versión a grafo en el
componente lo arregla; las versiones son inmutables, así que la caché nunca puede quedar vieja.

## Risks / Trade-offs

**[Migrar una base con llamadas reales]** → `ALTER TABLE ... ADD COLUMN` es la operación menos
destructiva de SQLite: no reescribe filas y la columna nueva queda a `NULL`. No se borra ni se
recrea nada, y si el motor está corriendo la migración solo ocurre al arrancar. El caso que sí
haría daño —recrear la tabla— no se contempla.

**[La versión en vivo se deduce en vez de decirse]** → Vale mientras publicar sea la única forma de
cambiar el flujo vivo, que es como está hoy. Queda escrito en la decisión 3 qué lo rompería.

**[El borrador sigue perdiéndose al recargar la página]** → No es una regresión: pasa hoy igual. Lo
que este cambio garantiza es que **mirar una llamada o una versión** no lo pierde, que es lo que
antes ni siquiera podía ocurrir. Persistirlo en `localStorage` es otra conversación.

**[Un grafo antiguo con un tipo de nodo que ya no existe]** → El editor ya lo pinta gris con
`UNKNOWN` y no revienta. Al cargarlo en el borrador, `validate` lo rechaza al publicar con "el
motor no conoce el tipo", que es exactamente lo que tiene que pasar.

**[Contar nodos y aristas obliga a parsear cada grafo al listar]** → Barato con las versiones que
va a haber. Si algún día son miles, la lista se pagina o los contadores se guardan como columnas al
publicar.

## Migration Plan

**Fase 1 — el motor.** Columna `flow_version` con su migración por `PRAGMA`; listar versiones y
leer una por número; el flujo vivo lleva su número y la llamada lo guarda. Todo se prueba con
`pnpm test`, sin Asterisk.

**Fase 2 — la API.** `GET /api/flows` con sus dos lecturas, y la versión en `GET /api/calls`.

**Fase 3 — el editor.** Las pestañas, el estado `viewing`, el solo lectura y cargar en el editor.

**Rollback:** el motor vuelve atrás sin más — la columna `flow_version` se queda en la base sin que
nadie la lea, que es lo mismo que hacía antes de existir. Ninguna versión publicada se toca en
ningún momento.

## Open Questions

Ninguna que bloquee. Queda anotado como techo, no como duda:

- **Cuando el motor pueda fijarse a una versión que no sea la última**, deducir la viva como
  `max(version)` deja de valer y `GET /api/flow` tiene que devolver cuál está sirviendo.
