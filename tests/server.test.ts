/**
 * @fileoverview Tests de la API. Levantan el servidor de verdad en un puerto
 * que elige el sistema, con la base en memoria y un Asterisk de mentira: no
 * hace falta ni laboratorio ni contenedor.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { serveApi } from '../src/server.ts';
import type { FlowStore } from '../src/server.ts';
import { openStore } from '../src/store.ts';
import type { FlowVersion, Store } from '../src/store.ts';
import type { Sound } from '../src/sounds.ts';
import type { Flow } from '../src/types.ts';

/** Un directorio de editor construido, con lo que produce `vite build`. */
function conBuild(): string {
  const dir = mkdtempSync(join(tmpdir(), 'janus-ui-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Janus</title><div id="root"></div>');
  writeFileSync(join(dir, 'assets', 'index-abc123.js'), 'console.log("editor")');
  writeFileSync(join(dir, 'assets', 'index-abc123.css'), ':root{--x:1}');
  return dir;
}

/** Un directorio que no existe: es lo que hay mientras se desarrolla con Vite aparte. */
const SIN_BUILD = join(tmpdir(), 'janus-sin-build-no-existe');

const flow = (start: string): Flow => ({
  start,
  nodes: [{ id: start, type: 'entry' }, { id: 'fin', type: 'hangup' }],
  edges: [{ from: start, to: 'fin' }],
});

/**
 * El motor se calla durante estos tests.
 *
 * `node --test` usa la salida estándar del proceso hijo para su propio protocolo
 * serializado. Lo que `server.ts` imprima —`⟳ flujo v2`, `♪ audio`, `⟳ troncales`—
 * se intercala con esos bytes y los corrompe: el runner suelta
 * `Unable to deserialize cloned data` y a veces da por fallado un fichero que
 * pasó entero. Solo se ve al correr varios ficheros a la vez, así que parece un
 * flake y no lo es.
 *
 * Esto no esconde nada: los fallos de test viajan por el protocolo, no por
 * `console.log`.
 */
console.log = () => {};
console.error = () => {};

/** Asterisk no pinta nada en estos tests: ni se escribe fichero ni se recarga. */
const asterisk = { apply: async () => {}, states: async () => ({}) };

/**
 * La biblioteca de audios, de mentira: guarda en memoria y no llama a ffmpeg.
 *
 * Por eso estos tests corren igual en una máquina sin ffmpeg y no escriben en el
 * árbol de sonidos de nadie.
 */
function fakeSounds(fallo?: string) {
  const guardados: Sound[] = [];
  return {
    guardados,
    list: () => guardados,
    save: async (name: string, bytes: Buffer): Promise<Sound> => {
      if (fallo) throw new Error(fallo);
      const sound = {
        name,
        media: `sound:janus/${name}`,
        bytes: bytes.length,
        seconds: Math.round((bytes.length / 8000) * 10) / 10,
      };
      guardados.push(sound);
      return sound;
    },
  };
}

/**
 * El cuerpo de una respuesta. `any` a propósito y en un solo sitio: la forma la
 * comprueba cada test con sus asserts, que es de lo que van estos tests.
 */
const body = async (res: Response): Promise<any> => res.json();

/**
 * Levanta la API sobre una base en memoria y devuelve con qué hablarle.
 *
 * `live` es el flujo vivo, atado igual que en `main.ts`: una variable que el
 * PUT reemplaza. Los tests miran ahí para comprobar qué está sirviendo el motor.
 */
async function api(store: Store = openStore(':memory:'), sounds = fakeSounds(), uiDir = SIN_BUILD) {
  let live: FlowVersion = store.publish(flow('uno'));
  const flowStore: FlowStore = { get: () => live, set: (nuevo) => { live = nuevo; } };

  const server = serveApi(flowStore, store, asterisk, sounds, 0, uiDir);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    store,
    sounds,
    get: (path: string) => fetch(base + path),
    put: (path: string, body: unknown) =>
      fetch(base + path, { method: 'PUT', body: JSON.stringify(body) }),
    // `Buffer` es un `Uint8Array`, que fetch acepta como cuerpo; el `as any` es
    // solo porque los tipos de Node no traen el `BufferSource` del DOM.
    putRaw: (path: string, body: Uint8Array) =>
      fetch(base + path, { method: 'PUT', body: body as any }),
    live: () => live,
    close: () => { server.close(); store.close(); },
  };
}

