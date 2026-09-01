# visual-flow-editing Specification

## Purpose
TBD - created by archiving change node-forms. Update Purpose after archive.
## Requirements
### Requirement: El motor declara qué campos tiene cada tipo de nodo

El sistema SHALL mantener una declaración única de los campos de configuración de cada tipo de
nodo —nombre, tipo de dato, unidad, obligatoriedad y valor por defecto— y de las variables que ese
tipo deja disponibles al salir de él. Hoy ese vocabulario solo existe dentro del cuerpo de cada
implementación, así que nada fuera del motor puede saberlo sin leer el código.

#### Scenario: El editor sabe qué pedir sin preguntarle a la API

- **WHEN** el editor construye el formulario de un tipo de nodo
- **THEN** los campos que pinta salen de la misma declaración que usa el motor, sin ninguna ruta
  de API nueva

#### Scenario: El valor por defecto es uno solo

- **WHEN** se crea un nodo sin tocar un campo que tiene valor por defecto
- **THEN** el valor que asume el motor al ejecutarlo es el mismo que declaraba el formulario

#### Scenario: Un campo con unidad la lleva declarada

- **WHEN** se declara un campo cuyo valor es una duración
- **THEN** la declaración dice en qué unidad se expresa, y tipos distintos pueden usar unidades
  distintas para un campo con el mismo nombre

### Requirement: La configuración de un nodo se rechaza si no cumple su esquema

El sistema SHALL comprobar la configuración de cada nodo contra la declaración de su tipo antes de
aceptar un flujo, y SHALL tratar un campo obligatorio ausente como error, no como aviso. Un nodo
al que le falta un campo obligatorio no es un estado intermedio de edición: es una llamada real que
termina en `error`.

#### Scenario: Falta un campo obligatorio

- **WHEN** se publica un flujo con un nodo al que le falta un campo obligatorio de su tipo
- **THEN** la publicación se rechaza con un error que nombra el nodo y el campo

#### Scenario: Un campo con el tipo equivocado

- **WHEN** se publica un flujo con un campo cuyo valor no es del tipo declarado
- **THEN** la publicación se rechaza con un error que nombra el nodo y el campo

#### Scenario: Un campo que el tipo no declara

- **WHEN** se publica un flujo con un nodo que lleva un campo que su tipo no declara
- **THEN** se produce un aviso y el flujo se puede publicar

#### Scenario: Los flujos ya publicados siguen siendo válidos

- **WHEN** se carga en el editor una versión publicada antes de existir esta comprobación y se
  vuelve a publicar
- **THEN** pasa la comprobación y se publica sin errores

### Requirement: Los nodos se crean eligiendo su tipo de una lista

El sistema SHALL ofrecer la creación de un nodo como una elección entre los tipos que el motor sabe
ejecutar, y SHALL crear el nodo ya con los valores por defecto de ese tipo. Escribir el tipo a mano
permite escribir uno que no existe, que es un error que solo aparece al publicar.

#### Scenario: Se elige el tipo al crear

- **WHEN** se pide crear un nodo
- **THEN** aparece la lista de tipos disponibles y al elegir uno se crea un nodo de ese tipo

#### Scenario: El nodo nace utilizable

- **WHEN** se crea un nodo de un tipo que tiene campos con valor por defecto
- **THEN** el nodo se crea con esos valores ya puestos

#### Scenario: La entrada no se puede crear

- **WHEN** se mira la lista de tipos disponibles para crear
- **THEN** el tipo de entrada no aparece, porque tiene que haber exactamente uno y ya existe

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

### Requirement: El tipo de un nodo se cambia sin rehacerlo

El sistema SHALL permitir cambiar el tipo de un nodo existente conservando los campos cuyo nombre
también existe en el tipo nuevo, y SHALL informar de los campos que se descartan al hacerlo.
Descartar configuración sin decirlo es una pérdida silenciosa de trabajo.

#### Scenario: Se cambia el tipo

- **WHEN** se cambia el tipo de un nodo
- **THEN** el nodo pasa a ser del tipo nuevo y sus aristas siguen conectadas como estaban

#### Scenario: Se conserva lo que coincide

- **WHEN** se cambia un nodo a un tipo que declara un campo con el mismo nombre
- **THEN** el valor de ese campo se conserva

#### Scenario: Se avisa de lo que se pierde

- **WHEN** se cambia un nodo a un tipo que no declara alguno de sus campos actuales
- **THEN** esos campos se descartan y se informa de cuáles han sido

#### Scenario: La entrada no se convierte

- **WHEN** se selecciona el nodo de entrada
- **THEN** su tipo no se puede cambiar, y ningún otro nodo se puede convertir en entrada

### Requirement: Las condiciones de una arista se construyen, no se escriben

El sistema SHALL ofrecer la construcción de la condición de una arista como grupos de comparaciones
—cada grupo con su unión, Y u O, y con la posibilidad de estar negado— y MUST NOT exigir escribir
jsonlogic. Anidar un grupo dentro de otro es lo que permite mezclar Y y O sin ambigüedad de
precedencia.

#### Scenario: Una arista sin condición

- **WHEN** se edita una arista y se indica que no tiene condición
- **THEN** la arista queda sin condición y siempre se toma

#### Scenario: Una comparación suelta

- **WHEN** se construye una condición con una sola comparación
- **THEN** la arista guarda esa comparación, sin envolverla en ningún grupo

#### Scenario: Varias comparaciones unidas

