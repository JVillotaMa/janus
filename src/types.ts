/**
 * @fileoverview Tipos compartidos. Solo declaraciones: se importa siempre con
 * `import type`, que Node borra al ejecutar.
 *
 * Los tipos de ARI son estructurales y describen únicamente lo que el motor
 * usa. Así los dobles de los tests encajan sin heredar de nada.
 */

export type Vars = Record<string, unknown>;

/**
 * Una troncal SIP. `password` solo viaja hacia dentro: la API nunca la devuelve.
 *
 * `register` = nos registramos contra el proveedor con usuario y contraseña.
 * `identify` = el proveedor nos autentica por IP de origen y no hay credenciales.
 */
export interface Trunk {
  name: string;
  host: string;
  mode: 'register' | 'identify';
  /**
   * Por qué protocolo habla. Eje independiente del modo: se puede registrar por
   * TCP o autenticar por IP sobre UDP.
   *
   * Sin declarar, se comporta como antes de que se pudiera elegir: sale por el
   * transporte por defecto de Asterisk, que es UDP.
   */
  transport?: 'udp' | 'tcp' | null;
  username?: string | null;
  password?: string | null;
  matchIp?: string | null;
}

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
  /**
   * Identificador opaco: lo referencian las aristas y `call_steps`, así que no
   * se puede cambiar. El editor lo genera y no lo enseña.
   */
  id: string;
  type: string;
  /** Rótulo que se lee en el lienzo y en la traza. El motor lo ignora. */
  name?: string;
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

/**
 * La parte de ARI que se usa para administrar Asterisk, no para controlar
 * llamadas. Va aparte para que los dobles de canal de los tests no tengan que
 * cargar con métodos que ningún nodo llama.
 */
export interface AriAdmin {
  asterisk: { reloadModule(options: { moduleName: string }): Promise<unknown> };
  endpoints: { get(options: { tech: string; resource: string }): Promise<{ state?: string }> };
}

export interface AriClient {
  channels: { originate(options: Record<string, unknown>): Promise<Channel> };
  bridges: { create(options: Record<string, unknown>): Promise<Bridge> };
  on(event: string, listener: (...args: any[]) => void): void;
  removeListener(event: string, listener: (...args: any[]) => void): void;
}
