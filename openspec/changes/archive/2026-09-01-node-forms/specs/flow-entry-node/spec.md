## MODIFIED Requirements

### Requirement: La configuración de la entrada se edita con un formulario

El sistema SHALL ofrecer para el nodo `entry` un formulario que elija la troncal de entre las que
están dadas de alta y enseñe su estado real en Asterisk. Desde que todos los nodos se editan con
formularios, lo que hace especial a este no es tener uno: es que su campo no se escribe, se elige
de una lista que vive en la base de datos, y que su valor se puede confirmar contra Asterisk sin
entrar por SSH.

#### Scenario: Selección con un click

- **WHEN** se hace un click sobre el nodo `entry` en el editor
- **THEN** su configuración aparece como formulario en el panel lateral

#### Scenario: Apertura con doble click

- **WHEN** se hace doble click sobre el nodo `entry`
- **THEN** se abre una vista ampliada con el mismo formulario, el estado de la troncal y la
  configuración generada

#### Scenario: La troncal se elige, no se escribe

- **WHEN** se configura el nodo `entry`
- **THEN** la troncal se elige de entre las dadas de alta y se ve su estado en Asterisk, en vez de
  escribirse a mano

#### Scenario: Los demás nodos también tienen formulario

- **WHEN** se selecciona un nodo que no es `entry`
- **THEN** se edita con un control por campo según su tipo, no con un editor de JSON
