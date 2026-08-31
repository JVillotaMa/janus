/**
 * @fileoverview Tests de la persistencia. Base en memoria, salvo los de la
 * migración: esos necesitan un fichero con el esquema viejo, y van a un tmpdir.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/store.ts';
import type { CallRecord } from '../src/store.ts';
import type { Flow } from '../src/types.ts';
import type { Trunk } from '../src/store.ts';

const call = (over: Partial<CallRecord> = {}): CallRecord => ({
  id: 'canal-1',
  caller: '+34600111222',
  did: '900123456',
  startedAt: new Date('2026-08-30T17:00:00.000Z'),
  endedAt: new Date('2026-08-30T17:00:12.000Z'),
  outcome: 'completed',
  flowVersion: 1,
  vars: { digit: '1', dial: 'answered' },
  trace: [
    { node: 'entrada', at: '2026-08-30T17:00:00.000Z' },
    { node: 'menu', at: '2026-08-30T17:00:02.000Z' },
    { node: 'fin', at: '2026-08-30T17:00:11.000Z' },
  ],
  ...over,
});

test('guarda una llamada y la devuelve entera', () => {
  const store = openStore(':memory:');
  store.save(call());

  const [saved] = store.recent();
  assert.equal(saved!.id, 'canal-1');
  assert.equal(saved!.caller, '+34600111222');
  assert.equal(saved!.did, '900123456');
  assert.equal(saved!.outcome, 'completed');
  store.close();
});

test('la traza vuelve en orden', () => {
  const store = openStore(':memory:');
  store.save(call());

  assert.deepEqual(
    store.recent()[0]!.trace.map((step) => step.node),
    ['entrada', 'menu', 'fin'],
  );
  store.close();
});

test('las variables sobreviven al viaje de ida y vuelta', () => {
  const store = openStore(':memory:');
  store.save(call({ vars: { digit: null, hhmm: 1930, caller: 'jaime' } }));

  assert.deepEqual(store.recent()[0]!.vars, { digit: null, hhmm: 1930, caller: 'jaime' });
  store.close();
});

test('las fechas vuelven como Date, no como texto', () => {
  const store = openStore(':memory:');
  store.save(call());

  const [saved] = store.recent();
  assert.ok(saved!.startedAt instanceof Date);
  assert.equal(saved!.startedAt.toISOString(), '2026-08-30T17:00:00.000Z');
  store.close();
});

test('las llamadas salen de más reciente a más antigua', () => {
  const store = openStore(':memory:');
  store.save(call({ id: 'vieja', startedAt: new Date('2026-08-30T10:00:00.000Z') }));
  store.save(call({ id: 'nueva', startedAt: new Date('2026-08-30T18:00:00.000Z') }));

  assert.deepEqual(store.recent().map((c) => c.id), ['nueva', 'vieja']);
  store.close();
});

test('recent respeta el límite', () => {
  const store = openStore(':memory:');
  for (let i = 0; i < 5; i++) store.save(call({ id: `c${i}` }));

  assert.equal(store.recent(2).length, 2);
  store.close();
});

test('guardar dos veces el mismo canal no duplica pasos', () => {
  const store = openStore(':memory:');
  store.save(call());
  store.save(call());

  assert.equal(store.recent().length, 1);
  assert.equal(store.recent()[0]!.trace.length, 3);
  store.close();
});

test('una llamada colgada a mitad guarda su traza parcial', () => {
  const store = openStore(':memory:');
  store.save(call({
    outcome: 'hungup',
    trace: [{ node: 'entrada', at: '2026-08-30T17:00:00.000Z' }],
  }));

  const [saved] = store.recent();
  assert.equal(saved!.outcome, 'hungup');
  assert.deepEqual(saved!.trace.map((s) => s.node), ['entrada']);
  store.close();
});

test('una llamada sin pasos se guarda igual', () => {
  const store = openStore(':memory:');
  store.save(call({ outcome: 'error', trace: [] }));

  assert.deepEqual(store.recent()[0]!.trace, []);
  store.close();
});

test('caller y did pueden faltar', () => {
  const store = openStore(':memory:');
  store.save(call({ caller: null, did: null }));

  const [saved] = store.recent();
  assert.equal(saved!.caller, null);
  assert.equal(saved!.did, null);
  store.close();
});

const flow = (start: string): Flow => ({
  start,
  nodes: [{ id: start, type: 'hangup' }],
  edges: [],
});

test('publicar crea versión nueva y la última gana', () => {
  const store = openStore(':memory:');

  assert.equal(store.latestFlow(), null);
  assert.equal(store.publish(flow('uno')).version, 1);
  assert.equal(store.publish(flow('dos')).version, 2);

  const latest = store.latestFlow()!;
  assert.equal(latest.version, 2);
  assert.equal(latest.graph.start, 'dos');
  assert.equal(latest.graph.nodes[0]!.type, 'hangup');
  store.close();
});

test('las versiones se listan de la más reciente a la más antigua', () => {
  const store = openStore(':memory:');
  store.publish(flow('uno'));
  store.publish(flow('dos'));
  store.publish(flow('tres'));

  assert.deepEqual(store.flowVersions().map((v) => v.version), [3, 2, 1]);
  store.close();
});

test('la lista de versiones lleva el tamaño del grafo, no el grafo', () => {
  const store = openStore(':memory:');
  store.publish({
    start: 'a',
    nodes: [{ id: 'a', type: 'entry' }, { id: 'b', type: 'hangup' }],
    edges: [{ from: 'a', to: 'b' }],
  });

  const [ultima] = store.flowVersions();
  assert.equal(ultima!.nodes, 2);
  assert.equal(ultima!.edges, 1);
  assert.ok(ultima!.publishedAt instanceof Date);
  assert.equal('graph' in ultima!, false);
  store.close();
});

test('flowAt devuelve cada versión tal y como se publicó', () => {
  const store = openStore(':memory:');
  store.publish(flow('uno'));
  store.publish(flow('dos'));

  assert.equal(store.flowAt(1)!.graph.start, 'uno');
  assert.equal(store.flowAt(2)!.graph.start, 'dos');
  store.close();
});

test('flowAt de una versión que no existe devuelve null', () => {
  const store = openStore(':memory:');
  store.publish(flow('uno'));

  assert.equal(store.flowAt(7), null);
  store.close();
});

test('leer una versión anterior no cambia cuál es la última', () => {
  const store = openStore(':memory:');
  store.publish(flow('uno'));
  store.publish(flow('dos'));
  store.flowAt(1);

  assert.equal(store.latestFlow()!.version, 2);
  store.close();
});

test('la llamada conserva la versión con la que entró', () => {
  const store = openStore(':memory:');
  store.save(call({ flowVersion: 3 }));

  assert.equal(store.recent()[0]!.flowVersion, 3);
  store.close();
});

test('una llamada sin versión conocida vuelve como null, no como un número', () => {
  const store = openStore(':memory:');
  store.save(call({ flowVersion: null }));

  assert.equal(store.recent()[0]!.flowVersion, null);
  store.close();
});

// La base del dueño existe desde antes de que la llamada guardase su versión.
// Se migra: ni se borra ni se recrea.
const conEsquemaViejo = (): string => {
  const file = join(mkdtempSync(join(tmpdir(), 'janus-')), 'viejo.db');
  const db = new Database(file);
  db.exec(`
    CREATE TABLE calls (
      id TEXT PRIMARY KEY, caller TEXT, did TEXT,
      started_at TEXT NOT NULL, ended_at TEXT NOT NULL,
      outcome TEXT NOT NULL, vars TEXT NOT NULL
    );
    INSERT INTO calls VALUES
      ('vieja', '600', '900', '2026-08-01T10:00:00.000Z', '2026-08-01T10:00:09.000Z',
       'completed', '{"digit":"1"}');
  `);
  db.close();
  return file;
};

test('una base anterior se migra sin perder llamadas', () => {
  const store = openStore(conEsquemaViejo());

  const [vieja] = store.recent();
  assert.equal(vieja!.id, 'vieja');
  assert.equal(vieja!.caller, '600');
  assert.deepEqual(vieja!.vars, { digit: '1' });
  assert.equal(vieja!.flowVersion, null);
  store.close();
});

test('abrir dos veces una base ya migrada no falla ni repite la migración', () => {
  const file = conEsquemaViejo();
  openStore(file).close();

  const store = openStore(file);
  store.save(call({ id: 'nueva', flowVersion: 2 }));
  assert.deepEqual(
    store.recent().map((c) => [c.id, c.flowVersion]),
    [['nueva', 2], ['vieja', null]],
  );
  store.close();
});

test('una base nueva nace con la columna de versión', () => {
  const store = openStore(':memory:');
  store.save(call({ flowVersion: 5 }));

  assert.equal(store.recent()[0]!.flowVersion, 5);
  store.close();
});

const trunk = (over: Partial<Trunk> = {}): Trunk => ({
  name: 'masmovil',
  host: 'sip.masmovil.es',
  mode: 'register',
  username: 'u123',
  password: 'secreto',
  ...over,
});

test('guarda troncales y las devuelve ordenadas', () => {
  const store = openStore(':memory:');
  store.saveTrunks([trunk({ name: 'voztele' }), trunk()]);

  assert.deepEqual(store.trunks().map((t) => t.name), ['masmovil', 'voztele']);
  store.close();
});

test('la colección se reemplaza entera: omitir una troncal la borra', () => {
  const store = openStore(':memory:');
  store.saveTrunks([trunk(), trunk({ name: 'voztele' })]);
  store.saveTrunks([trunk()]);

  assert.deepEqual(store.trunks().map((t) => t.name), ['masmovil']);
  store.close();
});

test('una troncal que llega sin contraseña conserva la guardada', () => {
  const store = openStore(':memory:');
  store.saveTrunks([trunk({ password: 'secreto' })]);

  // Es lo que reenvía la UI: la lista que acaba de leer, ya sin el secreto.
  store.saveTrunks([trunk({ password: undefined, host: 'sip.nuevo.es' })]);

  const [guardada] = store.trunks();
  assert.equal(guardada!.password, 'secreto');
  assert.equal(guardada!.host, 'sip.nuevo.es');
  store.close();
});

test('una contraseña nueva sustituye a la guardada', () => {
  const store = openStore(':memory:');
  store.saveTrunks([trunk({ password: 'vieja' })]);
  store.saveTrunks([trunk({ password: 'nueva' })]);

  assert.equal(store.trunks()[0]!.password, 'nueva');
  store.close();
});

test('el modo identify no guarda credenciales', () => {
  const store = openStore(':memory:');
  store.saveTrunks([
    { name: 'voztele', host: 'sip.voztele.com', mode: 'identify', matchIp: '212.0.0.5' },
  ]);

  const [guardada] = store.trunks();
  assert.equal(guardada!.password, null);
  assert.equal(guardada!.matchIp, '212.0.0.5');
  store.close();
});
