## Context

`server.ts` sirve siete rutas con `node:http` en `127.0.0.1`, todas de la misma forma: un
`pathname` exacto, `GET` y `PUT` dentro, y una respuesta JSON. Su comentario `ponytail:` dice desde
hace dos cambios que *«la octava obliga a migrar a Hono — o a admitir que este comentario no es un
techo»*, y nombra explícitamente «servir la UI compilada» como uno de los dos disparadores.

`vite build` produce tres ficheros: `index.html` y dos assets con el hash en el nombre.

La UI importa del árbol del motor:

```
ui/src/graph.js          → ../../src/schema.ts
ui/src/NodeForm.jsx      → ../../src/schema.ts
ui/src/EndpointField.jsx → ../../src/endpoint.ts
ui/src/App.jsx           → ../../src/schema.ts
```

Eso fue una decisión deliberada —una sola declaración del vocabulario, leída por el motor y por el
editor— y su precio es que el editor tiene que construirse contra el mismo árbol que ejecuta el
motor. Mientras todo corría en la misma máquina no se notaba.

## Goals / Non-Goals

**Goals:**

- Que el editor se sirva desde el motor, construido contra su mismo `src/`.
- Que el servidor de desarrollo en otra máquina siga funcionando exactamente igual.
- Que servir ficheros no abra un camino para leer fuera del directorio del editor.

**Non-Goals:**

- Autenticación. Sigue siendo túnel SSH, y sigue siendo deuda declarada.
- Cachés, ETag, compresión, o servir en una ruta distinta de la raíz.
- Construir la UI al arrancar.

## Decisions

### 1. Se retira el techo de rutas en vez de migrar a Hono

El comentario prometía Hono en la séptima ruta. Llegó la séptima con `/api/sounds` y no se migró;
llega esta y tampoco. Un techo que se cruza dos veces sin consecuencia deja de ser un techo y pasa
a ser una nota que nadie se cree, así que se retira **con el motivo escrito** en vez de dejarlo
mintiendo una tercera vez.

El motivo por el que la regla no se ha cumplido nunca es que la predicción estaba mal. El techo se
puso para que `server.ts` no acabara siendo una escalera ilegible de condicionales. Pero las rutas
resultaron homogéneas —todas son «una colección, `GET` y `PUT`»— y ninguna ha necesitado nada de lo
que un framework aporta: ni parámetros de ruta, ni middleware, ni negociación de contenido. Y
servir estáticos no añade un peldaño: **sustituye el `404` final**.

Los números del cambio contrario: Hono son dos dependencias en un motor que tiene tres, reescribir
240 líneas y volver a pasar 26 tests, para comprar un `serveStatic` que aquí ocupa treinta líneas.

`ponytail:` lo que sí justificaría migrar es una necesidad de verdad —middleware de
autenticación, rutas con parámetros, varios formatos de respuesta—, no la cuenta de `if`.

### 2. La contención se comprueba resolviendo, no prohibiendo

La ruta pedida llega de fuera y acaba siendo un fichero en disco. Se resuelve contra el directorio
del editor y se exige que el resultado **siga estando dentro**; lo que se sale, no se sirve.

Esto es distinto del saneado de los audios, y a propósito. Allí el nombre es nuestro y se puede
reducir a `[a-z0-9_-]`, así que la lista de permitidos es posible y es la defensa. Aquí los nombres
los pone Vite —`index-D4dnGvPY.js`— y no se pueden acotar a un alfabeto sin romperlos. Cuando no
puedes restringir la entrada, el primitivo correcto no es buscar `..` —que se escapa de mil formas—
sino **resolver del todo y comprobar dónde has acabado**, que no tiene formas de escaparse.

### 3. Sin `dist` no pasa nada

Si el directorio no existe, la petición termina en el mismo `404` de antes. Eso mantiene intacto el
flujo de desarrollo —Vite en otra máquina, con su proxy— sin una variable de entorno ni un modo que
recordar: la presencia del build es la señal.

### 4. Un solo puerto

Con el editor servido por el motor, el acceso remoto es un túnel a `:3000` y ya. Antes hacían falta
dos, y el de Vite además exigía tener el repositorio y sus dependencias en la otra punta.

### 5. `dist` es un derivado y no entra en git

Se construye al desplegar, contra el `src/` que va a ejecutarse. Commitearlo reintroduciría
exactamente la divergencia que este cambio viene a cerrar, porque el fichero commiteado sería el de
la máquina de quien lo construyó.

## Risks / Trade-offs

**[El motor pasa a servir HTML sin autenticación]** → Misma postura que la API: solo escucha en
`127.0.0.1` y se llega por túnel. No empeora lo que había —quien llega al puerto ya podía leer y
escribir el flujo entero—, pero sí hace más evidente que falta. Queda como deuda declarada.

**[Construir en la máquina de destino pide las dependencias del editor]** → Son 91 MB una vez, y
después de construir se pueden borrar: `dist` no las necesita. Lo que de verdad hacía falta era
memoria, y eso lo resuelve el swap.

**[Un `dist` viejo se sirve sin avisar]** → Si se despliega código nuevo y no se reconstruye, el
editor será el de antes. Es el mismo riesgo que tiene cualquier build, y la señal está a mano: la
versión del flujo que publica y los campos que ofrece el formulario.

## Migration Plan

Una fase: el script de build, el fallback en `server.ts`, y sus tests.

**Rollback:** borrar `ui/dist`. El motor vuelve a devolver `404` y el editor vuelve a ser el
servidor de desarrollo.

## Open Questions

Ninguna que bloquee.

- La autenticación tiene que llegar antes de que esto se sirva sin túnel. No es de este cambio,
  pero es la consecuencia directa de que ahora haya algo que abrir en un navegador.
