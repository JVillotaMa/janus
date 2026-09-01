## 1. La configuración de Asterisk

- [x] 1.1 `asterisk-config/etc/pjsip.conf`: `[transport-tcp]` junto al `[transport-udp]`, los dos
      en el 5060. Commiteado, no generado: es una constante

## 2. El motor

- [x] 2.1 `src/types.ts`: `Trunk.transport?: 'udp' | 'tcp'`, documentado como eje independiente del
      modo de autenticación
- [x] 2.2 `src/pjsip.ts`: emite `transport=transport-<x>` en el endpoint y en la registración, y el
      parámetro `\;transport=<x>` en las URIs. Sin transporte declarado no emite nada
- [x] 2.3 `src/store.ts`: columna `transport` en `trunks`, con migración por `PRAGMA table_info`.
      Sale a un helper: es la segunda tabla que la necesita
- [x] 2.4 `src/server.ts`: rechaza un transporte que no sea `udp` ni `tcp`
- [x] 2.5 Test: el texto generado lleva la línea y el parámetro escapado, y el `;` va con barra
- [x] 2.6 Test: una troncal sin transporte genera exactamente el mismo texto que antes
- [x] 2.7 Test: la columna se migra sobre una base vieja sin perder troncales, y arrancar dos veces
      no falla
- [x] 2.8 Test: la API rechaza un transporte inventado
- [x] 2.9 `src/server.ts`: el host se valida contra una lista de permitidos. Con el campo de
      transporte aparte, un `;transport=` escrito en el host genera una URI que Asterisk carga a
      medias y en silencio — visto en la troncal real del dueño

## 3. El editor

- [x] 3.1 `ui/src/Trunks.jsx`: selector de transporte en el alta, al lado del modo
- [x] 3.2 Test jsdom: se puede elegir transporte y viaja en el PUT

## 4. Cierre

- [x] 4.1 `pnpm test` y `pnpm typecheck` en verde
- [x] 4.2 `AGENTS.md`: los dos transportes, y la trampa del `;` en los ficheros de Asterisk
- [x] 4.3 Troncal de Eleven en TCP: el registro pasó de no recibir respuesta por UDP a un `405
      Method Not Allowed` por TCP — contestan, y lo que no admiten es REGISTER