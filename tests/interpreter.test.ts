/**
 * @fileoverview Tests del bucle del intérprete. Los nodos se inyectan, así que
 * esto corre sin Asterisk y sin tocar el reloj.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_STEPS, run, nextNode } from '../src/interpreter.ts';
import { NODES } from '../src/nodes.ts';
import { cancelable, Hungup } from '../src/cancel.ts';
import { callVars } from '../src/time.ts';
import { FakeChannel, FakeClient } from './fake-channel.ts';
import type { Ctx, Flow, Nodes } from '../src/types.ts';

const newCtx = (
  signal: AbortSignal = new AbortController().signal,
  vars: Record<string, unknown> = {},
): Ctx => ({
  signal,
  client: new FakeClient(),
  startedAt: new Date('2026-08-31T10:00:00Z'),
  vars,
  trace: [],
});

const anyChannel = () => new FakeChannel();

/** @return {string[]} Solo los ids del recorrido, sin timestamps. */
const path = (ctx: Ctx) => ctx.trace.map((step) => step.node);

const stubs: Nodes = {
  async press1() { return { digit: '1' }; },
  async press9() { return { digit: '9' }; },
  async hangup() {},
  async noop() {},
};

const menuWith = (type: string): Flow => ({
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
  await run(anyChannel(), menuWith('press1'), ctx, stubs);
  assert.deepEqual(path(ctx), ['menu', 'si']);
});

test('cae a la arista sin condición cuando no casa', async () => {
  const ctx = newCtx();
  await run(anyChannel(), menuWith('press9'), ctx, stubs);
  assert.deepEqual(path(ctx), ['menu', 'no']);
});

test('un callejón sin salida se marca en la traza', async () => {
  const ctx = newCtx();
  const flow = { start: 'a', nodes: [{ id: 'a', type: 'press1' }], edges: [] };
  await run(anyChannel(), flow, ctx, stubs);
  assert.deepEqual(path(ctx), ['a', '!dead-end']);
});

test('un nodo hangup termina sin marcar callejón', async () => {
  const ctx = newCtx();
  const flow = { start: 'a', nodes: [{ id: 'a', type: 'hangup' }], edges: [] };
  await run(anyChannel(), flow, ctx, stubs);
  assert.deepEqual(path(ctx), ['a']);
});

test('cada paso de la traza lleva su hora de entrada en UTC', async () => {
  const ctx = newCtx();
  await run(anyChannel(), menuWith('press1'), ctx, stubs);

  for (const step of ctx.trace) {
    assert.match(step.at, /^\d{4}-\d{2}-\d{2}T.*Z$/, 'ISO en UTC');
  }
});

test('las variables que produce un nodo quedan disponibles para las aristas', async () => {
  const ctx = newCtx();
  await run(anyChannel(), menuWith('press1'), ctx, stubs);
  assert.equal(ctx.vars.digit, '1');
});

