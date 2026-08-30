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
  constructor(id = 'caller') {
    super();
    this.id = id;
    /** @type {string[]} Medias reproducidos, en orden. */
    this.played = [];
    /** @type {FakePlayback[]} */
    this.playbacks = [];
    this.hungUp = false;
  }

  async play({ media }) {
    this.played.push(media);
    const playback = new FakePlayback();
    this.playbacks.push(playback);
    return playback;
  }

  async hangup() {
    this.hungUp = true;
  }

  /** @return {?FakePlayback} El playback en curso. */
  get playing() {
    return this.playbacks.at(-1) ?? null;
  }

  /** Simula que alguien pulsa una tecla. */
  pressDigit(digit) {
    this.emit('ChannelDtmfReceived', { digit });
  }

  /** @return {number} Listeners de DTMF vivos. Debe volver a 0 al terminar. */
  get dtmfListeners() {
    return this.listenerCount('ChannelDtmfReceived');
  }
}

/** Cede el control para que corran los microtasks pendientes. */
export const tick = () => new Promise(setImmediate);

/** Bridge de mentira. */
export class FakeBridge {
  constructor(id) {
    this.id = id;
    /** @type {string[]} Ids de los canales metidos. */
    this.channels = [];
    this.destroyed = false;
  }

  async addChannel({ channel }) {
    this.channels.push(...[].concat(channel));
  }

  async destroy() {
    this.destroyed = true;
  }
}

/** Cliente ARI de mentira: origina canales y crea bridges bajo control del test. */
export class FakeClient extends EventEmitter {
  constructor() {
    super();
    /** @type {Object[]} Opciones con las que se llamó a originate. */
    this.originated = [];
    /** @type {FakeChannel[]} */
    this.outbound = [];
    /** @type {FakeBridge[]} */
    this.createdBridges = [];

    this.channels = {
      originate: async (options) => {
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

  get lastOutbound() {
    return this.outbound.at(-1) ?? null;
  }

  get lastBridge() {
    return this.createdBridges.at(-1) ?? null;
  }

  /** El saliente contesta y entra en Stasis. */
  answers(channel = this.lastOutbound) {
    this.emit('StasisStart', { args: ['dialed'] }, { id: channel.id });
  }

  /** El saliente desaparece con una causa Q.931 (16 normal, 17 ocupado, 19 no contesta). */
  destroys(channel = this.lastOutbound, cause = 16) {
    this.emit('ChannelDestroyed', { cause }, { id: channel.id });
  }

  /** @return {number} Listeners vivos en total. Debe volver a 0. */
  get liveListeners() {
    return this.eventNames().reduce((total, name) => total + this.listenerCount(name), 0);
  }
}
