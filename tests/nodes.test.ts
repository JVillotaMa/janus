/**
 * @fileoverview Tests de las implementaciones de nodo. Deterministas: el canal
 * es de mentira y el tiempo se controla con los timers simulados de node:test.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { NODES } from '../src/nodes.ts';
import { defaults } from '../src/schema.ts';
import { Hungup } from '../src/cancel.ts';
import { FakeChannel, FakeClient, tick } from './fake-channel.ts';
import type { Ctx } from '../src/types.ts';

const newCtx = (signal: AbortSignal = new AbortController().signal): Ctx => ({
  signal,
  client: new FakeClient(),
  startedAt: new Date('2026-08-30T10:00:00Z'),
  vars: {},
  trace: [],
});

// ─── say ─────────────────────────────────────────────────────────────────────

test('say reproduce el media que le pasan', async () => {
  const channel = new FakeChannel();
  const running = NODES.say!(channel, { media: 'sound:hola' }, newCtx());
  await tick();

  assert.deepEqual(channel.played, ['sound:hola']);
  channel.playing.finish();
  await running;
});

test('say no resuelve mientras el audio sigue sonando', async () => {
  const channel = new FakeChannel();
  let acabado = false;
  const running = NODES.say!(channel, { media: 'sound:hola' }, newCtx())
    .then(() => { acabado = true; });

  await tick();
  await tick();
  assert.equal(acabado, false, 'play() resuelve al arrancar, no al terminar');

  channel.playing.finish();
  await running;
  assert.equal(acabado, true);
});

test('say rechaza con Hungup si cuelgan durante el audio', async () => {
  const channel = new FakeChannel();
  const controller = new AbortController();
  const running = NODES.say!(channel, { media: 'sound:hola' }, newCtx(controller.signal));

  await tick();
  controller.abort();

  await assert.rejects(running, (err) => err instanceof Hungup);
});

test('say no deja listeners en el playback al cancelar', async () => {
  const channel = new FakeChannel();
  const controller = new AbortController();
  const running = NODES.say!(channel, { media: 'sound:hola' }, newCtx(controller.signal));

  await tick();
  controller.abort();
  await running.catch(() => {});

  assert.equal(channel.playing.listenerCount('PlaybackFinished'), 0);
});

test('say no deja listeners en el playback al terminar bien', async () => {
  const channel = new FakeChannel();
  const running = NODES.say!(channel, { media: 'sound:hola' }, newCtx());

  await tick();
  channel.playing.finish();
  await running;

  assert.equal(channel.playing.listenerCount('PlaybackFinished'), 0);
});

test('say rechaza de inmediato si ya habían colgado', async () => {
  const channel = new FakeChannel();
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    NODES.say!(channel, { media: 'sound:hola' }, newCtx(controller.signal)),
    (err) => err instanceof Hungup,
  );
});

// ─── gather ──────────────────────────────────────────────────────────────────

test('gather sin media no reproduce nada y escucha directamente', async () => {
  const channel = new FakeChannel();
  const running = NODES.gather!(channel, {}, newCtx());
  await tick();

  assert.deepEqual(channel.played, []);
  assert.equal(channel.dtmfListeners, 1);

  channel.pressDigit('7');
  assert.deepEqual(await running, { digit: '7' });
});

test('gather reproduce el prompt entero antes de escuchar (sin barge-in)', async () => {
  const channel = new FakeChannel();
  const running = NODES.gather!(channel, { media: 'sound:menu' }, newCtx());
  await tick();

  assert.deepEqual(channel.played, ['sound:menu']);
  assert.equal(channel.dtmfListeners, 0, 'todavía no escucha: no hay barge-in');

  channel.playing.finish();
  await tick();
  assert.equal(channel.dtmfListeners, 1);

  channel.pressDigit('2');
  assert.deepEqual(await running, { digit: '2' });
});

test('gather devuelve el primer dígito e ignora los siguientes', async () => {
  const channel = new FakeChannel();
  const running = NODES.gather!(channel, {}, newCtx());
  await tick();

  channel.pressDigit('1');
  channel.pressDigit('9');

  assert.deepEqual(await running, { digit: '1' });
});

test('gather devuelve null cuando vence el timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const channel = new FakeChannel();
  const running = NODES.gather!(channel, { timeout: 5000 }, newCtx());
  await tick();

  t.mock.timers.tick(4999);
  await tick();
  assert.equal(channel.dtmfListeners, 1, 'sigue esperando un instante antes');

  t.mock.timers.tick(1);
  assert.deepEqual(await running, { digit: null });
});

// El defecto se comprueba contra el esquema, no contra un número escrito aquí:
// lo que importa es que el motor aplique exactamente lo que el formulario enseña.
test('gather espera el timeout que declara el esquema', async (t) => {
  const esperado = defaults('gather').timeout as number;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const channel = new FakeChannel();
  const running = NODES.gather!(channel, {}, newCtx());
  await tick();

  t.mock.timers.tick(esperado - 1);
  assert.equal(channel.dtmfListeners, 1, 'todavía escuchando justo antes del vencimiento');

  t.mock.timers.tick(1);
  assert.deepEqual(await running, { digit: null });
});

test('gather rechaza si cuelgan mientras espera el dígito', async () => {
  const channel = new FakeChannel();
  const controller = new AbortController();
  const running = NODES.gather!(channel, {}, newCtx(controller.signal));

  await tick();
  controller.abort();

  await assert.rejects(running, (err) => err instanceof Hungup);
});

test('gather rechaza si cuelgan durante el prompt', async () => {
  const channel = new FakeChannel();
  const controller = new AbortController();
  const running = NODES.gather!(channel, { media: 'sound:menu' }, newCtx(controller.signal));

  await tick();
  controller.abort();

  await assert.rejects(running, (err) => err instanceof Hungup);
  assert.equal(channel.dtmfListeners, 0, 'nunca llegó a suscribirse');
});

test('gather no deja listeners de DTMF tras devolver un dígito', async () => {
  const channel = new FakeChannel();
  const running = NODES.gather!(channel, {}, newCtx());
  await tick();

  channel.pressDigit('3');
  await running;

  assert.equal(channel.dtmfListeners, 0);
});

test('gather no deja listeners de DTMF al cancelar', async () => {
  const channel = new FakeChannel();
  const controller = new AbortController();
  const running = NODES.gather!(channel, {}, newCtx(controller.signal));

  await tick();
  assert.equal(channel.dtmfListeners, 1);

  controller.abort();
  await running.catch(() => {});

  assert.equal(channel.dtmfListeners, 0, 'un listener zombi por llamada colgada');
});

test('gather no deja listeners de DTMF al vencer el timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const channel = new FakeChannel();
  const running = NODES.gather!(channel, { timeout: 1000 }, newCtx());
  await tick();

  t.mock.timers.tick(1000);
  await running;

  assert.equal(channel.dtmfListeners, 0);
});

// ─── hangup ──────────────────────────────────────────────────────────────────

test('hangup cuelga el canal', async () => {
  const channel = new FakeChannel();
  assert.equal(channel.hungUp, false);

  await NODES.hangup!(channel, {}, newCtx());

  assert.equal(channel.hungUp, true);
});
