## Context

Los audios de Asterisk viven en `/var/lib/asterisk/sounds`, que en el laboratorio es
`asterisk-config/sounds` montado en el contenedor. Comprobado sobre la instalación real:

```
asterisk-config/sounds/en/*.gsm          los de serie, ~100 ficheros
asterisk-config/sounds/en/digits/…       Asterisk YA usa subdirectorios
core show file formats  →  alaw   alaw   alaw|al|alw
ffmpeg 6.1.1 en el host, no en el contenedor
ffmpeg -ar 8000 -ac 1 -f alaw  →  8000 bytes por segundo exactos
```

Tres cosas que eso deja decididas antes de empezar: hay directorio de idioma (`en/`), los
subdirectorios funcionan (así que `sound:janus/x` resuelve), y `alaw` es un formato que Asterisk
lee de fichero.

Estado del que se parte:

- `src/pjsip.ts` es puro y `src/asterisk.ts` es lo que toca disco. Ese reparto es el que se copia.
- `src/server.ts` sirve seis rutas con `node:http` en `127.0.0.1`, y su comentario `ponytail:` marca
  media docena como el punto de migrar a Hono.
- `src/schema.ts` declara los campos de cada nodo. `say.media` y `gather.media` son `string` a secas.
- `ui/src/NodeForm.jsx` ya tiene el precedente del campo con control propio: el nodo `entry` recibe
  su formulario de troncales por la prop `fields`, porque sus valores los sabe la base y no el
  esquema.

## Goals / Non-Goals

**Goals:**

- Que poner el saludo de tu empresa sea elegir un fichero, sin SSH y sin saber de códecs.
- Que un audio que Asterisk no podría reproducir se rechace al subirlo, no en una llamada real.
- Que el nombre que llega por la API no pueda escribir fuera del directorio de audios.
- Que los audios de serie se sigan pudiendo usar escribiéndolos.

**Non-Goals:**

- Borrar, renombrar o reemplazar audios.
- Escucharlos desde el editor.
- Audios por idioma.
- Listar los de serie en el desplegable.

## Decisions

### 1. El fichero viaja en el cuerpo crudo de un PUT, no en un multipart

`PUT /api/sounds/<nombre>` con el fichero tal cual en el cuerpo. Desde el navegador es
`fetch(url, { method: 'PUT', body: file })`, que es una línea, y en el motor es leer el stream.

**Alternativa descartada: `multipart/form-data`.** Es el reflejo aprendido para subir ficheros, y
aquí solo añade un parser de límites de cuarenta líneas —o una dependencia— para transportar un
único fichero sin campos que lo acompañen. El nombre cabe en la URL y el contenido en el cuerpo.

### 2. Se rompe el techo de seis rutas a propósito, y se dice por qué

El comentario de `server.ts` decía que la séptima ruta es migrar a Hono. No se migra.

El techo existe para que `server.ts` no se convierta en una escalera de `if` ilegible. `/api/sounds`
es un bloque idéntico al de `/api/trunks` —mismo `pathname`, `GET` y `PUT` dentro— y no añade
enrutado que `node:http` no dé: no hay parámetros de ruta más allá del último segmento, ni
middleware, ni negociación de contenido. Migrar a Hono compraría dos dependencias en un motor que
tiene tres, para no usar nada de lo que Hono aporta.

El comentario se actualiza a ocho. `ponytail:` si esto vuelve a pasar en la siguiente ruta, el techo
no es un techo y hay que migrar de verdad o quitar el comentario.

### 3. El nombre se sanea a `[a-z0-9_-]`, y eso es también la defensa

El nombre llega en la URL y acaba siendo un fichero en disco. Saneado: se quitan los acentos, se
pasa a minúsculas, se tira la extensión y todo lo que no sea `[a-z0-9_-]` se convierte en `-`.

Eso **es** la defensa contra el path traversal, y por eso no hay además una comprobación de `..`:
una lista de caracteres permitidos no puede dejar pasar `../`, ni `..%2f`, ni un separador de
Windows, ni un byte nulo, mientras que una lista de patrones prohibidos se olvida de uno. Un nombre
que se queda vacío al sanearlo se rechaza.

### 4. Se convierte siempre, aunque el fichero ya valga

Todo lo que entra pasa por ffmpeg a alaw 8 kHz mono. No se mira la cabecera para decidir si hace
falta.

Convertir un fichero que ya estaba bien cuesta milisegundos y quita la rama que decide, que es
donde estaría el fallo: creer que un wav es 8 kHz porque lo dice su cabecera y que suene a ardilla
en la llamada. Y alaw es el códec al que ya van las troncales (`allow=alaw` en `pjsip.ts`), así que
se reproduce sin transcodificar.

