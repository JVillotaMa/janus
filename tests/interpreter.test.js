/**
 * @fileoverview Tests del bucle del intérprete. Los nodos se inyectan, así que
 * esto corre sin Asterisk y sin tocar el reloj.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { run, nextNode, cancelable, callVars, Hungup } from '../engine.js';

const newCtx = (signal = new AbortController().signal, vars = {}) => ({
  signal,
  startedAt: new Date('2026-08-31T10:00:00Z'),
  vars,
  trace: [],
});

/** @return {string[]} Solo los ids del recorrido, sin timestamps. */
const path = (ctx) => ctx.trace.map((step) => step.node);

const stubs = {
  async press1() { return { digit: '1' }; },
  async press9() { return { digit: '9' }; },
  async hangup() {},
  async noop() {},
};

const menuWith = (type) => ({
  start: 'menu',
  nodes: [
    { id: 'menu', type },
    { id: 'si', type: 'hangup' },
    { id: 'no', type: 'hangup' },
  ],
  edges: [
    { from: 'menu', to: 'si', when: { '==': [{ var: 'digit' }, '1'] } },
    { from: 'menu', to: 'no' },
  ],
});

// ─── Recorrido ───────────────────────────────────────────────────────────────

test('la arista condicional gana cuando casa', async () => {
  const ctx = newCtx();
  await run(null, menuWith('press1'), ctx, stubs);
  assert.deepEqual(path(ctx), ['menu', 'si']);
});

test('cae a la arista sin condición cuando no casa', async () => {
  const ctx = newCtx();
  await run(null, menuWith('press9'), ctx, stubs);
  assert.deepEqual(path(ctx), ['menu', 'no']);
});

test('un callejón sin salida se marca en la traza', async () => {
  const ctx = newCtx();
  const flow = { start: 'a', nodes: [{ id: 'a', type: 'press1' }], edges: [] };
  await run(null, flow, ctx, stubs);
  assert.deepEqual(path(ctx), ['a', '!dead-end']);
});

test('un nodo hangup termina sin marcar callejón', async () => {
  const ctx = newCtx();
  const flow = { start: 'a', nodes: [{ id: 'a', type: 'hangup' }], edges: [] };
  await run(null, flow, ctx, stubs);
  assert.deepEqual(path(ctx), ['a']);
});

test('cada paso de la traza lleva su hora de entrada en UTC', async () => {
  const ctx = newCtx();
  await run(null, menuWith('press1'), ctx, stubs);

  for (const step of ctx.trace) {
    assert.match(step.at, /^\d{4}-\d{2}-\d{2}T.*Z$/, 'ISO en UTC');
  }
});

test('las variables que produce un nodo quedan disponibles para las aristas', async () => {
  const ctx = newCtx();
  await run(null, menuWith('press1'), ctx, stubs);
  assert.equal(ctx.vars.digit, '1');
});

test('nextNode devuelve null cuando ninguna arista casa', () => {
  const flow = {
    nodes: [{ id: 'a' }, { id: 'b' }],
    edges: [{ from: 'a', to: 'b', when: { '==': [{ var: 'digit' }, '5'] } }],
  };
  assert.equal(nextNode(flow, 'a', { digit: '1' }), null);
});

// ─── Enrutado por horario ────────────────────────────────────────────────────

const porHorario = {
  start: 'entrada',
  nodes: [
    { id: 'entrada', type: 'noop' },
    { id: 'tarde', type: 'hangup' },
    { id: 'noche', type: 'hangup' },
  ],
  edges: [
    {
      from: 'entrada', to: 'tarde',
      when: { and: [{ '>=': [{ var: 'hhmm' }, 1900] }, { '<': [{ var: 'hhmm' }, 2100] }] },
    },
    {
      from: 'entrada', to: 'noche',
      when: { and: [{ '>=': [{ var: 'hhmm' }, 2100] }, { '<': [{ var: 'hhmm' }, 2400] }] },
    },
  ],
};

const alas = async (iso) => {
  const startedAt = new Date(iso);
  const ctx = newCtx(undefined, callVars(startedAt, 'Europe/Madrid'));
  ctx.startedAt = startedAt;
  await run(null, porHorario, ctx, stubs);
  return path(ctx);
};

test('20:59 en Madrid sale por la rama de tarde', async () => {
  assert.deepEqual(await alas('2026-08-31T18:59:00Z'), ['entrada', 'tarde']);
});

test('21:01 en Madrid sale por la rama de noche', async () => {
  assert.deepEqual(await alas('2026-08-31T19:01:00Z'), ['entrada', 'noche']);
});

test('18:00 en Madrid no casa con ninguna y se marca el callejón', async () => {
  assert.deepEqual(await alas('2026-08-31T16:00:00Z'), ['entrada', '!dead-end']);
});

test('la hora se fija al entrar y no se recalcula por el camino', async () => {
  const startedAt = new Date('2026-08-31T18:59:00Z'); // 20:59 en Madrid
  const ctx = newCtx(undefined, callVars(startedAt, 'Europe/Madrid'));
  ctx.startedAt = startedAt;

  const lentos = {
    // un nodo que tarda lo suyo: una conversación real dura minutos
    async tarda() { await new Promise((r) => setTimeout(r, 5)); },
    async hangup() {},
    async noop() {},
  };
  const flow = {
    start: 'espera',
    nodes: [{ id: 'espera', type: 'tarda' }, ...porHorario.nodes],
    edges: [{ from: 'espera', to: 'entrada' }, ...porHorario.edges],
  };

  await run(null, flow, ctx, lentos);
  assert.deepEqual(path(ctx), ['espera', 'entrada', 'tarde'], 'sigue siendo la de las 20:59');
});

// ─── El bug número uno del proyecto ──────────────────────────────────────────

test('el cuelgue corta un await pendiente y detiene el bucle', async () => {
  const controller = new AbortController();
  const ctx = newCtx(controller.signal);

  const slow = {
    async wait(_channel, _config, ctx) { return cancelable(ctx.signal, () => () => {}); },
    async never() { assert.fail('no debe ejecutarse después del cuelgue'); },
  };
  const flow = {
    start: 'a',
    nodes: [{ id: 'a', type: 'wait' }, { id: 'b', type: 'never' }],
    edges: [{ from: 'a', to: 'b' }],
  };

  setTimeout(() => controller.abort(), 10);
  await assert.rejects(run(null, flow, ctx, slow), (err) => err instanceof Hungup);
  assert.deepEqual(path(ctx), ['a'], 'no debe avanzar al siguiente nodo');
});

test('cancelable limpia sus listeners al cancelar', async () => {
  const controller = new AbortController();
  let limpiado = false;
  const pending = cancelable(controller.signal, () => () => { limpiado = true; });

  controller.abort();

  await assert.rejects(pending, (err) => err instanceof Hungup);
  assert.ok(limpiado, 'sin esto se acumulan listeners zombi por llamada');
});

test('cancelable rechaza de inmediato si ya habían colgado', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    cancelable(controller.signal, () => () => {}),
    (err) => err instanceof Hungup,
  );
});