- **WHEN** se construye un grupo con varias comparaciones y se elige si se cumplen todas o alguna
- **THEN** la arista guarda esa unión con todas sus comparaciones

#### Scenario: Se mezclan Y y O

- **WHEN** se mete un grupo dentro de otro con una unión distinta
- **THEN** la condición guardada respeta ese anidamiento y la etiqueta de la arista lo refleja

#### Scenario: Un grupo negado

- **WHEN** se marca un grupo como negado
- **THEN** la condición guardada niega ese grupo entero

#### Scenario: Solo se ofrecen operadores que el editor sabe leer

- **WHEN** se elige el operador de una comparación
- **THEN** solo se ofrecen operadores que el editor sabe traducir a la etiqueta de la arista

### Requirement: Cada arista ofrece las variables que existen en ese punto del flujo

El sistema SHALL ofrecer, al construir la condición de una arista, las variables que la llamada
tiene disponibles al salir del nodo de origen, y SHALL ofrecer sus valores como elección cerrada
cuando el esquema los declare. Una condición sobre una variable que en ese punto no existe no casa
nunca, y nada lo dice.

#### Scenario: Las variables de la llamada están siempre

- **WHEN** se construye la condición de una arista cualquiera
- **THEN** se ofrecen las variables que la llamada tiene desde que entra

#### Scenario: Las variables del nodo de origen

- **WHEN** se construye la condición de una arista que sale de un nodo que produce variables
- **THEN** se ofrecen además las variables que ese nodo deja al salir

#### Scenario: No se ofrece lo que todavía no existe

- **WHEN** se construye la condición de una arista que sale de un nodo que no produce variables
- **THEN** no se ofrecen las variables que producen otros tipos de nodo

#### Scenario: Valores cerrados

- **WHEN** se compara una variable cuyo esquema declara un conjunto cerrado de valores
- **THEN** el valor se elige de entre esos y no se escribe a mano

### Requirement: Una condición que el constructor no sabe representar se muestra sin tocarla

El sistema MUST NOT convertir en una aproximación una condición que no puede representar en el
constructor, y SHALL mostrarla tal cual, sin permitir editarla. Reabrir una condición como algo
parecido pero distinto cambia por dónde va una llamada real y no lo avisa nadie.

#### Scenario: Una condición fuera del vocabulario

- **WHEN** se abre una arista cuya condición usa algo que el constructor no ofrece
- **THEN** se muestra la condición tal y como está guardada, en solo lectura, diciendo que no cabe
  en el formulario

#### Scenario: No se deforma al guardar

- **WHEN** se edita otra cosa de una arista cuya condición no cabe en el constructor
- **THEN** la condición se guarda exactamente igual que estaba

### Requirement: Los nodos se nombran, y el nombre no es su identificador

El sistema SHALL permitir dar y cambiar un nombre a cada nodo, MUST generar su identificador sin
intervención del usuario, y MUST NOT permitir editar ese identificador. Cuando el identificador
hace también de rótulo, renombrar significa romper las aristas que lo referencian.

#### Scenario: Se nombra un nodo

- **WHEN** se escribe el nombre de un nodo
- **THEN** el nombre se guarda en el flujo y aparece como rótulo del nodo

#### Scenario: Se renombra sin romper nada

- **WHEN** se cambia el nombre de un nodo que tiene aristas
- **THEN** las aristas siguen conectadas y el flujo sigue siendo válido

#### Scenario: Los identificadores no colisionan

- **WHEN** se crean nodos después de haber borrado otros
- **THEN** cada nodo nuevo recibe un identificador que no coincide con ninguno existente

#### Scenario: Un nodo sin nombre se rotula igual

- **WHEN** se mira un nodo al que nadie ha puesto nombre
- **THEN** se rotula con su tipo y un resumen de su configuración, nunca con su identificador

#### Scenario: Dos nodos con el mismo nombre

- **WHEN** se publica un flujo con dos nodos que se llaman igual
- **THEN** se produce un aviso y el flujo se puede publicar

#### Scenario: El motor ignora el nombre

- **WHEN** una llamada recorre un flujo cuyos nodos tienen nombre
- **THEN** el nombre no interviene en ninguna decisión de enrutado ni se guarda en la traza

### Requirement: La traza se rotula con el flujo de la versión que recorrió la llamada

El sistema SHALL traducir cada paso de la traza a su rótulo usando el grafo de la versión con la
que corrió esa llamada, y MUST NOT usar el flujo actual para rotularla. Un identificador generado
no dice nada, y rotularlo con el flujo de ahora atribuiría a una llamada pasada nombres que
entonces no existían.

#### Scenario: Se lee una traza

- **WHEN** se mira el recorrido de una llamada que guardó su versión
- **THEN** cada paso se ve con el rótulo que ese nodo tenía en esa versión

#### Scenario: Renombrar no reescribe el pasado

- **WHEN** se renombra un nodo, se publica, y después se mira una llamada anterior a esa publicación
- **THEN** su traza sigue mostrando el rótulo que el nodo tenía cuando esa llamada pasó por él

#### Scenario: Una llamada sin versión conocida

- **WHEN** se mira el recorrido de una llamada que no guardó su versión
- **THEN** sus pasos se muestran tal cual están guardados, sin atribuirles rótulos de ningún grafo

#### Scenario: También fuera del editor

- **WHEN** se listan las últimas llamadas desde la línea de comandos
- **THEN** su recorrido se muestra rotulado igual que en el editor

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