**Alternativa descartada: aceptar solo lo que ya vale**, leyendo la cabecera del wav y rechazando
lo demás con el comando de ffmpeg para arreglarlo. Cero dependencias del sistema, pero deja de ser
"elige un audio" y te manda a la terminal, que es de donde este cambio viene a sacarte.

### 5. La conversión es un puerto que la API recibe, no algo que la API hace

`serveApi` recibe cómo listar y cómo guardar un audio, igual que ya recibe `Provisioner` para
Asterisk. Así los tests de la API corren sin ffmpeg y sin escribir en el directorio de sonidos, que
es lo que los hace deterministas en cualquier máquina.

La implementación de verdad vive en `sounds.ts` y se prueba aparte, contra un tmpdir.

### 6. El límite de tamaño se aplica mientras se lee, no después

El cuerpo se acumula comprobando el total en cada trozo, y al pasarse se corta y se responde 413.
Comprobar `content-length` no vale: lo manda el cliente. Leer entero y mirar después significa que
un cuerpo de un giga ya se ha metido en memoria cuando te enteras.

Diez megas. Un aviso de centralita dura segundos; diez megas son minutos de mp3 y ya es generoso.

### 7. El campo con control propio lo declara el esquema, no el formulario

`say.media` y `gather.media` llevan `control: 'sound'`. El formulario mira esa propiedad para
elegir qué pintar.

La alternativa —un `if (field.name === 'media')` dentro de `NodeForm`— esconde en el componente una
decisión sobre el vocabulario, que es justo lo que el esquema existe para centralizar. Con la
propiedad, el día que `ai_agent` tenga un campo que también quiera control propio, se declara y ya.

### 8. El campo sigue siendo texto, con la subida al lado

El control tiene tres partes: el texto (que es el valor de verdad), un selector de fichero, y un
desplegable con lo ya subido. Subir o elegir escriben en el texto.

Quitar el texto habría dejado sin usar los cien audios de serie de Asterisk, que hoy funcionan y
son la mitad del `flow.json` del repo. Meterlos en el desplegable habría sido cien entradas de
ruido para encontrar el tuyo.

### 9. Los audios van a `en/janus/`, y ese `en` es el del idioma

Asterisk busca los audios bajo el directorio del idioma del canal, que por defecto es `en`, y ahí
están los de serie. El subdirectorio `janus/` separa lo subido de lo que viene con Asterisk, igual
que `pjsip_janus.conf` separa lo generado de lo escrito a mano.

`ponytail:` un solo idioma. El día que haga falta, el idioma es un nivel más de directorio y una
columna en el flujo, no un cambio de forma.

## Risks / Trade-offs

**[ffmpeg pasa a ser requisito del sistema]** → Solo para subir. El motor arranca, atiende llamadas
y publica flujos sin él; lo que falla es la subida, y falla diciendo que falta ffmpeg. Se documenta
en el README junto a la descarga de los audios de serie, que ya es un paso manual.

**[Un audio referenciado por una versión publicada se puede quedar sin fichero]** → Hoy no, porque
no se pueden borrar. La puerta queda cerrada a propósito hasta que haya forma de saber qué versiones
referencian qué audio.

**[El motor escribe en un segundo sitio dentro de asterisk-config]** → Sigue siendo un directorio
suyo, dentro de otro que ya está fuera de git. Lo que no cambia: el motor no toca ningún fichero que
mantenga el dueño de la máquina.

**[Subir es una escritura sin autenticación]** → Como todo lo demás de esta API, que solo escucha en
`127.0.0.1` y se alcanza por túnel SSH. Un audio no es una credencial; el riesgo que sí importaba
—que el nombre escriba fuera del directorio— lo cierra el saneado de la decisión 3.

## Migration Plan

**Fase 1 — el motor.** `sounds.ts` con el saneado, el listado y la conversión. Tests: el saneado
entero sin ffmpeg, la conversión contra un tmpdir.

**Fase 2 — la API.** `/api/sounds` con el puerto inyectado, el límite de tamaño y sus tests sin
ffmpeg. El comentario del techo, actualizado.

**Fase 3 — el editor.** `control: 'sound'` en el esquema y `SoundField.jsx`, con sus tests jsdom.

**Rollback:** por fases y sin estado que deshacer. Los audios subidos se quedan como ficheros
inertes y el grafo sigue guardando una cadena de texto que el motor de antes también entendía.

## Open Questions

Ninguna que bloquee.

- `ponytail:` un solo idioma, `en/`.
- `ponytail:` no hay límite de espacio total, solo por fichero.
