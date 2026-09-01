## Context

Un destino de `dial` es hoy un `<input>` de texto que acaba en `channels.originate({endpoint})`.
La sintaxis de Asterisk para ese campo tiene una trampa que no se ve:

```
PJSIP/ana                     el endpoint se llama "ana"        (escrito a mano en pjsip.conf)
PJSIP/+34600111222@masmovil   llama a +34600111222 POR el endpoint "masmovil"
                                                      └─ nombre de sección, NO un dominio
PJSIP/eleven/sip:x@host:5060  manda a esa URI exacta por el endpoint "eleven"
```

Lo de después del `@` es un nombre de sección de `pjsip.conf`. Poner ahí un dominio da
`endpoint '<dominio>' was not found`, que es literalmente lo que pasó al intentar llamar a un
agente de Eleven.

Estado del que se parte:

- `src/schema.ts` ya sabe declarar campos con control propio: `control: 'sound' | 'trunk'`. Se usa
  para el audio y para la troncal del nodo de entrada.
- `ui/src/Trunks.jsx` es el formulario del nodo `entry`: un desplegable de troncales, el punto de
  estado que dice si Asterisk la reconoce, y un `+ nueva troncal` con su alta completa.
- `src/validate.ts` avisa si la troncal del `entry` no está dada de alta. El `dial` no tiene nada.
- Las troncales se generan con el nombre como nombre de sección (`[eleven]`), que es exactamente lo
  que va después del `@`.

## Goals / Non-Goals

**Goals:**

- Que llamar a un número por una troncal no exija saber la sintaxis de un dial string.
- Que dar de alta la troncal se pueda hacer sin salir del nodo que la va a usar.
- Que un `dial` que sale por una troncal que no existe se sepa al publicar y no en la llamada.
- Que un destino que el formulario no sabe representar se pueda seguir escribiendo.

**Non-Goals:**

- Allowlist de destinos y topes de gasto: `outbound-limits`.
- Preguntarle a Asterisk si el destino existe.
- Varios destinos a la vez.
- Tecnologías que no sean PJSIP.

## Decisions

### 1. El nodo sigue guardando una sola cadena, no dos campos

`config.endpoint` se queda como está: `"PJSIP/+1000000000@eleven"`. El formulario la parte al abrir
y la compone al guardar.

**Alternativa descartada: guardar `{resource, trunk}`.** Cambia la forma del config, así que las 18
versiones publicadas llevarían una forma y las nuevas otra, para siempre — y `nodes.ts` tendría que
componer la cadena en cada llamada. Todo eso para no hacer un `split('@')` en el editor.

Es la misma decisión que el constructor de condiciones: **la cadena es cómo se guarda, el par es
cómo se edita.** Y como allí, la vuelta es parcial y lo dice.

### 2. Lo que no cabe se sigue escribiendo, y no se deforma

`parseEndpoint` devuelve `null` para lo que el formulario no representa: la forma de URI explícita
(`PJSIP/eleven/sip:…`), una tecnología que no es PJSIP (`Local/`), o algo sin la barra. Con `null`,
el campo vuelve a ser un input de texto con un aviso.

Devolver una aproximación sería peor que no ofrecer el formulario: reescribir `PJSIP/eleven/sip:x@h`
como `PJSIP/eleven` cambia a quién llamas sin decirlo.

### 3. El `@` se parte por el último, no por el primero

Un endpoint de PJSIP no lleva `@` en el nombre, y el recurso tampoco debería. Pero si llega algo
raro, partir por el último `@` deja el nombre de troncal entero, que es la parte cuyo error se
diagnostica peor: una troncal mal leída falla con "endpoint not found" y un recurso mal leído falla
donde el proveedor, que al menos te contesta algo.

### 4. `endpoint.ts` es un fichero propio, y son veinte líneas

Podría haber ido en `schema.ts`, al lado de `defaults`. Pero `schema.ts` declara el vocabulario de
los nodos, y esto es sintaxis de dial string de Asterisk: otra familia, y la que va a crecer si
algún día hace falta la forma de URI explícita.

Lo importa `validate.ts` y lo importa la UI, como el esquema.

### 5. El aviso de la troncal es aviso, no error

Un `dial` que sale por una troncal que no existe **va a fallar**, así que la tentación es hacerlo
error. Pero se puede estar editando el flujo antes de dar de alta la troncal, igual que se puede
tener un nodo recién puesto sin aristas, y esos estados intermedios ya son avisos en este
validador. Además el `entry` usa aviso para lo mismo y no hay razón para que se comporten distinto.

Lo que sí cambia respecto al `entry` es la importancia: ahí la troncal es documentación, aquí
enruta. Por eso el mensaje lo dice.

### 6. `Trunks.jsx` se parte, no se duplica

El selector con su estado y su alta ya existe. Sale a `TrunkPicker` y lo usan los dos: el `entry`
para escribir `config.trunk`, y el `dial` como parte del destino.

La alternativa —copiar el desplegable en el campo nuevo— son dos sitios donde arreglar el mismo
fallo, y el `+ nueva troncal`, que es lo que de verdad quieres tener a mano cuando estás montando
un `dial` a un agente, se quedaría solo en el nodo de entrada.

### 7. El nodo de entrada deja de ser un caso especial

Al sacar `TrunkPicker` aparece que `control: 'trunk'` estaba declarado en el esquema desde
`sound-library` y **no lo leía nadie**: el `entry` recibía su formulario ya hecho por una prop
`fields` de `NodeForm`, saltándose el mecanismo de campos entero. Era de cuando era el único nodo
con formulario y los demás eran un `<textarea>` de JSON.

Una declaración que nadie lee es peor que no tenerla, porque dice que el esquema manda y no manda.
Así que `FieldInput` gana la rama `'trunk'`, la prop `fields` desaparece por falta de uso, y los
tres controles propios —audio, destino y troncal— se eligen por la misma regla. El modal de la
entrada sigue usando `Trunks` con `wide`, que es lo único que de verdad es suyo: enseñar la
configuración que el motor le ha escrito a Asterisk.

## Risks / Trade-offs

**[Un destino escrito a mano deja de caber al añadirle el formulario]** → No: si no cabe, el campo
sigue siendo un input de texto. Lo único que se pierde es la comodidad, y solo para las formas raras.

**[El aviso de troncal inexistente puede molestar mientras montas]** → Es aviso, no error: publicar
sigue funcionando. Y desaparece solo en cuanto das de alta la troncal, que es lo que quieres hacer.

**[Partir `Trunks.jsx` toca un componente que funciona]** → Es mover el desplegable a su propio
componente y que el de fuera le pase `value` y `onChange`. Lo cubren los tests de jsdom que ya
existen para el nodo de entrada.

## Migration Plan

**Fase 1 — el motor.** `endpoint.ts` con su ida y vuelta, el `control` en el esquema, y el aviso en
`validate`. Todo con `node --test`.

**Fase 2 — el editor.** `TrunkPicker` fuera de `Trunks.jsx`, `EndpointField.jsx`, y engancharlo.

**Rollback:** el formato del grafo no cambia, así que revertir es revertir ficheros. Un flujo
editado con el formulario lo sigue leyendo el editor de antes.

## Open Questions

Ninguna.

- `ponytail:` la forma de URI explícita (`PJSIP/eleven/sip:…`) se escribe a mano. Si hace falta a
  menudo, crece en `endpoint.ts` y en el formulario, no en otro sitio.
