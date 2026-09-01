# trunk-provisioning Specification

## Purpose
TBD - created by archiving change trunk-provisioning. Update Purpose after archive.
## Requirements
### Requirement: Alta y edición de troncales desde la API

El sistema SHALL permitir dar de alta, modificar y borrar troncales SIP sin editar ficheros
de configuración de Asterisk. La colección se lee y se escribe entera, igual que el flujo:
no hay rutas por identificador.

#### Scenario: Se da de alta la primera troncal

- **WHEN** se envía un `PUT /api/trunks` con una troncal que no existía
- **THEN** la troncal queda guardada en `janus.db` y la respuesta la incluye

#### Scenario: Se borra una troncal

- **WHEN** se envía un `PUT /api/trunks` con una lista que omite una troncal existente
- **THEN** esa troncal deja de existir y desaparece de la configuración generada

#### Scenario: Se listan las troncales

- **WHEN** se hace `GET /api/trunks`
- **THEN** se devuelven todas las troncales guardadas

### Requirement: La contraseña nunca sale en una lectura

El sistema SHALL tratar la contraseña de una troncal como un campo de solo escritura. Una
credencial filtrada permite fraude telefónico por miles de euros en una noche.

#### Scenario: La lectura no expone el secreto

- **WHEN** se hace `GET /api/trunks` de una troncal con contraseña guardada
- **THEN** la respuesta no contiene la contraseña en ningún campo

#### Scenario: Reenviar la lista no borra la contraseña

- **WHEN** se envía un `PUT /api/trunks` con una troncal sin campo de contraseña
- **THEN** la troncal conserva la contraseña que ya tenía guardada

#### Scenario: Se cambia la contraseña

- **WHEN** se envía un `PUT /api/trunks` con una contraseña nueva para una troncal existente
- **THEN** la contraseña guardada se sustituye por la nueva

### Requirement: Dos modos de autenticación de troncal

El sistema SHALL soportar los dos modos de autenticación que usan los proveedores SIP.
Autentican de formas incompatibles, y elegir mal deja al usuario sin poder conectar la troncal
que ha contratado.

#### Scenario: Troncal que exige registro

- **WHEN** una troncal se guarda en modo `register` con usuario y contraseña
- **THEN** la configuración generada incluye su registro y su autenticación de salida

#### Scenario: Troncal autenticada por IP

- **WHEN** una troncal se guarda en modo `identify` con una IP de origen
- **THEN** la configuración generada identifica al proveedor por esa IP y no incluye credenciales

### Requirement: El motor es dueño exclusivo de los ficheros que genera

El sistema SHALL escribir su configuración en ficheros propios que reescribe enteros, y MUST NOT
modificar el contenido de los ficheros que mantiene el dueño de la máquina. Las extensiones
escritas a mano tienen que sobrevivir a cualquier cambio de troncales.

#### Scenario: Regenerar no destruye lo escrito a mano

- **WHEN** se guarda un cambio de troncales
- **THEN** los ficheros generados se reescriben enteros y las secciones escritas a mano en
  `pjsip.conf` siguen intactas

#### Scenario: Los ficheros generados son desechables

- **WHEN** un fichero generado se borra y el motor vuelve a arrancar
- **THEN** el fichero se regenera con el mismo contenido a partir de la base de datos

### Requirement: El enganche con Asterisk no requiere edición manual

El sistema SHALL funcionar sobre la configuración de Asterisk versionada en el repositorio, sin
que el usuario tenga que editar ningún fichero para que una troncal dada de alta entre en
servicio. La línea que carga el fichero generado y el contexto de dialplan al que apuntan las
troncales son constantes: se commitean, no se generan.

#### Scenario: Una troncal recién dada de alta entra en servicio

- **WHEN** se guarda una troncal sobre una instalación recién clonada
- **THEN** Asterisk la carga sin que nadie haya editado un fichero de configuración

#### Scenario: El contexto de dialplan ya está

- **WHEN** Asterisk arranca con la configuración del repositorio
- **THEN** el contexto al que apuntan las troncales existe y entrega las llamadas a Stasis

### Requirement: Los cambios se aplican a Asterisk o no se dan por buenos