test('la lista de versiones sale de la más reciente a la más antigua', async () => {
  const app = await api();
  app.store.publish(flow('dos'));

  const versiones = await body(await app.get('/api/flows'));
  assert.deepEqual(versiones.map((v: { version: number }) => v.version), [2, 1]);
  assert.equal(versiones[0].nodes, 2);
  assert.equal(versiones[0].edges, 1);
  app.close();
});

test('se puede pedir el grafo de una versión concreta', async () => {
  const app = await api();
  app.store.publish(flow('dos'));

  assert.equal((await body(await app.get('/api/flows?version=1'))).start, 'uno');
  assert.equal((await body(await app.get('/api/flows?version=2'))).start, 'dos');
  app.close();
});

test('una versión que no se publicó nunca responde 404', async () => {
  const app = await api();

  const res = await app.get('/api/flows?version=99');
  assert.equal(res.status, 404);
  assert.match((await body(res)).issues[0].message, /no está publicada/);
  app.close();
});

test('leer una versión anterior no cambia la que está en vivo', async () => {
  const app = await api();
  app.store.publish(flow('dos'));
  app.live(); // el motor sigue en la 1: publicar por debajo no lo recarga

  await app.get('/api/flows?version=1');
  assert.equal(app.live().version, 1);
  app.close();
});

test('el flujo se sigue sirviendo pelado, sin envolver en la versión', async () => {
  const app = await api();

  const cuerpo = await body(await app.get('/api/flow'));
  assert.equal(cuerpo.start, 'uno');
  assert.equal('graph' in cuerpo, false);
  app.close();
});

test('publicar cambia el flujo vivo y le pone versión nueva', async () => {
  const app = await api();

  const res = await app.put('/api/flow', flow('dos'));
  assert.equal((await body(res)).version, 2);
  assert.equal(app.live().version, 2);
  assert.equal(app.live().graph.start, 'dos');
  app.close();
});

// El caso de la llamada de diez minutos: entra con la v1, se publica la v2 a
// mitad, y al guardarla tiene que seguir siendo la v1. Version y grafo viajan
// en el mismo objeto, así que capturarlo al entrar los captura los dos.
test('lo capturado al entrar la llamada no se mueve aunque se publique', async () => {
  const app = await api();
  const alEntrar = app.live();

  await app.put('/api/flow', flow('dos'));

  assert.equal(alEntrar.version, 1);
  assert.equal(alEntrar.graph.start, 'uno');
  assert.equal(app.live().version, 2);
  app.close();
});

test('un flujo con errores no se publica ni toca el flujo vivo', async () => {
  const app = await api();

  const res = await app.put('/api/flow', { start: 'x', nodes: [], edges: [] });
  assert.equal(res.status, 400);
  assert.equal(app.live().version, 1);
  app.close();
});

test('las llamadas salen con la versión con la que corrieron', async () => {
  const app = await api();
  app.store.save({
    id: 'canal-1',
    caller: '600',
    did: '900',
    flowVersion: 1,
    startedAt: new Date('2026-08-31T10:00:00.000Z'),
    endedAt: new Date('2026-08-31T10:00:05.000Z'),
    outcome: 'completed',
    vars: {},
    trace: [{ node: 'uno', at: '2026-08-31T10:00:00.000Z' }],
  });

  const [llamada] = await body(await app.get('/api/calls'));
  assert.equal(llamada.flowVersion, 1);
  app.close();
});

test('una llamada sin versión conocida sale como null, no inventada', async () => {
  const app = await api();
  app.store.save({
    id: 'vieja',
    caller: null,
    did: null,
    flowVersion: null,
    startedAt: new Date('2026-08-01T10:00:00.000Z'),
    endedAt: new Date('2026-08-01T10:00:05.000Z'),
    outcome: 'completed',
    vars: {},
    trace: [],
  });

  const [llamada] = await body(await app.get('/api/calls'));
  assert.equal(llamada.flowVersion, null);
  app.close();
});

// ─── Los audios ──────────────────────────────────────────────────────────────

test('subir un audio devuelve su nombre saneado y su referencia', async () => {
  const app = await api();

  const res = await app.putRaw('/api/sounds/Saludo%20de%20A%C3%B1o%20Nuevo.mp3', Buffer.from('audio'));
  const cuerpo = await body(res);

  assert.equal(res.status, 200);
  assert.equal(cuerpo.name, 'saludo-de-ano-nuevo');
  assert.equal(cuerpo.media, 'sound:janus/saludo-de-ano-nuevo');
  app.close();
});

