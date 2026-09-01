## MODIFIED Requirements

### Requirement: La configuración de un nodo se edita campo a campo

El sistema SHALL presentar la configuración de un nodo como un control por campo, con su etiqueta
y su unidad cuando la tenga, y MUST NOT exigir escribir JSON para configurarlo. Pedir JSON obliga a
conocer de memoria el nombre de cada campo y su unidad, que es justo lo que este proyecto existe
para no exigir.

Un campo cuyos valores no los conoce el esquema —la troncal del nodo de entrada, el audio de un
`say`— SHALL declarar en el esquema que tiene control propio, para que sea el vocabulario y no el
formulario quien lo decida.

#### Scenario: Cada campo tiene su control

- **WHEN** se selecciona un nodo
- **THEN** aparece un control por cada campo que declara su tipo, con el valor que tiene ahora

#### Scenario: La unidad se ve

- **WHEN** se edita un campo que tiene unidad declarada
- **THEN** la unidad se muestra junto al campo

#### Scenario: El valor sale con el tipo declarado

- **WHEN** se escribe el valor de un campo numérico y se guarda
- **THEN** el flujo guarda un número, no la cadena que se tecleó

#### Scenario: Un campo que no sale del esquema usa su propio control

- **WHEN** se edita un campo que el esquema declara con control propio, como la troncal del nodo de
  entrada o el audio de un nodo que reproduce
- **THEN** se edita con ese control en vez de con el genérico de texto

#### Scenario: El campo de audio deja elegir un fichero

- **WHEN** se edita el campo de audio de un nodo
- **THEN** se puede elegir un fichero del sistema, elegir uno ya subido, o escribir la referencia a
  mano
