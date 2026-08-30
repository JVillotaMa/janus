/**
 * @fileoverview Lee las últimas llamadas de la base.
 *
 *   pnpm calls        las 10 últimas
 *   pnpm calls 50     las 50 últimas
 */

import { openStore } from './store.ts';

const store = openStore(new URL('../janus.db', import.meta.url).pathname);
const calls = store.recent(Number(process.argv[2]) || 10);

if (calls.length === 0) console.log('todavía no hay llamadas registradas');

for (const call of calls) {
  const seconds = Math.round((+call.endedAt - +call.startedAt) / 1000);
  console.log(
    `\n${call.startedAt.toISOString()}  ${call.caller ?? '?'} → ${call.did ?? '?'}` +
      `  ${seconds}s  [${call.outcome}]`,
  );
  console.log(`  ${call.trace.map((step) => step.node).join(' → ') || '(sin pasos)'}`);
  console.log(`  ${JSON.stringify(call.vars)}`);
}

store.close();