test('el audio subido aparece en la lista', async () => {
  const app = await api();
  await app.putRaw('/api/sounds/bienvenida.wav', Buffer.from('audio'));

  const lista = await body(await app.get('/api/sounds'));
  assert.deepEqual(lista.map((s: { name: string }) => s.name), ['bienvenida']);
  app.close();
});

test('sin audios subidos la lista va vacía, no falla', async () => {
  const app = await api();
  assert.deepEqual(await body(await app.get('/api/sounds')), []);
  app.close();
});

// Con un mega, y no con dos bytes: un cuerpo pequeño cabe entero en el buffer
// del socket, así que el cliente termina de escribir antes de que el servidor
// conteste y el test pasaría igual aunque responder pronto cortase la subida.
test('un nombre que no deja nada utilizable se rechaza con 400, aunque el fichero sea grande', async () => {
  const app = await api();

  const res = await app.putRaw('/api/sounds/....', Buffer.alloc(1024 * 1024, 1));
  assert.equal(res.status, 400);
  assert.match((await body(res)).issues[0].message, /ningún carácter utilizable/);
  assert.deepEqual(app.sounds.guardados, [], 'no se guarda nada');
  app.close();
});

// Responder antes de leer el cuerpo no le corta la conexión a quien sube:
// `node:http` vacía solo lo que quede por llegar. Esto lo deja fijado, para que
// nadie añada un drenado a mano creyendo que arregla algo.
test('una respuesta temprana llega aunque queden bytes por subir', async () => {
  const app = await api();

  const res = await app.putRaw('/api/inventada', Buffer.alloc(1024 * 1024, 1));
  assert.equal(res.status, 404);
  app.close();
});

test('un nombre con ../ no escribe fuera: llega saneado o no llega', async () => {
  const app = await api();

  await app.putRaw('/api/sounds/..%2F..%2Fetc%2Fpasswd', Buffer.from('audio'));
  for (const sound of app.sounds.guardados) assert.match(sound.name, /^[a-z0-9_-]+$/);
  app.close();
});

test('un audio que pasa del límite se corta con 413 y no se guarda', async () => {
  const app = await api();
  const enorme = Buffer.alloc(11 * 1024 * 1024, 1);

  const res = await app.putRaw('/api/sounds/enorme.wav', enorme);
  assert.equal(res.status, 413);
  assert.match((await body(res)).issues[0].message, /pasa del máximo/);
  assert.deepEqual(app.sounds.guardados, []);
  app.close();
});

test('un audio justo por debajo del límite sí entra', async () => {
  const app = await api();
  const grande = Buffer.alloc(9 * 1024 * 1024, 1);

  const res = await app.putRaw('/api/sounds/grande.wav', grande);
  assert.equal(res.status, 200);
  assert.equal(app.sounds.guardados.length, 1);
  app.close();
});

test('si la conversión falla, el error del motor llega tal cual', async () => {
  const app = await api(openStore(':memory:'), fakeSounds('falta ffmpeg en la máquina'));

  const res = await app.putRaw('/api/sounds/roto.txt', Buffer.from('no soy audio'));
  assert.equal(res.status, 400);
  assert.match((await body(res)).issues[0].message, /falta ffmpeg/);
  app.close();
});

test('subir no toca el flujo vivo ni publica nada', async () => {
  const app = await api();
  await app.putRaw('/api/sounds/x.wav', Buffer.from('audio'));

  assert.equal(app.live().version, 1);
  assert.deepEqual(app.store.flowVersions().map((v) => v.version), [1]);
  app.close();
});

test('un transporte que no existe se rechaza', async () => {
  const app = await api();

  const res = await app.put('/api/trunks', [
    { name: 'x', host: 'sip.x.es', mode: 'identify', transport: 'carrier-pigeon', matchIp: '1.2.3.4' },
  ]);
  assert.equal(res.status, 400);
  assert.match((await body(res)).issues[0].message, /transporte desconocido/);
  app.close();
});

test('los dos transportes válidos se aceptan, con cualquier modo', async () => {
  const app = await api();

  const res = await app.put('/api/trunks', [
    { name: 'porUdp', host: 'a', mode: 'register', transport: 'udp', username: 'u' },
    { name: 'porTcp', host: 'b', mode: 'identify', transport: 'tcp', matchIp: '1.2.3.4' },
  ]);
  assert.equal(res.status, 200);
  app.close();
});

test('una troncal sin transporte declarado se sigue aceptando', async () => {
  const app = await api();

  const res = await app.put('/api/trunks', [
    { name: 'vieja', host: 'a', mode: 'identify', matchIp: '1.2.3.4' },
  ]);
  assert.equal(res.status, 200);
  app.close();
});

