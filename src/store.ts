/**
 * @fileoverview Persistencia de la traza de llamadas.
 *
 * La traza no es un extra de depuración: es la respuesta a "¿por qué esta
 * llamada acabó en el buzón?", y sin ella el usuario no puede diagnosticar su
 * propio flujo.
 *
 * SQLite y no Postgres porque no hay servidor que levantar ni contenedor que
 * mantener: la base es un fichero. `better-sqlite3` trae binarios precompilados,
 * así que tampoco hay compilador de por medio.
 *
 * ponytail: migrar a Postgres el día que haya más de una máquina es reescribir
 * solo este fichero — el resto del motor no sabe dónde se guarda.
 */

import Database from 'better-sqlite3';
import type { Flow, Step, Trunk, Vars } from './types.ts';
export type { Trunk };

/** Cómo terminó una llamada. */
export type Outcome = 'completed' | 'hungup' | 'error';

export interface CallRecord {
  /** Id del canal de Asterisk. */
  id: string;
  caller: string | null;
  did: string | null;
  /**
   * Versión de flujo con la que entró la llamada, o `null` si no se sabe.
   *
   * `null` son las llamadas anteriores a que esto se guardase. No se les
   * inventa una: la traza es una lista de ids de nodo, y pintarla sobre el
   * grafo equivocado es justo el fallo silencioso que esta columna quita.
   */
  flowVersion: number | null;
  startedAt: Date;
  endedAt: Date;
  outcome: Outcome;
  /**
   * Estado final de las variables.
   *
   * ponytail: no se guarda una foto por paso; con el estado final se diagnostica
   * casi todo. Si hace falta el detalle, añadir columna `vars` a `call_steps`.
   */
  vars: Vars;
  trace: Step[];
}

/** Una versión publicada del grafo. */
export interface FlowVersion {
  version: number;
  graph: Flow;
  publishedAt: Date;
}

/**
 * Una versión en la lista, sin el grafo.
 *
 * Lleva los contadores porque una columna de números y fechas no deja
 * reconocer la versión que buscas; y no lleva el grafo porque con doscientas
 * versiones publicadas serían cientos de kilobytes para pintar una lista.
 */
export interface FlowSummary {
  version: number;
  publishedAt: Date;
  nodes: number;
  edges: number;
}

