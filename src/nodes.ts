/**
 * @fileoverview Implementaciones de nodo.
 *
 * Todas comparten la firma `NodeFn`. Lo que devuelven se mezcla en `ctx.vars` y
 * queda disponible para las condiciones de las aristas. Añadir un tipo de nodo
 * es añadir una función a `NODES`.
 */

import { cancelable } from './cancel.ts';
import type { Unsubscribe } from './cancel.ts';
import type { AriClient, Channel, Ctx, Nodes } from './types.ts';

/** Nombre con el que el motor se registra en Asterisk. */
export const APP = 'janus';

/** Marca de los canales que origina `dial`, para no confundirlos con llamadas. */
export const DIALED = 'dialed';

/** Reproduce un audio y espera a que suene entero. */
async function playToEnd(channel: Channel, media: string, signal: AbortSignal): Promise<void> {
  const playback = await channel.play({ media });
  return cancelable<void>(signal, (done) => {
    playback.once('PlaybackFinished', () => done());
    return () => playback.removeAllListeners('PlaybackFinished');
  });
}

/** Espera a que se pulse una tecla. Devuelve `null` si vence el timeout. */
function readDigit(
  channel: Channel,
  timeout: number,
  signal: AbortSignal,
): Promise<string | null> {
  return cancelable<string | null>(signal, (done) => {
    const onDigit = (event: { digit: string }) => done(event.digit);
    const timer = setTimeout(() => done(null), timeout);
    channel.on('ChannelDtmfReceived', onDigit);
    return () => {
      channel.removeListener('ChannelDtmfReceived', onDigit);
      clearTimeout(timer);
    };
  });
}

/**
 * Traduce una causa de cuelgue Q.931 al resultado que ven las aristas.
 *
 * ponytail: solo las causas que se distinguen en la práctica. La tabla completa
 * tiene medio centenar; añadir la que haga falta el día que haga falta.
 */
function hangupCause(cause: number): string {
  const known: Record<number, string> = { 17: 'busy', 21: 'busy', 18: 'noanswer', 19: 'noanswer' };
  return known[cause] ?? 'failed';
}

/** Espera a que un canal saliente conteste, o a que se caiga sin contestar. */
function waitUntilAnswered(
  client: AriClient,
  channelId: string,
  signal: AbortSignal,
): Promise<string> {
  return cancelable<string>(signal, (done) => {
    const onAnswer = (_event: unknown, channel: Channel) => {
      if (channel.id === channelId) done('answered');
    };
    const onGone = (event: { cause: number }, channel: Channel) => {
      if (channel.id === channelId) done(hangupCause(event.cause));
    };
    client.on('StasisStart', onAnswer);
    client.on('ChannelDestroyed', onGone);
    return () => {
      client.removeListener('StasisStart', onAnswer);
      client.removeListener('ChannelDestroyed', onGone);
    };
  });
}

/** Espera a que un canal desaparezca. */
function waitUntilGone(
  client: AriClient,
  channelId: string,
  signal: AbortSignal,
): Promise<void> {
  return cancelable<void>(signal, (done) => {
    const onGone = (_event: unknown, channel: Channel) => {
      if (channel.id === channelId) done();
    };
    client.on('ChannelDestroyed', onGone);
    return (() => client.removeListener('ChannelDestroyed', onGone)) as Unsubscribe;
  });
}

export const NODES: Nodes = {
  /**
   * El punto de entrada del grafo. No hace nada, y por eso sirve: la llamada la
   * contesta el dialplan antes de llegar al motor, así que desde aquí se puede
   * ramificar nada más entrar sin reproducir audio ni esperar. Su config solo
   * nombra la troncal por la que entra la llamada; el secreto vive en la base.
   */
  async entry() {},

  async say(channel, config, ctx: Ctx) {
    await playToEnd(channel, config.media, ctx.signal);
  },

  // ponytail: sin barge-in. Para permitirlo, correr playToEnd y readDigit en
  // Promise.race y parar el playback al primer dígito.
  async gather(channel, config, ctx: Ctx) {
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
  async dial(channel, config, ctx: Ctx) {
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

  async hangup(channel) {
    await channel.hangup();
  },
};
