## Why

El editor solo existe como servidor de desarrollo de Vite. Para usarlo contra una máquina de
verdad hay dos caminos y los dos tienen un problema:

- **Correr Vite en la máquina** — 91 MB de dependencias de desarrollo en un sitio que solo tiene
  que atender llamadas, y un `install` que ya ha matado por falta de memoria a un droplet pequeño.
- **Correrlo en el portátil por un túnel** — funciona, pero la UI importa `src/schema.ts` y
  `src/endpoint.ts` **del árbol donde corre**. Si el portátil va por detrás, el formulario pinta un
  vocabulario y el motor valida con otro: campos que no salen, o un rechazo al publicar que no se
  entiende. Y como `validate` corre en el motor, gana la máquina.

Esa divergencia no es hipotética: `src/schema.ts` ha cambiado tres veces en un día.

Sirviendo el editor desde el propio motor, el paquete se construye contra el mismo `src/` que
ejecuta el motor y la divergencia deja de poder ocurrir. De paso, el acceso remoto pasa de dos
puertos a uno.

## What Changes

- `ui/` gana un script `build`, que hoy no tiene.
- `server.ts`: lo que hoy es un `404` final pasa a servir `ui/dist` si existe. **Sin `dist` se
  comporta igual que ahora**, así que el servidor de desarrollo en el portátil sigue funcionando
  sin cambios.
- **Se retira el techo de rutas** del comentario `ponytail:` de `server.ts`, con el motivo escrito.
  Ver la decisión 1 del diseño.

**Fuera de alcance** (deliberado, no olvidado)

- **Autenticación.** El motor pasa a servir HTML, pero sigue escuchando solo en `127.0.0.1` y se
  llega por túnel SSH. Es la misma postura de siempre y sigue siendo deuda declarada: el día que
  esto se abra sin túnel, hace falta un token de verdad.
- Cachés, ETag, compresión. Son tres ficheros por un túnel a una máquina.
- Servir el editor en una ruta que no sea la raíz.
- Reconstruir la UI al arrancar el motor. Se construye al desplegar.

## Capabilities

### New Capabilities

- `ui-hosting`: el motor sirve el editor que se construye contra su propio código, para que lo que
  el formulario ofrece y lo que el motor valida no puedan separarse.

### Modified Capabilities

Ninguna.

## Impact

**Código**

| Fichero | Qué le pasa |
|---|---|
| `ui/package.json` | script `build` |
| `src/server.ts` | el 404 final sirve `ui/dist`; el comentario del techo, retirado |
| `.gitignore` | `ui/dist`, que es un derivado |

**Dependencias**

Ninguna. Explícitamente **no** se migra a Hono; el porqué está en el diseño.

**Despliegue**

El túnel pasa de dos puertos a uno: el editor se abre en el mismo `:3000` que la API.