export interface Store {
  /** Publica una versión nueva. Nunca actualiza: las versiones son inmutables. */
  publish(graph: Flow): FlowVersion;
  /** La última versión publicada, o `null` si la base está vacía. */
  latestFlow(): FlowVersion | null;
  /** Las versiones publicadas, de la más reciente a la más antigua. */
  flowVersions(): FlowSummary[];
  /** Una versión concreta, o `null` si nunca se publicó. */
  flowAt(version: number): FlowVersion | null;
  /** Las troncales guardadas, con contraseña: es lo que necesita el generador. */
  trunks(): Trunk[];
  /**
   * Reemplaza la colección entera. Una troncal que llega sin `password`
   * conserva la que tuviera guardada, para que la UI pueda reenviar la lista
   * que acaba de leer sin manejar secretos.
   */
  saveTrunks(list: Trunk[]): void;
  save(call: CallRecord): void;
  recent(limit?: number): CallRecord[];
  close(): void;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS flows (
    version      INTEGER PRIMARY KEY AUTOINCREMENT,
    graph        TEXT NOT NULL,
    published_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS trunks (
    name     TEXT PRIMARY KEY,
    host     TEXT NOT NULL,
    mode     TEXT NOT NULL,
    username TEXT,
    password TEXT,
    match_ip TEXT
  );
  CREATE TABLE IF NOT EXISTS calls (
    id           TEXT PRIMARY KEY,
    caller       TEXT,
    did          TEXT,
    flow_version INTEGER,
    started_at   TEXT NOT NULL,
    ended_at     TEXT NOT NULL,
    outcome      TEXT NOT NULL,
    vars         TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS call_steps (
    call_id TEXT NOT NULL,
    seq     INTEGER NOT NULL,
    node    TEXT NOT NULL,
    at      TEXT NOT NULL,
    PRIMARY KEY (call_id, seq)
  );
  CREATE INDEX IF NOT EXISTS calls_by_start ON calls(started_at DESC);
`;

interface FlowRow {
  version: number;
  graph: string;
  published_at: string;
}

interface TrunkRow {
  name: string;
  host: string;
  mode: string;
  username: string | null;
  password: string | null;
  match_ip: string | null;
}

interface CallRow {
  id: string;
  caller: string | null;
  did: string | null;
  flow_version: number | null;
  started_at: string;
  ended_at: string;
  outcome: string;
  vars: string;
}

/** Abre (y crea si hace falta) la base de llamadas. `:memory:` en los tests. */
export function openStore(file: string): Store {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);

  // Las bases creadas antes de que la llamada guardase su versión no tienen la
  // columna, y `CREATE TABLE IF NOT EXISTS` no la añade. Se pregunta antes en
  // vez de envolver el ALTER en un try/catch: ese catch se tragaría también una
  // base corrupta o sin permisos y dejaría el motor escribiendo contra una
  // tabla que no es la que cree.
  const columns = (db.prepare('PRAGMA table_info(calls)').all() as { name: string }[]);
  if (!columns.some((column) => column.name === 'flow_version')) {
    db.exec('ALTER TABLE calls ADD COLUMN flow_version INTEGER');
  }

  const insertCall = db.prepare(
    `INSERT OR REPLACE INTO calls
       (id, caller, did, flow_version, started_at, ended_at, outcome, vars)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const clearSteps = db.prepare('DELETE FROM call_steps WHERE call_id = ?');
  const insertStep = db.prepare(
    'INSERT INTO call_steps (call_id, seq, node, at) VALUES (?, ?, ?, ?)',
  );
  const insertFlow = db.prepare('INSERT INTO flows (graph, published_at) VALUES (?, ?)');
  const selectFlow = db.prepare('SELECT * FROM flows ORDER BY version DESC LIMIT 1');
  const selectFlows = db.prepare('SELECT * FROM flows ORDER BY version DESC');
  const selectFlowAt = db.prepare('SELECT * FROM flows WHERE version = ?');
  const selectTrunks = db.prepare('SELECT * FROM trunks ORDER BY name');
  const clearTrunks = db.prepare('DELETE FROM trunks');
  const insertTrunk = db.prepare(
    `INSERT INTO trunks (name, host, mode, username, password, match_ip)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const selectCalls = db.prepare('SELECT * FROM calls ORDER BY started_at DESC, rowid DESC LIMIT ?');
  const selectSteps = db.prepare('SELECT node, at FROM call_steps WHERE call_id = ? ORDER BY seq');

  const toVersion = (row: FlowRow | undefined): FlowVersion | null =>
    row
      ? {
          version: row.version,
          graph: JSON.parse(row.graph) as Flow,
          publishedAt: new Date(row.published_at),
        }
      : null;

  const readTrunks = (): Trunk[] =>
    (selectTrunks.all() as TrunkRow[]).map((row) => ({
      name: row.name,
      host: row.host,
      mode: row.mode as Trunk['mode'],
      username: row.username,
      password: row.password,
      matchIp: row.match_ip,
    }));

  // La colección se reemplaza entera, igual que se lee entera.
  const replaceTrunks = db.transaction((list: Trunk[]) => {
    clearTrunks.run();
    for (const trunk of list) {
      insertTrunk.run(
        trunk.name,
        trunk.host,
        trunk.mode,
        trunk.username ?? null,
        trunk.password ?? null,
        trunk.matchIp ?? null,
      );
    }
  });

  // La llamada y sus pasos entran juntos o no entra ninguno.
  const saveAll = db.transaction((call: CallRecord) => {
    insertCall.run(
      call.id,
      call.caller,
      call.did,
      call.flowVersion,
      call.startedAt.toISOString(),
      call.endedAt.toISOString(),
      call.outcome,
      JSON.stringify(call.vars),
    );
    clearSteps.run(call.id);
    call.trace.forEach((step, seq) => insertStep.run(call.id, seq, step.node, step.at));
  });

  return {
    publish(graph) {
      const publishedAt = new Date();
      const { lastInsertRowid } = insertFlow.run(
        JSON.stringify(graph),
        publishedAt.toISOString(),
      );
      return { version: Number(lastInsertRowid), graph, publishedAt };
    },

    latestFlow: () => toVersion(selectFlow.get() as FlowRow | undefined),

    // Contar nodos y aristas obliga a parsear el grafo de cada fila. Es barato
    // con las versiones que va a haber; si algún día son miles, se paginan o
    // los contadores pasan a ser columnas que se escriben al publicar.
    flowVersions() {
      return (selectFlows.all() as FlowRow[]).map((row) => {
        const graph = JSON.parse(row.graph) as Flow;
        return {
          version: row.version,
          publishedAt: new Date(row.published_at),
          nodes: graph.nodes.length,
          edges: graph.edges.length,
        };
      });
    },

    flowAt: (version) => toVersion(selectFlowAt.get(version) as FlowRow | undefined),

    trunks: readTrunks,

    saveTrunks(list) {
      const kept = new Map(readTrunks().map((trunk) => [trunk.name, trunk.password ?? null]));
      replaceTrunks(
        list.map((trunk) => ({
          ...trunk,
          password: trunk.password ?? kept.get(trunk.name) ?? null,
        })),
      );
    },

    save: (call) => void saveAll(call),

    recent(limit = 20) {
      return (selectCalls.all(limit) as CallRow[]).map((row) => ({
        id: row.id,
        caller: row.caller,
        did: row.did,
        flowVersion: row.flow_version,
        startedAt: new Date(row.started_at),
        endedAt: new Date(row.ended_at),
        outcome: row.outcome as Outcome,
        vars: JSON.parse(row.vars) as Vars,
        trace: selectSteps.all(row.id) as Step[],
      }));
    },

    close: () => db.close(),
  };
}
