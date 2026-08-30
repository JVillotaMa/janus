/**
 * @fileoverview Tests de la persistencia. Base en memoria: no tocan disco.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store.ts';
import type { CallRecord } from '../src/store.ts';

const call = (over: Partial<CallRecord> = {}): CallRecord => ({
  id: 'canal-1',
  caller: '+34600111222',
  did: '900123456',
  startedAt: new Date('2026-08-30T17:00:00.000Z'),
  endedAt: new Date('2026-08-30T17:00:12.000Z'),
  outcome: 'completed',
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
