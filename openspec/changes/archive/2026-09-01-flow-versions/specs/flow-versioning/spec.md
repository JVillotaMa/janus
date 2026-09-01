## ADDED Requirements

### Requirement: Cada llamada queda anclada a la versión con la que entró

El sistema SHALL guardar, junto a la llamada, el número de la versión de flujo que esa llamada
recorrió, y MUST tomarlo en el instante en que la llamada entra y no al guardarla. Sin ese número
la traza es una lista de ids de nodo que no dice sobre qué grafo significan algo.

#### Scenario: La llamada guarda su versión

- **WHEN** una llamada entra, recorre el flujo y termina
- **THEN** la llamada queda guardada con el número de la versión de flujo que estaba en vivo
  cuando entró

#### Scenario: Se publica mientras la llamada está en curso

- **WHEN** se publica una versión nueva mientras una llamada está a mitad del flujo
- **THEN** esa llamada se guarda con la versión con la que entró, no con la recién publicada

#### Scenario: Las llamadas nuevas cogen la versión nueva

- **WHEN** entra una llamada después de publicarse una versión nueva
- **THEN** se guarda con el número de esa versión nueva

### Requirement: Las versiones publicadas se pueden listar

El sistema SHALL exponer la lista de versiones de flujo publicadas, de la más reciente a la más
antigua, con su número, su fecha de publicación y el tamaño de su grafo. Una lista de números
pelados no permite reconocer la versión que se busca.

#### Scenario: Se listan las versiones

- **WHEN** se pide la lista de versiones
- **THEN** se devuelven todas las publicadas, cada una con su número, su fecha y cuántos nodos y
  aristas tiene

#### Scenario: La más reciente es la primera

- **WHEN** se pide la lista de versiones
- **THEN** la primera es la última publicada, que es la que está sirviendo llamadas

### Requirement: Se puede leer el grafo de cualquier versión publicada

El sistema SHALL devolver el grafo completo de una versión concreta cuando se pide por su número,
sin que eso cambie cuál es la versión en vivo. Leer el pasado es una lectura, nunca un despliegue.

#### Scenario: Se lee una versión anterior

- **WHEN** se pide el grafo de una versión publicada por su número
- **THEN** se devuelve tal y como se publicó

#### Scenario: Leer no cambia la versión en vivo

- **WHEN** se lee una versión anterior
- **THEN** el motor sigue atendiendo las llamadas con la versión que tenía

#### Scenario: Una versión que no existe

- **WHEN** se pide una versión que nunca se publicó
- **THEN** la respuesta lo dice y no devuelve ningún grafo

### Requirement: La lista de llamadas no depende de la versión

El sistema SHALL devolver todas las llamadas registradas independientemente de la versión de flujo
con la que corrieron, y SHALL mostrar en cada una a qué versión pertenece. Filtrar el historial por
versión escondería llamadas justo cuando más falta hace verlas: después de publicar un cambio.

#### Scenario: Se listan llamadas de versiones distintas

- **WHEN** se consulta el historial habiendo llamadas de varias versiones
- **THEN** aparecen todas, sin filtrar por versión

#### Scenario: Cada llamada enseña su versión

- **WHEN** se mira una llamada en el historial
- **THEN** se ve con qué versión de flujo corrió

### Requirement: La traza se ilumina sobre el grafo que la llamada recorrió

El sistema SHALL dibujar el grafo de la versión de la llamada antes de encender su camino, de
forma que los nodos iluminados sean los que esa llamada pisó. Encender la traza sobre el grafo
actual ilumina nodos que no son esos, o ninguno, y en ninguno de los dos casos avisa.

#### Scenario: Se mira una llamada de una versión anterior

- **WHEN** se selecciona una llamada que corrió con una versión que ya no es la última
- **THEN** el lienzo pasa a dibujar el grafo de esa versión y enciende encima el camino recorrido

#### Scenario: Primero el grafo, después la luz

- **WHEN** se selecciona una llamada
- **THEN** no se enciende ningún nodo hasta que el lienzo dibuja el grafo de su versión

#### Scenario: Se apaga la llamada

- **WHEN** se deselecciona la llamada
- **THEN** el camino se apaga y el lienzo vuelve a dibujar el flujo que se estaba editando

### Requirement: Mirar el pasado no altera el trabajo en curso

El sistema SHALL conservar intacto el flujo que se está editando mientras se mira una llamada o
una versión publicada, incluidas las modificaciones que todavía no se han aplicado al motor. Que
consultar el historial cueste el trabajo sin guardar haría que nadie lo consultase.

