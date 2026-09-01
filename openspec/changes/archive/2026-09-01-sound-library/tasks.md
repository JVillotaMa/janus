## 1. El motor: sanear, convertir y listar

- [x] 1.1 `src/sounds.ts`: `soundName(raw)` sanea a `[a-z0-9_-]` —sin acentos, sin extensión, sin
      mayúsculas— y devuelve `null` si no queda nada. Lista de permitidos, nunca de prohibidos
- [x] 1.2 `src/sounds.ts`: `saveSound(dir, name, bytes)` escribe el subido a un temporal, lo pasa
      por ffmpeg a alaw 8 kHz mono dentro de `<dir>/en/janus/`, y borra el temporal pase lo que pase
- [x] 1.3 `src/sounds.ts`: un ffmpeg que no está o que falla se propaga como error con mensaje
      legible, distinguiendo "falta ffmpeg" de "esto no es audio"
- [x] 1.4 `src/sounds.ts`: `listSounds(dir)` devuelve los de `janus/` con nombre, bytes y segundos
      —que en alaw 8 kHz mono son los bytes entre 8000
- [x] 1.5 Test: el saneado, con separadores de ruta, `..`, acentos, mayúsculas, espacios, cadena
      vacía y solo símbolos
- [x] 1.6 Test: guardar y listar sobre un tmpdir, comprobando que el fichero cae dentro del
      directorio y que los de al lado no se tocan. Se salta con aviso si no hay ffmpeg

## 2. La API

- [x] 2.1 `src/server.ts`: puerto `Sounds` (`list`, `save`) que recibe `serveApi`, como ya recibe
      `Provisioner`; así los tests corren sin ffmpeg
- [x] 2.2 `src/server.ts`: `GET /api/sounds` devuelve la lista
- [x] 2.3 `src/server.ts`: `PUT /api/sounds/<nombre>` con el fichero en el cuerpo crudo; responde
      con el nombre saneado y la referencia `sound:janus/<nombre>`
- [x] 2.4 `src/server.ts`: el cuerpo se corta al pasar de 10 MB **mientras se lee**, respondiendo
      413. Nunca fiándose de `content-length`
- [x] 2.5 `src/server.ts`: un nombre que se queda vacío al sanear responde 400
- [x] 2.6 `src/server.ts`: actualizar el comentario `ponytail:` del techo de rutas — son siete a
      propósito, y decir por qué la octava sí obliga a migrar
- [x] 2.7 `src/main.ts`: ata el directorio de sonidos (`ASTERISK_SOUNDS`, por defecto el del
      laboratorio) y le pasa el puerto a `serveApi`
- [x] 2.8 Test: subir, listar, el límite de tamaño, el nombre vacío y el fallo de conversión, todo
      con el puerto de mentira

## 3. El editor

- [x] 3.1 `src/schema.ts`: `say.media` y `gather.media` declaran `control: 'sound'`
- [x] 3.2 `ui/src/SoundField.jsx`: el texto sigue siendo el valor; debajo, un selector de fichero
      del sistema y un desplegable con los ya subidos
- [x] 3.3 `ui/src/SoundField.jsx`: subir manda el fichero a `PUT /api/sounds/<nombre>` y escribe en
      el campo lo que responda el motor, sin adivinar el nombre saneado
- [x] 3.4 `ui/src/SoundField.jsx`: mientras sube lo dice, y si falla enseña el error del motor
- [x] 3.5 `ui/src/NodeForm.jsx`: un campo con `control: 'sound'` usa `SoundField`; el resto siguen
      con el control genérico
- [x] 3.6 Test jsdom: elegir un fichero sube y deja el campo apuntando al audio
- [x] 3.7 Test jsdom: se puede seguir escribiendo a mano un audio de serie
- [x] 3.8 Test jsdom: un error de subida se enseña y el campo no cambia

## 4. Cierre

- [x] 4.1 `pnpm test` y `pnpm typecheck` en verde
- [x] 4.2 Actualizar `AGENTS.md`: el motor escribe en DOS sitios, no en uno; la séptima ruta; y
      ffmpeg como requisito
- [x] 4.3 Actualizar `README.md`: ffmpeg en la puesta a punto, junto a la descarga de los audios
- [x] 4.4 Subido `carlso` (4,7s) desde el editor, y sonó en la llamada de las 06:37: el nodo
      "Saludo" reproduce `sound:janus/carlso` y la traza pasa por él