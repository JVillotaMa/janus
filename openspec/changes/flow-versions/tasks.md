## 1. El motor: la base sabe de versiones

- [x] 1.1 `store.ts`: columna `flow_version INTEGER` en `calls`, y migración de una base ya
      existente comprobando antes con `PRAGMA table_info` — nunca un `try/catch` que se trague
      cualquier error
- [x] 1.2 `store.ts`: `flowVersions()` devuelve número, fecha y cuántos nodos y aristas tiene cada
      versión publicada, de la más reciente a la más antigua
- [x] 1.3 `store.ts`: `flowAt(version)` devuelve el grafo de una versión concreta, o `null` si no
      existe
- [x] 1.4 `store.ts`: `CallRecord` gana `flowVersion: number | null`; se escribe al guardar y se
      lee en `recent()`
- [x] 1.5 Test: arrancar sobre una base creada sin la columna conserva las llamadas y las deja con
      versión desconocida; arrancar dos veces no falla; una base nueva ya nace con la columna
- [x] 1.6 Test: publicar varias versiones y comprobar que `flowVersions()` las lista con la última
      primera, y que `flowAt()` devuelve cada grafo tal y como se publicó y `null` para una que no
      existe
- [x] 1.7 Test: una llamada guardada con versión la conserva al releerla, y una guardada sin ella
      vuelve como desconocida

## 2. El motor: la llamada se ancla a su versión

- [x] 2.1 `main.ts`: el flujo vivo pasa a ser `FlowVersion` (`{version, graph}`) en vez del grafo
      pelado, tanto al arrancar como al sembrar una base vacía
- [x] 2.2 `main.ts`: `flowAtStart` captura la versión junto al grafo al entrar la llamada, y
      `store.save` la escribe
- [x] 2.3 `server.ts`: `FlowStore` maneja `FlowVersion`; el PUT guarda lo que devuelve
      `store.publish`, y `GET /api/flow` sigue devolviendo el grafo pelado para no romper al editor
- [x] 2.4 Test del intérprete o del store, el que menos ande: una llamada que entra con una versión
      y termina después de publicarse otra se guarda con la primera

## 3. La API

- [x] 3.1 `server.ts`: `GET /api/flows` devuelve la lista de versiones
- [x] 3.2 `server.ts`: `GET /api/flows?version=N` devuelve el grafo de esa versión, y 404 si no
      existe
- [x] 3.3 `GET /api/calls` devuelve `flowVersion` en cada llamada, `null` en las anteriores a este
      cambio
- [x] 3.4 Comprobar a mano con `curl` las tres lecturas contra el motor levantado

## 4. El editor: mirar sin perder el borrador

- [x] 4.1 `App.jsx`: estado `viewing` (`null` o `{version, flow}`); el lienzo dibuja el borrador
      cuando es `null` y el grafo mirado cuando no, sin tocar `meta`, `nodes` ni `edges`
- [x] 4.2 `App.jsx`: la iluminación (`litNodes` / `litEdges`) se aplica sobre lo que se esté
      dibujando, sea el borrador o una versión
- [x] 4.3 `App.jsx`: mientras `viewing` no es `null`, el lienzo es de solo lectura — sin arrastrar,
      sin conectar, sin borrar — y el botón de aplicar al motor no está disponible
- [x] 4.4 `App.jsx`: al seleccionar una llamada, traer el grafo de su versión y solo entonces
      encender el camino; al deseleccionarla, `viewing` vuelve a `null` y con él el borrador intacto
- [x] 4.5 `App.jsx`: una llamada sin versión se ilumina sobre lo que haya en el lienzo, con un aviso
      de que el grafo puede no corresponder

## 5. El editor: las dos pestañas

- [x] 5.1 `App.jsx`: el `<aside>` de la izquierda y las pestañas Llamadas / Versiones suben aquí;
      `Calls.jsx` se queda solo con su lista
- [x] 5.2 `Calls.jsx`: cada llamada muestra con qué versión corrió, o que se desconoce
- [x] 5.3 `Versions.jsx`: lista de versiones con número, fecha, tamaño del grafo y cuál está en vivo
- [x] 5.4 `Versions.jsx`: **ver** una versión la dibuja en el lienzo en solo lectura
- [x] 5.5 `Versions.jsx`: **cargar en el editor** la trae al borrador y sale del modo de solo
      lectura, para publicarla con el botón de siempre

## 6. Cierre

- [x] 6.1 `pnpm test` y `pnpm typecheck` en verde
- [ ] 6.2 Prueba de extremo a extremo: llamada real, publicar un cambio, otra llamada, y comprobar
      que cada una ilumina sobre su propio grafo
- [x] 6.3 Comprobar que el `janus.db` real se migra sin perder ninguna llamada, con el motor parado
- [x] 6.4 Actualizar `AGENTS.md` y `README.md`: la ruta nueva, la columna nueva, el número de tests
      y que `calls` ya no está sin versión