test('nextNode devuelve null cuando ninguna arista casa', () => {
  const flow: Flow = {
    start: 'a',
    nodes: [{ id: 'a', type: 'noop' }, { id: 'b', type: 'noop' }],
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

const alas = async (iso: string) => {
  const startedAt = new Date(iso);
  const ctx = newCtx(undefined, callVars(startedAt, 'Europe/Madrid'));
  ctx.startedAt = startedAt;
  await run(anyChannel(), porHorario, ctx, stubs);
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

  const lentos: Nodes = {
    // un nodo que tarda lo suyo: una conversación real dura minutos
    async tarda() { await new Promise((resolve) => setTimeout(resolve, 5)); },
    async hangup() {},
    async noop() {},
  };
  const flow: Flow = {
    start: 'espera',
    nodes: [{ id: 'espera', type: 'tarda' }, ...porHorario.nodes],
    edges: [{ from: 'espera', to: 'entrada' }, ...porHorario.edges],
  };

  await run(anyChannel(), flow, ctx, lentos);
  assert.deepEqual(path(ctx), ['espera', 'entrada', 'tarde'], 'sigue siendo la de las 20:59');
});

// ─── El bug número uno del proyecto ──────────────────────────────────────────

test('el cuelgue corta un await pendiente y detiene el bucle', async () => {
  const controller = new AbortController();
  const ctx = newCtx(controller.signal);

  const slow: Nodes = {
    async wait(_channel, _config, ctx) {
      return cancelable<void>(ctx.signal, () => () => {});
    },
    async never() { assert.fail('no debe ejecutarse después del cuelgue'); },
  };
  const flow = {
    start: 'a',
    nodes: [{ id: 'a', type: 'wait' }, { id: 'b', type: 'never' }],
    edges: [{ from: 'a', to: 'b' }],
  };

  setTimeout(() => controller.abort(), 10);
  await assert.rejects(run(anyChannel(), flow, ctx, slow), (err) => err instanceof Hungup);
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

// ─── Ciclos ──────────────────────────────────────────────────────────────────

test('un ciclo sin salida se corta en vez de colgar el proceso', async () => {
  const ctx = newCtx();
  const flow: Flow = {
    start: 'a',
    nodes: [{ id: 'a', type: 'noop' }, { id: 'b', type: 'noop' }],
    edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }],
  };

  await assert.rejects(run(anyChannel(), flow, ctx, stubs, 10), /ciclo sin salida/);
  assert.equal(path(ctx).at(-1), '!too-many-steps', 'queda en la traza');
  assert.equal(ctx.trace.length, 11, '10 nodos y el marcador');
});

test('un ciclo que sí sale funciona con normalidad', async () => {
  const ctx = newCtx();
  const contador = { n: 0 };
  const nodos: Nodes = {
    async cuenta() { return { veces: ++contador.n }; },
    async hangup() {},
  };
  const flow: Flow = {
    start: 'menu',
    nodes: [{ id: 'menu', type: 'cuenta' }, { id: 'fin', type: 'hangup' }],
    edges: [
      { from: 'menu', to: 'fin', when: { '>=': [{ var: 'veces' }, 3] } },
      { from: 'menu', to: 'menu' },
    ],
  };

  await run(anyChannel(), flow, ctx, nodos);
  assert.deepEqual(path(ctx), ['menu', 'menu', 'menu', 'fin']);
});

test('el techo por defecto es holgado para un flujo normal', () => {
  assert.ok(MAX_STEPS >= 50);
});

// ─── El nodo de entrada ──────────────────────────────────────────────────────

test('la entrada no toca el canal y ramifica sin ejecutar nada antes', async () => {
  const flow: Flow = {
    start: 'entrada',
    nodes: [
      { id: 'entrada', type: 'entry' },
      { id: 'abierto', type: 'hangup' },
      { id: 'cerrado', type: 'hangup' },
    ],
    edges: [
      { from: 'entrada', to: 'abierto', when: { '>=': [{ var: 'hhmm' }, 900] } },
      { from: 'entrada', to: 'cerrado' },
    ],
  };
  const channel = anyChannel();
  const ctx = newCtx(undefined, { hhmm: 1030 });

  await run(channel, flow, ctx, NODES);

  assert.deepEqual(path(ctx), ['entrada', 'abierto'], 'la entrada es el primer paso de la traza');
  assert.deepEqual(channel.played, [], 'no ha reproducido nada');
  assert.equal(channel.answered, false, 'contesta el dialplan, no el flujo');
  assert.equal(channel.hungUp, true, 'ha llegado al hangup');
});

test('la entrada toma la arista por defecto cuando no casa la condición', async () => {
  const flow: Flow = {
    start: 'entrada',
    nodes: [
      { id: 'entrada', type: 'entry' },
      { id: 'abierto', type: 'hangup' },
      { id: 'cerrado', type: 'hangup' },
    ],
    edges: [
      { from: 'entrada', to: 'abierto', when: { '>=': [{ var: 'hhmm' }, 900] } },
      { from: 'entrada', to: 'cerrado' },
    ],
  };
  const ctx = newCtx(undefined, { hhmm: 330 });

  await run(anyChannel(), flow, ctx, NODES);

  assert.deepEqual(path(ctx), ['entrada', 'cerrado']);
});
