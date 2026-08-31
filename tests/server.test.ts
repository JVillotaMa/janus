/**
 * @fileoverview Tests de la API. Levantan el servidor de verdad en un puerto
 * que elige el sistema, con la base en memoria y un Asterisk de mentira: no
 * hace falta ni laboratorio ni contenedor.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { serveApi } from '../src/server.ts';
import type { FlowStore } from '../src/server.ts';
import { openStore } from '../src/store.ts';
import type { FlowVersion, Store } from '../src/store.ts';
import type { Flow } from '../src/types.ts';

const flow = (start: string): Flow => ({
  start,
  nodes: [{ id: start, type: 'entry' }, { id: 'fin', type: 'hangup' }],
  edges: [{ from: start, to: 'fin' }],
});

/** Asterisk no pinta nada en estos tests: ni se escribe fichero ni se recarga. */
const asterisk = { apply: async () => {}, states: async () => ({}) };

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
async function api(store: Store = openStore(':memory:')) {
  let live: FlowVersion = store.publish(flow('uno'));
  const flowStore: FlowStore = { get: () => live, set: (nuevo) => { live = nuevo; } };

  const server = serveApi(flowStore, store, asterisk, 0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    store,
    get: (path: string) => fetch(base + path),
    put: (path: string, body: unknown) =>
      fetch(base + path, { method: 'PUT', body: JSON.stringify(body) }),
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
