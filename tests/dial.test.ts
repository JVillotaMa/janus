/**
 * @fileoverview Tests del nodo `dial`. El cliente ARI es de mentira: las patas
 * salientes contestan o se caen cuando el test lo dice.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { NODES, DIALED } from '../src/nodes.ts';
import { defaults } from '../src/schema.ts';
import { Hungup } from '../src/cancel.ts';
import { run } from '../src/interpreter.ts';
import { FakeChannel, FakeClient, tick } from './fake-channel.ts';
import type { Ctx, Flow } from '../src/types.ts';

const newCtx = (client: FakeClient, signal: AbortSignal = new AbortController().signal): Ctx => ({
  signal,
  client,
  startedAt: new Date('2026-08-31T10:00:00Z'),
  vars: {},
  trace: [],
});

const path = (ctx: Ctx) => ctx.trace.map((step) => step.node);

test('origina hacia el endpoint configurado y marca la pata saliente', async () => {
  const client = new FakeClient();
  const running = NODES.dial!(new FakeChannel(), { endpoint: 'PJSIP/ana' }, newCtx(client));
  await tick();

  assert.equal(client.originated[0]!.endpoint, 'PJSIP/ana');
  assert.equal(client.originated[0]!.appArgs, DIALED, 'sin la marca, el handler la trata como llamada nueva');

  client.destroys(client.lastOutbound, 19);
  await running;
});

// Contra el esquema y no contra un 30 escrito aquí: el defecto que aplica el
// motor y el que enseña el formulario tienen que ser el mismo dato.
test('usa el timeout que declara el esquema por defecto', async () => {
  const client = new FakeClient();
  const running = NODES.dial!(new FakeChannel(), { endpoint: 'PJSIP/ana' }, newCtx(client));
  await tick();

  assert.equal(client.originated[0]!.timeout, defaults('dial').timeout);

  client.destroys(client.lastOutbound, 19);
  await running;
});

test('si contesta, puentea las dos patas', async () => {
  const client = new FakeClient();
  const caller = new FakeChannel('caller');
  const running = NODES.dial!(caller, { endpoint: 'PJSIP/ana' }, newCtx(client));
  await tick();

  client.answers();
  await tick();

  assert.deepEqual(client.lastBridge.channels, ['caller', 'out-1']);

  client.destroys(client.lastOutbound, 16);
  assert.deepEqual(await running, { dial: 'answered' });
});

test('al colgar el llamado se deshace el bridge y el nodo devuelve answered', async () => {
  const client = new FakeClient();
  const running = NODES.dial!(new FakeChannel(), { endpoint: 'PJSIP/ana' }, newCtx(client));
  await tick();

  client.answers();
  await tick();
  client.destroys(client.lastOutbound, 16);

  assert.deepEqual(await running, { dial: 'answered' });
  assert.equal(client.lastBridge.destroyed, true);
});

test('comunicando devuelve busy y no llega a crear bridge', async () => {
  const client = new FakeClient();
  const running = NODES.dial!(new FakeChannel(), { endpoint: 'PJSIP/ana' }, newCtx(client));
  await tick();

  client.destroys(client.lastOutbound, 17);

  assert.deepEqual(await running, { dial: 'busy' });
  assert.equal(client.createdBridges.length, 0);
});

test('sin respuesta devuelve noanswer', async () => {
  const client = new FakeClient();
  const running = NODES.dial!(new FakeChannel(), { endpoint: 'PJSIP/ana' }, newCtx(client));
  await tick();

  client.destroys(client.lastOutbound, 19);

  assert.deepEqual(await running, { dial: 'noanswer' });
});

test('una causa desconocida cae en failed', async () => {
  const client = new FakeClient();
  const running = NODES.dial!(new FakeChannel(), { endpoint: 'PJSIP/ana' }, newCtx(client));
  await tick();

  client.destroys(client.lastOutbound, 34);

  assert.deepEqual(await running, { dial: 'failed' });
});

// ─── Cuelgue del que llama ───────────────────────────────────────────────────

test('si cuelgan mientras suena, se cuelga también la pata saliente', async () => {
  const client = new FakeClient();
  const controller = new AbortController();
  const running = NODES.dial!(new FakeChannel(), { endpoint: 'PJSIP/ana' }, newCtx(client, controller.signal));
  await tick();

  controller.abort();

  await assert.rejects(running, (err) => err instanceof Hungup);
  assert.equal(client.lastOutbound.hungUp, true, 'si no, ana sigue sonando sola');
});

test('si cuelgan durante la conversación, se destruye el bridge y se cuelga la saliente', async () => {
  const client = new FakeClient();
  const controller = new AbortController();
  const running = NODES.dial!(new FakeChannel(), { endpoint: 'PJSIP/ana' }, newCtx(client, controller.signal));
  await tick();

  client.answers();
  await tick();
  controller.abort();

  await assert.rejects(running, (err) => err instanceof Hungup);
  assert.equal(client.lastBridge.destroyed, true);
  assert.equal(client.lastOutbound.hungUp, true);
});

test('no deja listeners en el cliente ARI', async () => {
  const client = new FakeClient();
  const running = NODES.dial!(new FakeChannel(), { endpoint: 'PJSIP/ana' }, newCtx(client));
  await tick();

  client.answers();
  await tick();
  client.destroys(client.lastOutbound, 16);
  await running;

  assert.equal(client.liveListeners, 0);
});

test('no deja listeners en el cliente ARI al cancelar', async () => {
  const client = new FakeClient();
  const controller = new AbortController();
  const running = NODES.dial!(new FakeChannel(), { endpoint: 'PJSIP/ana' }, newCtx(client, controller.signal));
  await tick();

  controller.abort();
  await running.catch(() => {});

  assert.equal(client.liveListeners, 0);
});

// ─── La razón de ser del proyecto ────────────────────────────────────────────

test('dial NO es terminal: el bucle sigue y enruta con el resultado', async () => {
  const client = new FakeClient();
  const ctx = newCtx(client);
  const flow = {
    start: 'llamar',
    nodes: [
      { id: 'llamar', type: 'dial', config: { endpoint: 'PJSIP/ana' } },
      { id: 'buzon', type: 'hangup' },
      { id: 'encuesta', type: 'hangup' },
    ],
    edges: [
      { from: 'llamar', to: 'buzon', when: { '==': [{ var: 'dial' }, 'noanswer'] } },
      { from: 'llamar', to: 'encuesta' },
    ],
  };

  const running = run(new FakeChannel(), flow, ctx);
  await tick();
  client.destroys(client.lastOutbound, 19);
  await running;

  assert.deepEqual(path(ctx), ['llamar', 'buzon']);
  assert.equal(ctx.vars.dial, 'noanswer');
});

test('tras una llamada atendida el bucle continúa por la otra rama', async () => {
  const client = new FakeClient();
  const ctx = newCtx(client);
  const flow = {
    start: 'llamar',
    nodes: [
      { id: 'llamar', type: 'dial', config: { endpoint: 'PJSIP/ana' } },
      { id: 'buzon', type: 'hangup' },
      { id: 'encuesta', type: 'hangup' },
    ],
    edges: [
      { from: 'llamar', to: 'buzon', when: { '==': [{ var: 'dial' }, 'noanswer'] } },
      { from: 'llamar', to: 'encuesta' },
    ],
  };

  const running = run(new FakeChannel(), flow, ctx);
  await tick();
  client.answers();
  await tick();
  client.destroys(client.lastOutbound, 16);
  await running;

  assert.deepEqual(path(ctx), ['llamar', 'encuesta'], 'el handback: la llamada vuelve al flujo');
});
