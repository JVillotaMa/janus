## ADDED Requirements

### Requirement: El motor sirve el editor construido contra su propio código

El sistema SHALL servir el editor ya construido desde el mismo proceso que atiende la API, cuando
ese build esté presente. El editor lee del código del motor qué campos tiene cada tipo de nodo y
qué destinos son válidos, así que construirlo en otro sitio permite que ofrezca un vocabulario
distinto del que el motor valida — y decide el motor.

#### Scenario: Se abre el editor

- **WHEN** se pide la raíz al motor y el editor está construido
- **THEN** se devuelve el editor, listo para usarse en un navegador

#### Scenario: Los recursos del editor

- **WHEN** el editor pide sus hojas de estilo y sus guiones
- **THEN** se sirven con el tipo de contenido que les corresponde

#### Scenario: La API sigue siendo la API

- **WHEN** se pide cualquiera de las rutas de la API
- **THEN** responde la API, no el editor

### Requirement: Sin editor construido, el motor se comporta como antes

El sistema SHALL seguir respondiendo como lo hacía cuando no hay build del editor, sin necesidad de
declarar en qué modo está. Durante el desarrollo el editor lo sirve su propio servidor desde otra
máquina, y esa forma de trabajar no puede depender de recordar una variable.

#### Scenario: No hay build

- **WHEN** se pide una ruta que no es de la API y el editor no está construido
- **THEN** la respuesta es la misma que daba antes de que el motor supiera servir el editor

#### Scenario: El editor en desarrollo

- **WHEN** el editor se sirve desde su propio servidor de desarrollo contra este motor
- **THEN** la API responde igual, sin que nada cambie por que exista o no un build

### Requirement: Servir ficheros no permite salir del directorio del editor

El sistema MUST resolver la ruta pedida y servir únicamente lo que quede dentro del directorio del
editor. La ruta llega desde fuera y acaba siendo un fichero en disco; los nombres los genera la
herramienta de construcción, así que no se pueden acotar a un alfabeto y la contención hay que
comprobarla sobre la ruta ya resuelta.

#### Scenario: Se pide algo de fuera del directorio

- **WHEN** se pide una ruta que apunta fuera del directorio del editor, en cualquiera de sus formas
- **THEN** no se sirve ningún fichero

#### Scenario: Se pide algo que no existe

- **WHEN** se pide un fichero que no está en el editor construido
- **THEN** la respuesta lo dice y no se sirve nada

#### Scenario: Se pide un directorio

- **WHEN** la ruta pedida resuelve a un directorio y no a un fichero
- **THEN** no se sirve nada, salvo que sea la raíz del editor
