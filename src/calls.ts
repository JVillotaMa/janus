/**
 * @fileoverview Lee las últimas llamadas de la base.
 *
 *   pnpm calls        las 10 últimas
 *   pnpm calls 50     las 50 últimas
 */

import { openStore } from './store.ts';
import { NODE_TYPES } from './schema.ts';
import type { Flow } from './types.ts';

const store = openStore(new URL('../janus.db', import.meta.url).pathname);
const calls = store.recent(Number(process.argv[2]) || 10);

if (calls.length === 0) console.log('todavía no hay llamadas registradas');

/**
 * Rótulo de un nodo dentro del grafo que recorrió la llamada.
 *
 * Los ids se generan solos y no dicen nada, así que se traducen contra la
 * versión con la que entró esa llamada — nunca contra el flujo de ahora, que
 * les pondría nombres que entonces no existían. Sin versión guardada no hay
 * grafo contra el que resolver y se enseña el id, que es la verdad.
 */
const label = (flow: Flow | null, id: string): string => {
  if (id.startsWith('!')) return id;
  const node = flow?.nodes.find((n) => n.id === id);
  if (!node) return id;
  if (node.name) return node.name;
  const spec = NODE_TYPES[node.type];
  if (!spec) return node.type;
  const first = spec.fields.find((field) => node.config?.[field.name]);
  return first ? `${spec.label} · ${node.config![first.name]}` : spec.label;
};

// ponytail: una lectura de `flows` por llamada. Con diez llamadas por consola no
// se nota; si algún día se nota, se cachean por número de versión.
for (const call of calls) {
  const seconds = Math.round((+call.endedAt - +call.startedAt) / 1000);
  const flow = call.flowVersion === null ? null : (store.flowAt(call.flowVersion)?.graph ?? null);
  const version = call.flowVersion === null ? 'sin versión' : `v${call.flowVersion}`;

  console.log(
    `\n${call.startedAt.toISOString()}  ${call.caller ?? '?'} → ${call.did ?? '?'}` +
      `  ${seconds}s  [${call.outcome}]  ${version}`,
  );
  console.log(`  ${call.trace.map((step) => label(flow, step.node)).join(' → ') || '(sin pasos)'}`);
  console.log(`  ${JSON.stringify(call.vars)}`);
}

store.close();
