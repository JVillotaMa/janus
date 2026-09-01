## 1. El motor

- [x] 1.1 `src/endpoint.ts`: `parseEndpoint(str)` devuelve `{resource, trunk}` o `null` si el
      formulario no lo representa —la forma de URI explícita, una tecnología que no sea PJSIP, o
      algo sin barra. `null` es "no cabe", nunca una aproximación
- [x] 1.2 `src/endpoint.ts`: `formatEndpoint({resource, trunk})` compone `PJSIP/x` o `PJSIP/x@t`.
      La arroba se parte por la última, no por la primera
- [x] 1.3 `src/schema.ts`: `dial.endpoint` declara `control: 'endpoint'`
- [x] 1.4 `src/validate.ts`: aviso cuando la troncal de un `dial` no está dada de alta, nombrando
      nodo y troncal. Aviso y no error: montar el flujo antes que la troncal es orden válido
- [x] 1.5 Test: ida y vuelta de las formas que sí caben, y `null` para las que no
- [x] 1.6 Test: el aviso salta con troncal inexistente, calla con una dada de alta, y calla con una
      extensión interna
- [x] 1.7 Test: los destinos de `flow.json` y de las versiones publicadas se siguen leyendo

## 2. El editor

- [x] 2.1 `ui/src/Trunks.jsx`: sacar `TrunkPicker` —desplegable, estado en Asterisk y
      `+ nueva troncal`— con `value` y `onChange` sobre un nombre de troncal
- [x] 2.2 `ui/src/Trunks.jsx`: el formulario del nodo `entry` pasa a usar `TrunkPicker`, sin
      cambiar lo que hace
- [x] 2.3 `ui/src/EndpointField.jsx`: elegir entre extensión interna y destino por troncal,
      componiendo la cadena con `formatEndpoint`
- [x] 2.4 `ui/src/EndpointField.jsx`: un destino que no cabe se edita como texto, con su aviso
- [x] 2.5 `ui/src/NodeForm.jsx`: el control `endpoint` usa `EndpointField`
- [x] 2.6 Test jsdom: elegir troncal y destino compone la cadena esperada
- [x] 2.7 Test jsdom: una extensión interna no mete arroba
- [x] 2.8 Test jsdom: un destino que no cabe se pinta como texto y no se toca solo
- [x] 2.9 Test jsdom: el nodo de entrada sigue funcionando igual tras el reparto
- [x] 2.10 `NodeForm.jsx`: la rama `control: 'trunk'`, que estaba declarada en el esquema y no
      leía nadie; fuera la prop `fields` y el caso especial del `entry` en `App.jsx`

## 3. Cierre

- [x] 3.1 `pnpm test` y `pnpm typecheck` en verde
- [x] 3.2 Actualizar `AGENTS.md`: la trampa del `@`, y que el `dial` ya avisa de la troncal
- [ ] 3.3 Prueba a mano: dar de alta `eleven`, montar el `dial` desde el formulario y llamar
