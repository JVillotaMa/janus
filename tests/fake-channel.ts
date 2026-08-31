/**
 * @fileoverview Canal de mentira con la superficie de ari-client que usa el
 * motor. Deja disparar los eventos a mano, así los tests de nodos no dependen
 * de Asterisk ni del reloj.
 */

import { EventEmitter } from 'node:events';

/** Playback de mentira: se termina cuando el test lo dice. */
export class FakePlayback extends EventEmitter {
  finish() {
    this.emit('PlaybackFinished');
  }
}

/** Canal de mentira. */
export class FakeChannel extends EventEmitter {
  id: string;
  played: string[] = [];
  playbacks: FakePlayback[] = [];
  hungUp = false;
  answered = false;

  constructor(id = 'caller') {
    super();
    this.id = id;
  }

  async answer() {
    this.answered = true;
  }

  async play({ media }: { media: string }) {
    this.played.push(media);
    const playback = new FakePlayback();
    this.playbacks.push(playback);
    return playback;
  }

  async hangup() {
    this.hungUp = true;
  }

  /** El playback en curso. Lanza si no hay: pedirlo sin haber reproducido nada
   *  es un fallo del test. */
  get playing(): FakePlayback {
    const last = this.playbacks.at(-1);
    if (!last) throw new Error('no se ha reproducido nada');
    return last;
  }

  /** Simula que alguien pulsa una tecla. */
  pressDigit(digit: string) {
    this.emit('ChannelDtmfReceived', { digit });
  }

  /** Listeners de DTMF vivos. Debe volver a 0 al terminar. */
  get dtmfListeners(): number {
    return this.listenerCount('ChannelDtmfReceived');
  }
}

/** Cede el control para que corran los microtasks pendientes. */
export const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));


/** Bridge de mentira. */
export class FakeBridge {
  id: string;
  channels: string[] = [];
  destroyed = false;

  constructor(id: string) {
    this.id = id;
  }

  async addChannel({ channel }: { channel: string[] }) {
    this.channels.push(...channel);
  }

  async destroy() {
    this.destroyed = true;
  }
}

/** Cliente ARI de mentira: origina canales y crea bridges bajo control del test. */
export class FakeClient extends EventEmitter {
  originated: Record<string, unknown>[] = [];
  outbound: FakeChannel[] = [];
  createdBridges: FakeBridge[] = [];
  channels: { originate(o: Record<string, unknown>): Promise<FakeChannel> };
  bridges: { create(o?: Record<string, unknown>): Promise<FakeBridge> };

  constructor() {
    super();
    this.channels = {
      originate: async (options: Record<string, unknown>) => {
        this.originated.push(options);
        const channel = new FakeChannel(`out-${this.outbound.length + 1}`);
        this.outbound.push(channel);
        return channel;
      },
    };

    this.bridges = {
      create: async () => {
        const bridge = new FakeBridge(`bridge-${this.createdBridges.length + 1}`);
        this.createdBridges.push(bridge);
        return bridge;
      },
    };
  }

  /** Lanza si no hay: pedirlo sin haber originado nada es un fallo del test. */
  get lastOutbound(): FakeChannel {
    const last = this.outbound.at(-1);
    if (!last) throw new Error('no se ha originado ningún canal saliente');
    return last;
  }

  /** Lanza si no hay: para comprobar que NO se creó, mira `createdBridges`. */
  get lastBridge(): FakeBridge {
    const last = this.createdBridges.at(-1);
    if (!last) throw new Error('no se ha creado ningún bridge');
    return last;
  }

  /** El saliente contesta y entra en Stasis. */
  answers(channel: FakeChannel = this.lastOutbound) {
    this.emit('StasisStart', { args: ['dialed'] }, { id: channel.id });
  }

  /** El saliente desaparece con una causa Q.931 (16 normal, 17 ocupado, 19 no contesta). */
  destroys(channel: FakeChannel = this.lastOutbound, cause = 16) {
    this.emit('ChannelDestroyed', { cause }, { id: channel.id });
  }

  /** Listeners vivos en total. Debe volver a 0. */
  get liveListeners(): number {
    return this.eventNames().reduce((total, name) => total + this.listenerCount(name), 0);
  }
}
