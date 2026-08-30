/**
 * @fileoverview Entrypoint: conecta con Asterisk y ata todas las piezas.
 *
 *   node src/main.ts
 */

import ari from 'ari-client';
import { readFile } from 'node:fs/promises';
import { Hungup } from './cancel.ts';
import { run } from './interpreter.ts';
import { APP, DIALED } from './nodes.ts';
import { serveApi } from './server.ts';
import { openStore } from './store.ts';
import type { Outcome } from './store.ts';
import { callVars } from './time.ts';
import type { AriClient, Channel, Ctx, Flow } from './types.ts';

const flowFile = new URL('../flow.json', import.meta.url);

// Mutable: la UI lo reemplaza en caliente. Cada llamada se queda con el que
// había al entrar, así que editar a mitad de una llamada no la afecta.
let flow: Flow = JSON.parse(await readFile(flowFile, 'utf8'));

const client = (await ari.connect(
  'http://localhost:8088',
  'janus',
  'janus',
)) as unknown as AriClient;

/** Llamadas vivas, por id de canal. Colgar aborta su señal. */
const active = new Map<string, AbortController>();

const store = openStore(new URL('../janus.db', import.meta.url).pathname);

client.on('StasisStart', async (event: { args?: string[] }, channel: Channel) => {
  if (event.args?.[0] === DIALED) return; // pata saliente de un `dial`, no una llamada

  const controller = new AbortController();
  active.set(channel.id, controller);

  const startedAt = new Date();
  const flowAtStart = flow;
  const ctx: Ctx = {
    signal: controller.signal,
    client,
    startedAt,
    vars: {
      caller: channel.caller?.number ?? null,
      did: event.args?.[0] ?? null,
      ...callVars(startedAt, flowAtStart.timezone ?? 'UTC'),
    },
    trace: [],
  };

  console.log(`→ entra ${channel.caller?.number || '?'}`);
  let outcome: Outcome = 'completed';
  try {
    await channel.answer();
    await run(channel, flowAtStart, ctx);
  } catch (err) {
    if (err instanceof Hungup) {
      outcome = 'hungup';
      console.log('  colgaron a mitad');
    } else {
      outcome = 'error';
      console.error('  error:', (err as Error).message);
    }
  } finally {
    active.delete(channel.id);
    store.save({
      id: channel.id,
      caller: ctx.vars.caller as string | null,
      did: ctx.vars.did as string | null,
      startedAt,
      endedAt: new Date(),
      outcome,
      vars: ctx.vars,
      trace: ctx.trace,
    });
    console.log(`← ${ctx.trace.map((step) => step.node).join(' → ')}  [${outcome}]`);
    console.log(`  vars=${JSON.stringify(ctx.vars)}`);
  }
});

const abort = (_event: unknown, channel: Channel) => active.get(channel.id)?.abort();
client.on('StasisEnd', abort);
client.on('ChannelHangupRequest', abort);

await (client as any).start(APP);
console.log(`janus escuchando como app "${APP}"`);

serveApi({ get: () => flow, set: (nuevo) => { flow = nuevo; } }, store, flowFile);
