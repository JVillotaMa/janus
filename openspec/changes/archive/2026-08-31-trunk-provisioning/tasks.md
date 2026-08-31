## 0. Verificación previa

Bloquea todo lo demás: si la recarga por ARI no existe, el diseño de la fase 2 cambia.

- [x] 0.1 Levantar el laboratorio de Asterisk y confirmar que ARI responde
- [x] 0.2 Comprobar que `PUT /ari/asterisk/modules/res_pjsip` recarga el módulo
- [x] 0.3 Confirmar que `ari-client` expone el método de recarga tras conectar (genera su API
      desde el Swagger que descarga de Asterisk)

## 1. La base, sin tocar Asterisk

- [x] 1.1 `server.ts`: escuchar solo en `127.0.0.1`, con comentario `ponytail:` marcando el
      techo (el día que la UI se abra sin túnel SSH toca token de verdad)
- [x] 1.2 `store.ts`: tabla `trunks` (nombre, host, modo, usuario, contraseña, IP)
- [x] 1.3 `store.ts`: leer y escribir la colección entera, conservando la contraseña de las
      troncales que llegan sin ella
- [x] 1.4 Test de la tabla: alta, borrado por omisión, contraseña conservada, contraseña
      sustituida
- [x] 1.5 `server.ts`: ruta `GET/PUT /api/trunks`, sin devolver nunca la contraseña
- [x] 1.6 `src/pjsip.ts`: función pura que genera el texto de `pjsip_janus.conf` a partir de las
      troncales, con los dos modos (`register` e `identify`) y cabecera de "generado, no editar"
- [x] 1.7 `src/pjsip.ts`: el texto fijo de `extensions_janus.conf` con el contexto `[janus]` y
      `Stasis(janus,${EXTEN})`
- [x] 1.8 Test del generador: los dos modos, varias troncales, ninguna troncal

## 2. El enganche con Asterisk

- [x] 2.1 Escribir los dos ficheros generados en el directorio de configuración de Asterisk, con
      permisos restrictivos
- [x] 2.2 Versionar la configuración de Asterisk en `asterisk-config/etc/`, con la línea
      `#include pjsip_janus.conf` y el contexto `[janus]` ya escritos, y el fichero generado
      fuera de git por llevar contraseñas
- [x] 2.3 Recargar `res_pjsip` por ARI tras cada cambio de troncales; si la recarga falla, el PUT
      responde error y lo explica
- [x] 2.4 `GET /api/trunks`: añadir el estado real de cada troncal consultando
      `GET /endpoints/PJSIP/{name}`, degradando a "sin determinar" si Asterisk no responde
- [x] 2.5 Prueba manual: dar de alta una troncal por `curl` y verla en `pjsip show endpoints`
      dentro del contenedor

## 3. El grafo

- [x] 3.1 `nodes.ts`: tipo `entry` como función vacía
- [x] 3.2 `validate.ts`: error si no hay exactamente un `entry`, si `flow.start` no apunta a él,
      o si alguna arista termina en él
- [x] 3.3 `validate.ts`: aviso si el `entry` nombra una troncal que no existe
- [x] 3.4 Test de validación: las tres reglas y el aviso
- [x] 3.5 Test del intérprete: el `entry` no toca el canal, ramifica por sus aristas y aparece
      como primer paso de la traza
- [x] 3.6 `flow.json` semilla: añadir el nodo `entry` delante, mover a sus aristas la
      ramificación por horario y conservar el `say` de bienvenida
- [x] 3.7 Publicar el flujo migrado como versión nueva, dejando intactas las anteriores

## 4. La UI

- [x] 4.1 Nodo `entry` como tipo propio de React Flow, con handle solo de salida
- [x] 4.2 `onNodeDoubleClick` abriendo el modal
- [x] 4.3 Componente de formulario del `entry`: selector de troncal y su estado
- [x] 4.4 Alta y edición de troncales desde ese formulario, con los campos de los dos modos
- [x] 4.5 Mostrar en el modal la configuración generada, en solo lectura
- [x] 4.6 Comprobar que los demás nodos siguen editándose con el editor de JSON

## 5. Cierre

- [x] 5.1 Resolver las preguntas abiertas del diseño: codecs por defecto, `from_user`, permisos
      del fichero generado y qué se hace con `exten => 100`
- [x] 5.2 `pnpm test` y `pnpm typecheck` en verde
- [x] 5.3 Prueba de extremo a extremo: una llamada real entrando por el contexto `janus` que
      recorre el flujo migrado y deja su traza
- [x] 5.4 Actualizar `AGENTS.md` y `README.md`: el dialplan real, los ficheros nuevos, las rutas
      de la API, el número de tests y que el grafo ya no vive en `flow.json`
