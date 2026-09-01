## ADDED Requirements

### Requirement: El destino de una llamada se elige, no se teclea

El sistema SHALL ofrecer el destino de un nodo que llama como una elección entre una extensión
interna y un destino a través de una troncal dada de alta, y MUST NOT exigir escribir la sintaxis
de un destino de Asterisk. Esa sintaxis tiene una trampa que no se ve: lo que va tras la arroba es
el nombre de un endpoint configurado, no la dirección de un servidor.

#### Scenario: Se llama a una extensión interna

- **WHEN** se configura un nodo de llamada hacia una extensión interna
- **THEN** se indica solo la extensión, sin escribir la tecnología ni ninguna arroba

#### Scenario: Se llama por una troncal

- **WHEN** se configura un nodo de llamada hacia un destino a través de una troncal
- **THEN** la troncal se elige de entre las dadas de alta y el destino se escribe aparte

#### Scenario: Se da de alta la troncal sin salir del nodo

- **WHEN** se configura un nodo de llamada y la troncal que hace falta todavía no existe
- **THEN** se puede dar de alta desde el mismo sitio, igual que desde el nodo de entrada

#### Scenario: El flujo guarda un solo destino

- **WHEN** se guarda un nodo de llamada configurado con destino y troncal
- **THEN** el flujo guarda un único campo de destino, con el mismo formato que ya usaban las
  versiones publicadas antes de este cambio

#### Scenario: Un destino que el formulario no representa

- **WHEN** se abre un nodo de llamada cuyo destino no encaja en la elección que ofrece el formulario
- **THEN** el destino se puede seguir editando como texto y no se modifica solo

### Requirement: Un nodo que llama por una troncal inexistente se avisa al publicar

El sistema SHALL avisar cuando un nodo de llamada salga por una troncal que no está dada de alta, y
MUST hacerlo al validar el flujo y no durante la llamada. Sin ese aviso el fallo es mudo: la llamada
no se establece, el nodo sigue por su arista por defecto, y en el recorrido se ve igual que si
hubieran colgado.

#### Scenario: La troncal no existe

- **WHEN** se valida un flujo con un nodo que llama por una troncal que no está dada de alta
- **THEN** se produce un aviso que nombra el nodo y la troncal

#### Scenario: La troncal existe

- **WHEN** se valida un flujo con un nodo que llama por una troncal dada de alta
- **THEN** no se produce ningún aviso por este motivo

#### Scenario: Una extensión interna no necesita troncal

- **WHEN** se valida un flujo con un nodo que llama a una extensión interna
- **THEN** no se produce ningún aviso por no haber troncal

#### Scenario: El aviso no impide publicar

- **WHEN** se publica un flujo cuyo único problema es que una troncal todavía no está dada de alta
- **THEN** el flujo se publica, porque dar de alta la troncal después es un orden de trabajo válido
