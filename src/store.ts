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
import type { Flow, Step, Vars } from './types.ts';

/** Cómo terminó una llamada. */
export type Outcome = 'completed' | 'hungup' | 'error';

export interface CallRecord {
  /** Id del canal de Asterisk. */
  id: string;
  caller: string | null;
  did: string | null;
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

export interface Store {
  /** Publica una versión nueva. Nunca actualiza: las versiones son inmutables. */
  publish(graph: Flow): FlowVersion;
  /** La última versión publicada, o `null` si la base está vacía. */
  latestFlow(): FlowVersion | null;
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
  CREATE TABLE IF NOT EXISTS calls (
    id         TEXT PRIMARY KEY,
    caller     TEXT,
    did        TEXT,
    started_at TEXT NOT NULL,
    ended_at   TEXT NOT NULL,
    outcome    TEXT NOT NULL,
    vars       TEXT NOT NULL
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

interface CallRow {
  id: string;
  caller: string | null;
  did: string | null;
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

  const insertCall = db.prepare(
    `INSERT OR REPLACE INTO calls (id, caller, did, started_at, ended_at, outcome, vars)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const clearSteps = db.prepare('DELETE FROM call_steps WHERE call_id = ?');
  const insertStep = db.prepare(
    'INSERT INTO call_steps (call_id, seq, node, at) VALUES (?, ?, ?, ?)',
  );
  const insertFlow = db.prepare('INSERT INTO flows (graph, published_at) VALUES (?, ?)');
  const selectFlow = db.prepare('SELECT * FROM flows ORDER BY version DESC LIMIT 1');
  const selectCalls = db.prepare('SELECT * FROM calls ORDER BY started_at DESC, rowid DESC LIMIT ?');
  const selectSteps = db.prepare('SELECT node, at FROM call_steps WHERE call_id = ? ORDER BY seq');

  // La llamada y sus pasos entran juntos o no entra ninguno.
  const saveAll = db.transaction((call: CallRecord) => {
    insertCall.run(
      call.id,
      call.caller,
      call.did,
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

    latestFlow() {
      const row = selectFlow.get() as FlowRow | undefined;
      return row
        ? {
            version: row.version,
            graph: JSON.parse(row.graph) as Flow,
            publishedAt: new Date(row.published_at),
          }
        : null;
    },

    save: (call) => void saveAll(call),

    recent(limit = 20) {
      return (selectCalls.all(limit) as CallRow[]).map((row) => ({
        id: row.id,
        caller: row.caller,
        did: row.did,
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