El sistema SHALL recargar Asterisk como parte de la operación de guardado, y SHALL fallar de
forma visible si la recarga no sale. Guardar en la base y que Asterisk se quede con la
configuración vieja produce un fallo silencioso: la troncal no registra y nada lo dice.

#### Scenario: Cambio aplicado

- **WHEN** se guarda un cambio de troncales y la recarga de Asterisk tiene éxito
- **THEN** la respuesta es correcta y la nueva configuración está activa

#### Scenario: La recarga falla

- **WHEN** se guarda un cambio de troncales y Asterisk no puede recargar
- **THEN** la petición responde con error e informa de qué ha fallado

### Requirement: El estado real de la troncal es visible

El sistema SHALL consultar a Asterisk el estado de cada troncal y exponerlo. Lo que el motor
cree que hay configurado y lo que Asterisk tiene cargado pueden divergir, y el usuario tiene que
poder confirmar sin entrar por SSH que lo que guardó se aplicó.

#### Scenario: Troncal reconocida por Asterisk

- **WHEN** se listan las troncales y Asterisk conoce el endpoint correspondiente
- **THEN** la troncal se devuelve con su estado real

#### Scenario: Troncal que Asterisk no conoce

- **WHEN** se listan las troncales y Asterisk no tiene ese endpoint
- **THEN** la troncal se devuelve marcada como desconocida en vez de omitirse

#### Scenario: Asterisk no responde

- **WHEN** se listan las troncales y Asterisk no está disponible
- **THEN** las troncales guardadas se devuelven igualmente, con el estado sin determinar

### Requirement: La API no se expone fuera de la máquina

Desde este cambio la base contiene credenciales SIP. El sistema MUST NOT aceptar conexiones
desde fuera de la propia máquina; el acceso remoto se hace por túnel SSH, que aporta la
autenticación.

#### Scenario: Acceso local

- **WHEN** se hace una petición a la API desde la propia máquina
- **THEN** la petición se atiende con normalidad

#### Scenario: Acceso desde la red

- **WHEN** se intenta conectar a la API desde otra máquina de la red
- **THEN** la conexión no se establece

### Requirement: Una troncal declara por qué protocolo habla

El sistema SHALL permitir elegir el protocolo de transporte de cada troncal entre los que la
instalación tiene configurados, y MUST tratarlo como un eje independiente del modo de
autenticación. Hay proveedores que anuncian UDP y no lo atienden, y el síntoma —los registros salen
y no vuelve nada— es indistinguible de un problema de red, de NAT o de credenciales.

#### Scenario: Una troncal que habla por TCP

- **WHEN** se guarda una troncal declarando transporte TCP
- **THEN** la configuración generada la hace hablar por TCP, tanto al registrarse como al llamar

#### Scenario: Las cuatro combinaciones son legítimas

- **WHEN** se guarda una troncal con cualquier combinación de modo de autenticación y transporte
- **THEN** se acepta, porque cómo se autentica y por dónde habla son cosas distintas

#### Scenario: Una troncal anterior a este cambio

- **WHEN** se lee una troncal dada de alta antes de que el transporte se pudiera elegir
- **THEN** se comporta exactamente igual que antes, sin que se le atribuya un transporte

#### Scenario: Un transporte que no existe

- **WHEN** se envía una troncal con un transporte que la instalación no tiene configurado
- **THEN** la petición se rechaza y no se genera configuración

#### Scenario: El transporte se elige desde el editor

- **WHEN** se da de alta una troncal desde el editor
- **THEN** el transporte se elige junto al modo de autenticación, sin editar ficheros

### Requirement: La configuración generada no depende de cómo la lea Asterisk

El sistema MUST escribir la configuración de forma que Asterisk la interprete entera, escapando lo
que su formato trate como sintaxis propia. En un fichero de Asterisk el punto y coma abre un
comentario, así que un parámetro de URI sin escapar se descarta en silencio: la configuración carga
sin quejarse y hace algo distinto de lo que dice.

#### Scenario: Un parámetro de URI en la configuración generada

- **WHEN** la configuración generada incluye una URI con parámetros
- **THEN** el parámetro queda escapado de forma que Asterisk lo lea como parte de la URI y no como
  un comentario

#### Scenario: Asterisk carga lo que se le escribió

- **WHEN** se guarda una troncal con transporte y Asterisk recarga
- **THEN** el transporte que aplica es el que se eligió, y no el de por defecto

