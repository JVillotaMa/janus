/**
 * @fileoverview Intérprete de flujos de llamada sobre Asterisk vía ARI.
 *
 * El grafo es un dato: se lee, se recorre y se ejecuta. No se compila. Toda la
 * lógica vive aquí, en código normal, y Asterisk queda como motor de medios.
 */

import ari from 'ari-client';
import jsonLogic from 'json-logic-js';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';

/**
 * @typedef {Object} Ctx Estado de una llamada mientras recorre el grafo.
 * @property {AbortSignal} signal Se dispara cuando el canal cuelga.
 * @property {Object} client Cliente ARI, para los nodos que crean canales.
 * @property {Date} startedAt Instante en que entró la llamada, en UTC.
 * @property {Object<string, *>} vars Variables que van produciendo los nodos.
 * @property {Array<{node: string, at: string}>} trace Nodos recorridos, en
 *     orden, con la hora de entrada en UTC. Es el origen de `call_steps`.
 */

/**
 * @typedef {Object} Flow Un flujo de llamada completo.
 * @property {string} start Id del nodo por el que se empieza.
 * @property {string} [timezone] Zona IANA del negocio, p.ej. `Europe/Madrid`.
 *     Nunca un offset (`+02:00`): el offset cambia con el horario de verano.
 *     Por defecto `UTC`.
 * @property {Array<{id: string, type: string, config?: Object}>} nodes
 * @property {Array<{from: string, to: string, when?: Object}>} edges
 *     `when` es una expresión jsonlogic evaluada contra `Ctx.vars`.
 */

/** Error con el que se rechaza cualquier espera cuando el canal cuelga. */
/** Nombre con el que el motor se registra en Asterisk. */
export const APP = 'janus';

/** Marca de los canales que origina el nodo `dial`, para no confundirlos con llamadas. */
export const DIALED = 'dialed';

export class Hungup extends Error {
  constructor() {
    super('el canal colgó');
    this.name = 'Hungup';
  }
}

/**
 * Espera a un evento, salvo que el canal cuelgue antes.
 *
 * Es el único punto del motor donde se espera algo. Al centralizarlo aquí, la
 * cancelación por cuelgue se maneja una vez y ningún nodo tiene que acordarse.
 * Un `await` crudo dentro de un nodo reintroduce el bug de las llamadas zombi.
 *
 * @param {AbortSignal} signal Señal que se dispara al colgar.
 * @param {function(function(*): void): (function(): void)} subscribe Recibe un
 *     callback `done(valor)` y devuelve la función que deshace la suscripción.
 * @return {Promise<*>} El valor pasado a `done`.
 * @throws {Hungup} Si el canal cuelga antes de que `done` se llame.
 */
export function cancelable(signal, subscribe) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Hungup());

    let unsubscribe = null;
    let settled = false;

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      unsubscribe?.();
      signal.removeEventListener('abort', onHangup);
      fn(value);
    };
    const onHangup = () => settle(reject, new Hungup());

    signal.addEventListener('abort', onHangup, { once: true });
    unsubscribe = subscribe((value) => settle(resolve, value));
    if (settled) unsubscribe?.();
  });
}

/**
 * Reproduce un audio y espera a que suene entero.
 *
 * @param {Object} channel Canal de ari-client.
 * @param {string} media Recurso ARI, p.ej. `sound:hello-world`.
 * @param {AbortSignal} signal
 * @return {Promise<void>}
 */
async function playToEnd(channel, media, signal) {
  const playback = await channel.play({ media });
  return cancelable(signal, (done) => {
    playback.once('PlaybackFinished', () => done());
    return () => playback.removeAllListeners('PlaybackFinished');
  });
}

/**
 * Espera a que se pulse una tecla.
 *
 * @param {Object} channel Canal de ari-client.
 * @param {number} timeout Milisegundos antes de rendirse.
 * @param {AbortSignal} signal
 * @return {Promise<?string>} El dígito pulsado, o `null` si venció el timeout.
 */
function readDigit(channel, timeout, signal) {
  return cancelable(signal, (done) => {
    const onDigit = (event) => done(event.digit);
    const timer = setTimeout(() => done(null), timeout);
    channel.on('ChannelDtmfReceived', onDigit);
    return () => {
      channel.removeListener('ChannelDtmfReceived', onDigit);
      clearTimeout(timer);
    };
  });
}

/**
 * Implementaciones de nodo, indexadas por `type`.
 *
 * Todas comparten la firma `(channel, config, ctx) => Promise<vars|void>`. Lo
 * que devuelven se mezcla en `ctx.vars` y queda disponible para las condiciones
 * de las aristas. Añadir un tipo de nodo es añadir una función a este objeto.
 *
 * @type {Object<string, function(Object, Object, Ctx): Promise<?Object>>}
 */
