## ADDED Requirements

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
