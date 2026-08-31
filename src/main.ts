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
import { endpointStates, reload, writeTrunks } from './asterisk.ts';
import { serveApi } from './server.ts';
import { openStore } from './store.ts';
import type { Outcome } from './store.ts';
import { callVars } from './time.ts';
import type { AriAdmin, AriClient, Channel, Ctx, Flow, Trunk } from './types.ts';

const store = openStore(new URL('../janus.db', import.meta.url).pathname);

// La fuente del grafo es la base. Mutable: la UI publica y lo reemplaza en
// caliente, y cada llamada se queda con el que había al entrar.
// ponytail: flow.json ya solo siembra la primera arrancada. Cuando toda base en
// uso tenga su versión 1, se borran el fichero y estas dos líneas.
const seed = async () =>
  JSON.parse(await readFile(new URL('../flow.json', import.meta.url), 'utf8')) as Flow;
let flow: Flow = (store.latestFlow() ?? store.publish(await seed())).graph;

const client = (await ari.connect(
  'http://localhost:8088',
  'janus',
  'janus',
)) as unknown as AriClient & AriAdmin;

/** Llamadas vivas, por id de canal. Colgar aborta su señal. */
const active = new Map<string, AbortController>();

// ponytail: el laboratorio monta asterisk-config/etc en el contenedor. En una
// caja de verdad se apunta con ASTERISK_ETC=/etc/asterisk.
const configDir =
  process.env.ASTERISK_ETC ?? new URL('../asterisk-config/etc', import.meta.url).pathname;

/** Vuelca las troncales a Asterisk y las aplica. */
const apply = async (trunks: Trunk[]) => {
  writeTrunks(configDir, trunks);
  await reload(client, 'res_pjsip.so');
};

try {
  await apply(store.trunks());
  console.log(`✓ Asterisk aprovisionado: ${store.trunks().length} troncales`);
} catch (err) {
  // No es fatal: la API tiene que levantar igual para poder arreglarlo.
  console.error('✗ no se pudo aprovisionar Asterisk:', (err as Error).message);
}

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

serveApi({ get: () => flow, set: (nuevo) => { flow = nuevo; } }, store, {
  apply,
  states: (names) => endpointStates(client, names),
});
