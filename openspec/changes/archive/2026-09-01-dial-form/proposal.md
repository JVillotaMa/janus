## Why

El destino de un nodo `dial` es texto libre, y su sintaxis no perdona. Dos errores reales de esta
misma tarde:

```
JSIP/ana                                     ← falta la P. Publicado y en producción
PJSIP/+1000000000@sip.rtc.elevenlabs.io:5060 ← "endpoint ... was not found"
```

El segundo es el que enseña dónde está el problema: lo que va después del `@` **no es un host, es
el nombre de un endpoint de PJSIP**, y no hay forma de saberlo mirando el campo. El primero es
peor, porque no falla al publicar: el `originate` no encuentra el endpoint, el nodo devuelve
`dial: "failed"`, la arista por defecto cuelga, y en la traza se ve igual que si hubieran colgado
ellos.

Y ahora que las llamadas salen por troncales de verdad —un operador, un agente de IA— ese campo
deja de ser cosa de un flujo de laboratorio.

## What Changes

**El motor**

- `src/endpoint.ts`: leer y escribir un destino de PJSIP. `PJSIP/ana` y
  `PJSIP/+1000000000@eleven` se parten en `{recurso, troncal}` y se vuelven a componer.
- `validate.ts` avisa cuando un `dial` sale por una troncal que no está dada de alta. Es la misma
  comprobación que ya tiene el nodo de entrada, que al `dial` le falta — y en el `dial` importa
  más, porque ahí la troncal no es documentación: es lo que enruta.

**El editor**

- El destino se elige, no se escribe: extensión interna, o destino más troncal de un desplegable.
  El `PJSIP/` deja de teclearlo nadie.
- `Trunks.jsx` se parte para que su selector —con su estado en Asterisk y su **`+ nueva troncal`**—
  lo usen los dos nodos que necesitan una troncal, en vez de duplicarlo.
- El nodo sigue guardando **un solo campo** `endpoint` con la cadena compuesta. La cadena es cómo
  se guarda; el par es cómo se edita.
- Un destino que no cabe en el formulario —`PJSIP/eleven/sip:x@host`, un `Local/`— se enseña como
  texto editable, sin deformarlo.

**Fuera de alcance** (deliberado, no olvidado)

- Allowlist de destinos y tope de gasto. Van en `outbound-limits`, y tienen que estar **antes de
  dar de alta la troncal de un operador**: la exposición la trae el operador, no este formulario.
- Comprobar contra Asterisk que el destino existe. Solo se comprueba la troncal.
- Llamar a varios destinos a la vez.
- Cambiar la tecnología: siempre `PJSIP`. `chan_sip` está muerto desde Asterisk 21.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `visual-flow-editing`: el campo de destino de un `dial` pasa a tener control propio, declarado en
  el esquema, en vez del control genérico de texto. Y el grafo gana una comprobación que no tenía:
  un `dial` que sale por una troncal inexistente avisa al publicar.

## Impact

**Código**

| Fichero | Qué le pasa |
|---|---|
| `src/endpoint.ts` | nuevo: leer y escribir un destino de PJSIP |
| `src/schema.ts` | `dial.endpoint` declara `control: 'endpoint'` |
| `src/validate.ts` | avisa si la troncal del `dial` no existe |
| `ui/src/Trunks.jsx` | se parte: el selector sale a `TrunkPicker` |
| `ui/src/EndpointField.jsx` | nuevo: interna o por troncal, componiendo la cadena |
| `ui/src/NodeForm.jsx` | el control `endpoint` usa el campo nuevo |

**Datos**

Ninguno. El nodo sigue guardando `config.endpoint` como la misma cadena de siempre, así que las 18
versiones publicadas se leen y se editan sin tocar nada.

**Dependencias**

Ninguna.