#### Scenario: Se vuelve con las ediciones sin aplicar

- **WHEN** se edita el flujo sin aplicarlo, se mira una llamada de otra versión y se sale
- **THEN** el flujo editado vuelve exactamente como estaba, con sus modificaciones

#### Scenario: Mirar no publica nada

- **WHEN** se mira una versión anterior
- **THEN** no se publica ninguna versión ni cambia lo que sirve el motor

### Requirement: Una versión publicada no se edita

El sistema MUST NOT permitir modificar el grafo mientras se está mirando una versión publicada o
la de una llamada. Una versión publicada es inmutable, así que editarla no significa nada, y
permitirlo acabaría publicando una mezcla del grafo antiguo con los retoques.

#### Scenario: El lienzo no admite cambios

- **WHEN** se está mirando una versión publicada
- **THEN** no se pueden mover, crear, borrar ni reconfigurar nodos ni aristas

#### Scenario: No se puede publicar lo que se está mirando

- **WHEN** se está mirando una versión publicada
- **THEN** la acción de aplicar al motor no está disponible

### Requirement: Volver a una versión anterior publica una versión nueva

El sistema SHALL permitir traer una versión publicada al editor como flujo en edición, y MUST
conservar intactas todas las versiones ya publicadas al hacerlo. Volver atrás no es reescribir el
pasado: es publicar de nuevo lo que ya funcionó.

#### Scenario: Se carga una versión anterior en el editor

- **WHEN** se elige cargar una versión anterior en el editor
- **THEN** su grafo pasa a ser el flujo que se está editando y se puede modificar antes de aplicarlo

#### Scenario: Publicar la versión cargada

- **WHEN** se aplica al motor una versión anterior cargada en el editor
- **THEN** se publica como versión nueva y las anteriores siguen intactas en la base

#### Scenario: Cargar no publica por sí solo

- **WHEN** se carga una versión anterior en el editor y no se aplica
- **THEN** el motor sigue atendiendo las llamadas con la versión que tenía

### Requirement: Una llamada sin versión conocida no finge tenerla

El sistema MUST NOT atribuir ninguna versión a las llamadas guardadas antes de que se registrase la
versión, y SHALL advertir de que el grafo mostrado puede no corresponder a lo que esa llamada
recorrió. Inventarles una versión reproduce exactamente el fallo silencioso que este cambio quita.

#### Scenario: Llamada anterior a este cambio

- **WHEN** se selecciona una llamada guardada sin versión
- **THEN** su camino se enciende sobre el grafo que hubiera en el lienzo, avisando de que puede no
  corresponder

#### Scenario: No se inventa una versión

- **WHEN** se consulta una llamada guardada sin versión
- **THEN** su versión se devuelve como desconocida, no como la primera ni como la última

### Requirement: Las versiones tienen su propio sitio en el editor

El sistema SHALL ofrecer la navegación entre versiones como una pestaña propia junto a la de
llamadas, en la que se ve la lista de versiones publicadas y se distingue cuál está en vivo. Sin un
sitio donde vivir, el historial de versiones es una tabla que solo existe en la base de datos.

#### Scenario: Se cambia de pestaña

- **WHEN** se selecciona la pestaña de versiones
- **THEN** aparece la lista de versiones publicadas en lugar de la de llamadas

#### Scenario: Se distingue la versión en vivo

- **WHEN** se mira la lista de versiones
- **THEN** se ve cuál es la que está atendiendo las llamadas

### Requirement: La base existente se migra sin perder llamadas

El sistema SHALL añadir el registro de versión a una base ya existente sin borrar ni recrear
ninguna tabla, y MUST fallar de forma visible si la migración no se puede aplicar. La base tiene
llamadas reales, y una migración que falla en silencio deja el motor escribiendo contra una tabla
que no es la que cree.

#### Scenario: Base con llamadas anteriores

- **WHEN** el motor arranca contra una base creada antes de este cambio
- **THEN** las llamadas guardadas siguen ahí con todos sus datos y su versión queda como desconocida

#### Scenario: Arrancar dos veces

- **WHEN** el motor arranca de nuevo sobre una base ya migrada
- **THEN** la migración no se repite y no produce ningún error

#### Scenario: Base nueva

- **WHEN** el motor arranca contra una base vacía
- **THEN** la tabla de llamadas se crea ya con el registro de versión
