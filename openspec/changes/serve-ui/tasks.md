## 1. El build

- [x] 1.1 `ui/package.json`: script `build`
- [x] 1.2 `.gitignore`: `ui/dist`, que es un derivado y no puede commitearse

## 2. El motor

- [x] 2.1 `src/server.ts`: el `404` final pasa a servir `ui/dist`; la raíz da `index.html`
- [x] 2.2 `src/server.ts`: contención por ruta resuelta, no por buscar `..`
- [x] 2.3 `src/server.ts`: tipo de contenido por extensión, y `404` para lo que no exista
- [x] 2.4 `src/server.ts`: retirar el techo de rutas del comentario `ponytail:`, con el motivo
- [x] 2.5 Test: con build, la raíz devuelve el editor y los assets su tipo correcto
- [x] 2.6 Test: sin build, todo se comporta como antes
- [x] 2.7 Test: las rutas de la API ganan al fichero estático
- [x] 2.8 Test: salirse del directorio no sirve nada, en varias formas

## 3. Cierre

- [x] 3.1 `pnpm test` y `pnpm typecheck` en verde
- [x] 3.2 `AGENTS.md` y `README.md`: el motor sirve el editor, el techo retirado y el porqué
- [ ] 3.3 Prueba a mano: construir, abrir `:3000` por el túnel y publicar un flujo
