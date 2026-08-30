/**
 * @fileoverview Tipos compartidos. Solo declaraciones: se importa siempre con
 * `import type`, que Node borra al ejecutar.
 *
 * Los tipos de ARI son estructurales y describen únicamente lo que el motor
 * usa. Así los dobles de los tests encajan sin heredar de nada.
 */

export type Vars = Record<string, unknown>;

/** Un paso del recorrido. Es el origen de `call_steps`. */
export interface Step {
  node: string;
  /** Hora de entrada al nodo, ISO en UTC. */
  at: string;
}

/** Estado de una llamada mientras recorre el grafo. */
export interface Ctx {
  /** Se dispara cuando el canal cuelga. */
  signal: AbortSignal;
  /** Cliente ARI, para los nodos que crean canales. */
  client: AriClient;
  /** Instante en que entró la llamada, en UTC. */
  startedAt: Date;
  vars: Vars;
  trace: Step[];
}

export interface NodeSpec {
  id: string;
  type: string;
  config?: Record<string, any>;
  /** Posición en el editor. El motor la ignora. */
  position?: { x: number; y: number };
}

export interface Edge {
  from: string;
  to: string;
  /** Expresión jsonlogic evaluada contra `Ctx.vars`. Sin ella, la arista siempre casa. */
  when?: unknown;
}

export interface Flow {
  start: string;
  /**
   * Zona IANA del negocio, p.ej. `Europe/Madrid`. Nunca un offset (`+02:00`):
   * el offset cambia con el horario de verano. Por defecto `UTC`.
   */
  timezone?: string;
  nodes: NodeSpec[];
  edges: Edge[];
}

/** Firma de toda implementación de nodo. */
export type NodeFn = (channel: Channel, config: any, ctx: Ctx) => Promise<Vars | void>;

export type Nodes = Record<string, NodeFn>;

// ─── Superficie de ari-client que usa el motor ───────────────────────────────

export interface Playback {
  once(event: string, listener: () => void): void;
  removeAllListeners(event: string): void;
}

export interface Channel {
  id: string;
  caller?: { number?: string };
  answer(): Promise<void>;
  play(options: { media: string }): Promise<Playback>;
  hangup(): Promise<void>;
  on(event: string, listener: (...args: any[]) => void): void;
  removeListener(event: string, listener: (...args: any[]) => void): void;
}

export interface Bridge {
  destroy(): Promise<void>;
  addChannel(options: { channel: string[] }): Promise<void>;
}

export interface AriClient {
  channels: { originate(options: Record<string, unknown>): Promise<Channel> };
  bridges: { create(options: Record<string, unknown>): Promise<Bridge> };
  on(event: string, listener: (...args: any[]) => void): void;
  removeListener(event: string, listener: (...args: any[]) => void): void;
}
