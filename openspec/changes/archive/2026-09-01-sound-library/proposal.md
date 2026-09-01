## Why

El campo `media` de un `say` es texto libre: hay que escribir `sound:hello-world` sabiendo de
memoria qué audios existen y cómo se llaman. Y los únicos que existen son los cien y pico que trae
Asterisk de serie, en inglés y con voz de centralita americana. Para poner el saludo de tu empresa
hay que entrar por SSH, dejar el fichero en el sitio exacto, con el formato exacto, y acertar con
el nombre.

Eso deja el flujo a medio construir desde la UI: puedes montar el enrutado entero sin tocar un
fichero, pero no puedes hacer que diga nada tuyo.

## What Changes

**El motor**

- `src/sounds.ts`: el nombre de un audio se sanea a `[a-z0-9_-]`, y la conversión a alaw 8 kHz mono
  la hace ffmpeg. Los dos son funciones aparte para poder probar la primera sin la segunda.
- El motor gana un **segundo sitio donde escribe** dentro de `asterisk-config`:
  `sounds/en/janus/`. Hasta ahora solo escribía `pjsip_janus.conf`.
- **BREAKING**: `ffmpeg` pasa a ser un requisito del sistema. Sin él, subir un audio falla con un
  error que lo dice; el resto del motor funciona igual.

**La API**

- Ruta nueva `/api/sounds`: `GET` lista los audios subidos, `PUT /api/sounds/<nombre>` sube uno con
  el fichero en el **cuerpo crudo**. Sin multipart, sin parser y sin dependencias.
- Es la **séptima** ruta, y el comentario `ponytail:` de `server.ts` decía que la séptima era migrar
  a Hono. Se rompe la regla a propósito: un bloque `if` que calca al de `/api/trunks` no es la
  escalera ilegible de la que protegía el techo, y Hono no compra nada aquí. El comentario pasa a
  decir que la octava sí.

**El editor**

- El campo `media` deja de ser un input pelado: se le añade un selector de fichero del sistema y un
  desplegable con lo ya subido. **Sigue siendo texto editable**, para que los audios de serie de
  Asterisk se puedan seguir escribiendo a mano.
- El esquema declara ese campo con `control: 'sound'`, para que sea el esquema quien diga que ese
  campo tiene control propio y no un `if` por nombre de campo escondido en el formulario.

**Fuera de alcance** (deliberado, no olvidado)

- Borrar audios. Una versión publicada es inmutable y puede referenciar uno; borrarlo dejaría una
  llamada real fallando al reproducir. Se resuelve cuando haya con qué saber quién referencia qué.
- Listar los cien y pico audios de serie de Asterisk en el desplegable. Son ruido; se siguen
  escribiendo a mano.
- Renombrar, reemplazar o escuchar un audio desde el editor.
- Audios por idioma. Todo va a `en/`, que es donde están los de serie.
- Un límite de espacio en disco por encima del límite por fichero.

## Capabilities

### New Capabilities

- `sound-library`: los audios que el flujo reproduce como algo que se sube desde el editor — se
  elige un fichero del sistema, el motor lo convierte a lo que Asterisk sabe reproducir, lo deja
  donde Asterisk lo busca, y el campo del nodo pasa a referenciarlo.

### Modified Capabilities

- `visual-flow-editing`: el campo de audio deja de editarse con el control genérico de texto y pasa
  a tener el suyo, declarado en el esquema. Es el mismo caso que ya contempla el nodo `entry` con
  su troncal: un campo cuyos valores no los sabe el esquema.

## Impact

**Código**

| Fichero | Qué le pasa |
|---|---|
| `src/sounds.ts` | nuevo: saneado del nombre, conversión con ffmpeg, listado |
| `src/schema.ts` | `say.media` y `gather.media` declaran `control: 'sound'` |
| `src/server.ts` | la ruta `/api/sounds`, y el comentario del techo actualizado |
| `src/main.ts` | ata el directorio de sonidos y pasa el puerto a la API |
| `ui/src/NodeForm.jsx` | el campo con `control: 'sound'` usa `SoundField` |
| `ui/src/SoundField.jsx` | nuevo: subir un fichero, elegir uno subido, o escribirlo |

**Datos**

Ninguno. Los audios son ficheros, no filas: el grafo solo guarda `sound:janus/<nombre>`, que es la
misma cadena de texto que guardaba antes.

**Dependencias**

Ninguna de npm. `ffmpeg` como binario del sistema, que ya está instalado en la máquina de
desarrollo.

**Ficheros y git**

`asterisk-config/sounds/` ya está fuera de git —los audios de serie pesan y se descargan—, así que
los subidos caen fuera también sin tocar `.gitignore`. Es el segundo derivado que escribe el motor,
después de `pjsip_janus.conf`, y hay que decirlo en `AGENTS.md`, que hoy afirma que es el único.