/**
 * Deriva las variables de calendario de una llamada, en la zona del negocio.
 *
 * Se calculan una sola vez desde `Ctx.startedAt`, no en cada nodo: una llamada
 * que entra a las 20:59 tiene que seguir el camino de las 20:59 aunque llegue a
 * la rama dos minutos después.
 *
 * @param {Date} startedAt Instante de inicio, en UTC.
 * @param {string} timezone Zona IANA. Un offset fijo fallaría medio año.
 * @return {{date: string, hhmm: number, weekday: number}} `hhmm` es la hora de
 *     pared como entero (19:30 -> 1930), para que los rangos en jsonlogic sean
 *     una comparación. `weekday` es ISO: 1 lunes … 7 domingo.
 */
export function callVars(startedAt, timezone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    })
      .formatToParts(startedAt)
      .map((part) => [part.type, part.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return {
    date,
    hhmm: Number(parts.hour) * 100 + Number(parts.minute),
    weekday: ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1,
  };
}

/**
 * Traduce una causa de cuelgue Q.931 al resultado que ven las aristas.
 *
 * ponytail: solo las causas que se distinguen en la práctica. La tabla completa
 * tiene medio centenar; añadir la que haga falta el día que haga falta.
 *
 * @param {number} cause Causa Q.931 del evento ChannelDestroyed.
 * @return {string} `busy`, `noanswer` o `failed`.
 */
function hangupCause(cause) {
  const known = { 17: 'busy', 21: 'busy', 18: 'noanswer', 19: 'noanswer' };
  return known[cause] ?? 'failed';
}

/**
 * Espera a que un canal saliente conteste, o a que se caiga sin contestar.
 *
 * @param {Object} client Cliente ARI.
 * @param {string} channelId Canal saliente a vigilar.
 * @param {AbortSignal} signal
 * @return {Promise<string>} `answered`, `busy`, `noanswer` o `failed`.
 */
function waitUntilAnswered(client, channelId, signal) {
  return cancelable(signal, (done) => {
    const onAnswer = (event, ch) => {
      if (ch.id === channelId) done('answered');
    };
    const onGone = (event, ch) => {
      if (ch.id === channelId) done(hangupCause(event.cause));
    };
    client.on('StasisStart', onAnswer);
    client.on('ChannelDestroyed', onGone);
    return () => {
      client.removeListener('StasisStart', onAnswer);
      client.removeListener('ChannelDestroyed', onGone);
    };
  });
}

/**
 * Espera a que un canal desaparezca.
 *
 * @param {Object} client Cliente ARI.
 * @param {string} channelId
 * @param {AbortSignal} signal
 * @return {Promise<void>}
 */
function waitUntilGone(client, channelId, signal) {
  return cancelable(signal, (done) => {
    const onGone = (event, ch) => {
      if (ch.id === channelId) done();
    };
    client.on('ChannelDestroyed', onGone);
    return () => client.removeListener('ChannelDestroyed', onGone);
  });
}

export const NODES = {
  async say(channel, config, ctx) {
    await playToEnd(channel, config.media, ctx.signal);
  },

  // ponytail: sin barge-in. Para permitirlo, correr playToEnd y readDigit en
  // Promise.race y parar el playback al primer dígito.
  async gather(channel, config, ctx) {
    if (config.media) await playToEnd(channel, config.media, ctx.signal);
    return { digit: await readDigit(channel, config.timeout ?? 5000, ctx.signal) };
  },

  /**
   * Llama a un endpoint y puentea las dos patas hasta que la otra cuelgue.
   *
   * No es terminal: al deshacerse el bridge el bucle continúa con el resultado
   * en `vars.dial`. Ese handback es la razón de ser del proyecto — tratar este
   * nodo como final es reimplementar `Dial()` del dialplan.
   *
   * ponytail: un solo destino. Para llamar a varios a la vez, originar N patas
   * y quedarse con la primera que conteste.
   */
  async dial(channel, config, ctx) {
    const outbound = await ctx.client.channels.originate({
      endpoint: config.endpoint,
      app: APP,
      appArgs: DIALED,
      timeout: config.timeout ?? 30,
    });

    let bridge = null;
    try {
      const outcome = await waitUntilAnswered(ctx.client, outbound.id, ctx.signal);
      if (outcome !== 'answered') return { dial: outcome };

      bridge = await ctx.client.bridges.create({ type: 'mixing' });
      await bridge.addChannel({ channel: [channel.id, outbound.id] });
      await waitUntilGone(ctx.client, outbound.id, ctx.signal);

      return { dial: 'answered' };
    } finally {
      await bridge?.destroy().catch(() => {});
      await outbound.hangup().catch(() => {});
    }
  },

  hangup: (channel) => channel.hangup(),
};

/**
 * Elige la arista de salida de un nodo evaluando las condiciones jsonlogic.
 *
 * @param {Flow} flow
 * @param {string} from Id del nodo de origen.
 * @param {Object<string, *>} vars Variables contra las que se evalúa `when`.
 * @return {?Object} El nodo destino, o `null` si ninguna arista casa.
 */
// ponytail: gana la primera arista que casa, el orden del array es la prioridad.
// Si hace falta prioridad explícita, añadir campo `priority` y ordenar aquí.
export function nextNode(flow, from, vars) {
  const edge = flow.edges.find(
    (e) => e.from === from && (!e.when || jsonLogic.apply(e.when, vars)),
  );
  return edge ? flow.nodes.find((n) => n.id === edge.to) : null;
}

/**
 * Recorre el grafo ejecutando un nodo tras otro hasta que se acaba el camino.
 *
 * Un nodo sin arista de salida que no sea `hangup` es un bug del grafo, no una
 * ruta válida: se anota como `!dead-end` en la traza para que se vea al pintarla.
 *
 * @param {Object} channel Canal de ari-client. Los tests pasan `null`.
 * @param {Flow} flow
 * @param {Ctx} ctx Se muta: acumula `vars` y `trace`.
 * @param {Object} [nodes] Implementaciones a usar. Se inyectan en los tests.
 * @return {Promise<void>}
 * @throws {Hungup} Si el canal cuelga durante cualquier nodo.
 */
export async function run(channel, flow, ctx, nodes = NODES) {
  let node = flow.nodes.find((n) => n.id === flow.start);

  while (node) {
    ctx.trace.push({ node: node.id, at: new Date().toISOString() });
    Object.assign(ctx.vars, await nodes[node.type](channel, node.config ?? {}, ctx));

    const next = nextNode(flow, node.id, ctx.vars);
    if (!next && node.type !== 'hangup') {
      ctx.trace.push({ node: '!dead-end', at: new Date().toISOString() });
    }
    node = next;
  }
}

if (import.meta.main) {
  const flowFile = new URL('./flow.json', import.meta.url);

  // Mutable: la UI lo reemplaza en caliente. Cada llamada se queda con el que
  // había al entrar, así que editar a mitad de una llamada no la afecta.
  let flow = JSON.parse(await readFile(flowFile, 'utf8'));
  const client = await ari.connect('http://localhost:8088', 'janus', 'janus');

  /** @type {Map<string, AbortController>} Llamadas vivas, por id de canal. */
  const active = new Map();

  client.on('StasisStart', async (event, channel) => {
    if (event.args?.[0] === DIALED) return;

    const controller = new AbortController();
    active.set(channel.id, controller);
    const startedAt = new Date();
    const ctx = {
      signal: controller.signal,
      client,
      startedAt,
      vars: {
        caller: channel.caller?.number ?? null,
        did: event.args?.[0] ?? null,
        ...callVars(startedAt, flow.timezone ?? 'UTC'),
      },
      trace: [],
    };

    const flowAtStart = flow;
    console.log(`→ entra ${channel.caller.number || '?'}`);
    try {
      await channel.answer();
      await run(channel, flowAtStart, ctx);
    } catch (err) {
      if (err instanceof Hungup) console.log('  colgaron a mitad');
      else console.error('  error:', err.message);
    } finally {
      active.delete(channel.id);
      console.log(`← ${ctx.trace.map((s) => s.node).join(' → ')}`);
      console.log(`  vars=${JSON.stringify(ctx.vars)}`);
    }
  });

  const abort = (event, channel) => active.get(channel.id)?.abort();
  client.on('StasisEnd', abort);
  client.on('ChannelHangupRequest', abort);

  await client.start(APP);
  console.log(`janus escuchando como app "${APP}"`);

  createServer(async (req, res) => {
    if (req.url !== '/api/flow') {
      res.writeHead(404).end();
      return;
    }
    if (req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(flow));
      return;
    }
    if (req.method === 'PUT') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      try {
        const nuevo = JSON.parse(Buffer.concat(chunks).toString());
        await writeFile(flowFile, `${JSON.stringify(nuevo, null, 2)}\n`);
        flow = nuevo;
        console.log(`⟳ flujo actualizado: ${flow.nodes.length} nodos, ${flow.edges.length} aristas`);
        res.writeHead(204).end();
      } catch (err) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
    res.writeHead(405).end();
  }).listen(3000, () => console.log('API del flujo en http://localhost:3000/api/flow'));
}
