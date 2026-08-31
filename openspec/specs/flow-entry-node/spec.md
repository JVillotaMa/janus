# flow-entry-node Specification

## Purpose
TBD - created by archiving change trunk-provisioning. Update Purpose after archive.
## Requirements
### Requirement: Todo flujo tiene un punto de entrada explícito

El grafo SHALL declarar por dónde empieza mediante un nodo de tipo `entry`, y SHALL haber
exactamente uno. Sin él, el arranque del flujo es un identificador suelto que puede señalar a
cualquier nodo y no hay dónde colgar la información de por dónde entra la llamada.

#### Scenario: Flujo válido

- **WHEN** se valida un flujo con exactamente un nodo `entry` que es el nodo de arranque
- **THEN** la validación no produce ningún error por este motivo

#### Scenario: Flujo sin nodo de entrada

- **WHEN** se valida un flujo que no tiene ningún nodo `entry`
- **THEN** la validación produce un error y el flujo no se puede publicar

#### Scenario: Flujo con dos nodos de entrada

- **WHEN** se valida un flujo con más de un nodo `entry`
- **THEN** la validación produce un error y el flujo no se puede publicar

#### Scenario: El arranque apunta a otro nodo

- **WHEN** se valida un flujo cuyo nodo de arranque no es el nodo `entry`
- **THEN** la validación produce un error y el flujo no se puede publicar

### Requirement: Al nodo de entrada no llega ninguna arista

El sistema SHALL rechazar cualquier arista cuyo destino sea el nodo `entry`. Una arista así
describe algo que no puede ocurrir: la llamada entra una sola vez y por ahí.

#### Scenario: Arista hacia la entrada

- **WHEN** se valida un flujo con una arista cuyo destino es el nodo `entry`
- **THEN** la validación produce un error y el flujo no se puede publicar

#### Scenario: El editor no deja dibujarla

- **WHEN** se intenta arrastrar una arista desde otro nodo hacia el nodo `entry` en el editor
- **THEN** el editor no permite completar la conexión

### Requirement: El nodo de entrada no ejecuta nada

El sistema SHALL ejecutar el nodo `entry` sin efecto alguno sobre el canal, de forma que se
pueda ramificar nada más entrar sin reproducir audio ni esperar nada. La llamada la contesta el
dialplan antes de llegar al motor, así que el nodo no tiene trabajo que hacer.

#### Scenario: Recorrido a través de la entrada

- **WHEN** una llamada entra y el intérprete ejecuta el nodo `entry`
- **THEN** no se realiza ninguna acción sobre el canal y el recorrido sigue por sus aristas

#### Scenario: Ramificación inmediata

- **WHEN** el nodo `entry` tiene varias aristas con condiciones sobre las variables de la llamada
- **THEN** se toma la primera que casa sin haber ejecutado nada antes

#### Scenario: La entrada queda en la traza

- **WHEN** una llamada recorre el flujo
- **THEN** el nodo `entry` aparece como primer paso de la traza guardada

### Requirement: El nodo de entrada referencia la troncal por nombre

El nodo `entry` SHALL limitarse a nombrar la troncal por la que entra la llamada, y MUST NOT
contener credenciales. El grafo se sirve sin autenticación y sus versiones son inmutables, así
que un secreto escrito en él queda publicado y no se puede retirar.

#### Scenario: Configuración del nodo

- **WHEN** se guarda un nodo `entry` asociado a una troncal
- **THEN** el grafo guarda únicamente el nombre de la troncal

#### Scenario: El grafo publicado no filtra secretos

- **WHEN** se lee el flujo publicado
- **THEN** no aparece ninguna credencial de troncal en ninguna parte del grafo

### Requirement: La configuración de la entrada se edita con un formulario

El sistema SHALL ofrecer un formulario para editar el nodo `entry`, en lugar del editor de JSON
que usan los demás nodos. Es el único nodo cuyo destinatario es alguien que no sabe leer un
fichero de configuración de Asterisk.

#### Scenario: Selección con un click

- **WHEN** se hace un click sobre el nodo `entry` en el editor
- **THEN** su configuración aparece como formulario en el panel lateral

#### Scenario: Apertura con doble click

- **WHEN** se hace doble click sobre el nodo `entry`
- **THEN** se abre una vista ampliada con el mismo formulario, el estado de la troncal y la
  configuración generada

#### Scenario: Los demás nodos no cambian

- **WHEN** se selecciona un nodo que no es `entry`
- **THEN** se sigue editando con el editor de JSON de siempre

### Requirement: Los flujos existentes migran publicando una versión nueva

El sistema SHALL conservar las versiones de flujo ya publicadas tal cual y llevar el nodo
`entry` a una versión nueva. Las versiones son inmutables, así que la exigencia del nodo no
puede reescribir lo ya publicado.

#### Scenario: Migración del flujo publicado

- **WHEN** se añade el nodo `entry` al flujo que estaba publicado sin él
- **THEN** se publica una versión nueva y las anteriores quedan intactas en la base

#### Scenario: Base de datos vacía

- **WHEN** el motor arranca contra una base sin ningún flujo publicado
- **THEN** el flujo semilla que se publica ya incluye su nodo `entry` y es válido