// El host acaba dentro de una URI en un fichero de Asterisk, donde el `;` abre
// un comentario: colarlo ahí genera una línea que carga a medias y en silencio.
test('un host con parámetros de URI se rechaza y dice dónde va eso', async () => {
  const app = await api();

  const res = await app.put('/api/trunks', [
    { name: 'x', host: 'sip.rtc.elevenlabs.io:5060;transport=tcp', mode: 'identify', matchIp: '1.2.3.4' },
  ]);
  assert.equal(res.status, 400);
  assert.match((await body(res)).issues[0].message, /transporte se elige en su propio campo/);
  app.close();
});

test('un host con espacios o barras tampoco pasa', async () => {
  const app = await api();
  for (const host of ['sip.x.es ; algo', 'sip.x.es\;transport=tcp', 'sip x es', 'sip.x.es/ruta']) {
    const res = await app.put('/api/trunks', [{ name: 'x', host, mode: 'identify', matchIp: '1.2.3.4' }]);
    assert.equal(res.status, 400, host);
  }
  app.close();
});

test('los hosts normales siguen pasando', async () => {
  const app = await api();
  for (const host of ['sip.masmovil.es', 'sip.rtc.elevenlabs.io:5060', '212.0.0.5', '212.0.0.5:5060']) {
    const res = await app.put('/api/trunks', [{ name: 'x', host, mode: 'identify', matchIp: '1.2.3.4' }]);
    assert.equal(res.status, 200, host);
  }
  app.close();
});

// ─── El editor servido por el motor ──────────────────────────────────────────

test('con el editor construido, la raíz lo devuelve', async () => {
  const app = await api(openStore(':memory:'), fakeSounds(), conBuild());

  const res = await app.get('/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type')!, /text\/html/);
  assert.match(await res.text(), /<div id="root">/);
  app.close();
});

test('cada recurso sale con su tipo de contenido', async () => {
  const app = await api(openStore(':memory:'), fakeSounds(), conBuild());

  const js = await app.get('/assets/index-abc123.js');
  assert.match(js.headers.get('content-type')!, /text\/javascript/);
  const css = await app.get('/assets/index-abc123.css');
  assert.match(css.headers.get('content-type')!, /text\/css/);
  app.close();
});

// La presencia del build es la señal: sin él, todo se comporta como antes y el
// servidor de desarrollo con su proxy sigue funcionando sin tocar nada.
test('sin editor construido, el motor responde como siempre', async () => {
  const app = await api();

  assert.equal((await app.get('/')).status, 404);
  assert.equal((await app.get('/assets/lo-que-sea.js')).status, 404);
  assert.equal((await app.get('/api/flow')).status, 200, 'la API no se entera');
  app.close();
});

test('la API gana al fichero estático', async () => {
  const app = await api(openStore(':memory:'), fakeSounds(), conBuild());

  const res = await app.get('/api/flow');
  assert.match(res.headers.get('content-type')!, /application\/json/);
  assert.equal((await body(res)).start, 'uno');
  app.close();
});

test('un fichero que no está en el build es un 404', async () => {
  const app = await api(openStore(':memory:'), fakeSounds(), conBuild());
  assert.equal((await app.get('/assets/no-existe.js')).status, 404);
  app.close();
});

test('un directorio no se sirve', async () => {
  const app = await api(openStore(':memory:'), fakeSounds(), conBuild());
  assert.equal((await app.get('/assets')).status, 404);
  app.close();
});

test('solo el GET sirve ficheros', async () => {
  const app = await api(openStore(':memory:'), fakeSounds(), conBuild());
  assert.equal((await app.putRaw('/', Buffer.from('x'))).status, 404);
  app.close();
});

// Comprobado que ninguna de estas sirve un fichero. Lo que las para es que
// `new URL()` normaliza los `..` y que el pathname no se decodifica; la
// comprobación de contención de `serveUi` es la red de debajo y este test NO la
// ejecuta — quitarla no pone esto en rojo. Se deja escrito para que nadie crea
// que este test la respalda.
test('ninguna forma de salirse del directorio sirve nada', async () => {
  const app = await api(openStore(':memory:'), fakeSounds(), conBuild());

  for (const ruta of [
    '/../../etc/passwd',
    '/%2e%2e%2f%2e%2e%2fetc%2fpasswd',
    '/..%2f..%2fetc%2fpasswd',
    '/assets/../../../etc/passwd',
    '/....//....//etc/passwd',
  ]) {
    const res = await app.get(ruta);
    assert.equal(res.status, 404, ruta);
  }
  app.close();
});
