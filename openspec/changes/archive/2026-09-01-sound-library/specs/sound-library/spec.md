## ADDED Requirements

### Requirement: Un audio se sube eligiendo un fichero del sistema

El sistema SHALL aceptar un fichero de audio subido desde el editor y dejarlo disponible para que
un nodo lo reproduzca, sin que nadie tenga que copiarlo a mano en la máquina. Tener que entrar por
SSH para cambiar el saludo deja el flujo a medio construir desde la interfaz.

#### Scenario: Se sube un audio

- **WHEN** se elige un fichero de audio del sistema desde el editor
- **THEN** queda guardado y disponible para referenciarlo desde un nodo

#### Scenario: El campo queda apuntando al audio subido

- **WHEN** termina la subida de un audio
- **THEN** el campo del nodo pasa a referenciarlo, sin que haya que escribir su nombre

#### Scenario: Se listan los audios subidos

- **WHEN** se piden los audios disponibles
- **THEN** se devuelven los que se han subido, con su nombre y su duración

### Requirement: Lo que se sube se convierte a lo que Asterisk sabe reproducir

El sistema SHALL convertir todo audio subido al formato y la frecuencia con los que Asterisk lo
reproduce, sea cual sea el formato de origen, y MUST NOT guardar un audio sin convertir. Un fichero
grabado a 44,1 kHz en estéreo o no suena o suena mal, y el fallo aparecería en una llamada real.

#### Scenario: Se sube un audio de cualquier formato corriente

- **WHEN** se sube un audio en un formato de uso común
- **THEN** se guarda convertido y Asterisk puede reproducirlo

#### Scenario: Un audio que ya venía bien también se convierte

- **WHEN** se sube un audio que ya está en el formato de destino
- **THEN** se convierte igualmente, sin decidir por el contenido de su cabecera

#### Scenario: El fichero no es audio

- **WHEN** se sube un fichero que no se puede interpretar como audio
- **THEN** la subida se rechaza con un error que lo dice, y no se guarda nada

#### Scenario: Falta la herramienta de conversión

- **WHEN** se sube un audio y la máquina no tiene la herramienta de conversión instalada
- **THEN** la respuesta dice que falta, y el resto del motor sigue funcionando

### Requirement: El nombre de un audio no puede escribir fuera de su directorio

El sistema MUST reducir el nombre con que llega un audio a un conjunto acotado de caracteres antes
de usarlo como fichero, y MUST rechazar el que quede vacío al hacerlo. El nombre llega desde fuera y
acaba siendo una ruta en disco.

#### Scenario: Un nombre con separadores de ruta

- **WHEN** se sube un audio cuyo nombre contiene separadores de ruta o referencias al directorio
  padre
- **THEN** el fichero se guarda dentro del directorio de audios y en ningún otro sitio

#### Scenario: Un nombre con espacios y acentos

- **WHEN** se sube un audio cuyo nombre lleva espacios, acentos o mayúsculas
- **THEN** se guarda con un nombre equivalente hecho solo de los caracteres permitidos

#### Scenario: Un nombre que no deja nada

- **WHEN** se sube un audio cuyo nombre no contiene ningún carácter permitido
- **THEN** la subida se rechaza y no se guarda nada

#### Scenario: Se sube dos veces el mismo nombre

- **WHEN** se sube un audio con el nombre de uno que ya existe
- **THEN** se reemplaza el anterior, sin crear un segundo audio con el mismo nombre

### Requirement: Un audio demasiado grande se corta mientras se recibe

El sistema MUST rechazar una subida que pase del tamaño máximo, y MUST decidirlo mientras recibe el
fichero y no después de tenerlo entero. El tamaño que anuncia quien sube no es de fiar, y esperar a
tenerlo todo significa haberlo aceptado ya.

#### Scenario: Un fichero por encima del límite

- **WHEN** se sube un audio que pasa del tamaño máximo
- **THEN** la subida se rechaza indicando el límite, y no se guarda nada

#### Scenario: Un fichero dentro del límite

- **WHEN** se sube un audio que no llega al tamaño máximo
- **THEN** la subida se completa con normalidad

### Requirement: Los audios que trae Asterisk se siguen pudiendo usar

El sistema SHALL permitir que un nodo referencie un audio que no se ha subido desde el editor. Los
audios que Asterisk trae de serie funcionan hoy y son la mitad de los flujos que ya existen.

#### Scenario: Se escribe la referencia de un audio de serie

- **WHEN** se escribe a mano la referencia de un audio que no está entre los subidos
- **THEN** se guarda tal cual y el nodo la reproduce

#### Scenario: La lista no se llena de los de serie

- **WHEN** se miran los audios disponibles para elegir
- **THEN** aparecen los subidos, no el catálogo entero que trae Asterisk

### Requirement: El motor solo escribe en los directorios que son suyos

El sistema MUST escribir los audios subidos en un directorio propio dentro del árbol de sonidos, y
MUST NOT tocar los audios que ya estuvieran ahí. Los audios de serie y cualquier cosa que el dueño
de la máquina haya dejado tienen que sobrevivir a cualquier subida.

#### Scenario: Se sube un audio con audios de serie presentes

- **WHEN** se sube un audio
- **THEN** los que ya había siguen intactos y el nuevo queda en el directorio del motor

#### Scenario: El nombre de un audio subido no tapa a uno de serie

- **WHEN** se sube un audio con el mismo nombre que uno de serie
- **THEN** los dos coexisten y se referencian de forma distinta
