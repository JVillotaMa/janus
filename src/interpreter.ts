/** @fileoverview El bucle: recorre el grafo ejecutando un nodo tras otro. */

import jsonLogic from 'json-logic-js';
import { NODES } from './nodes.ts';
import type { Channel, Ctx, Flow, NodeSpec, Nodes, Vars } from './types.ts';

/**
 * Elige la arista de salida de un nodo evaluando las condiciones jsonlogic.
 *
 * ponytail: gana la primera arista que casa, el orden del array es la prioridad.
 * Si hace falta prioridad explícita, añadir campo `priority` y ordenar aquí.
 */
export function nextNode(flow: Flow, from: string, vars: Vars): NodeSpec | null {
  const edge = flow.edges.find(
    (e) => e.from === from && (!e.when || jsonLogic.apply(e.when as any, vars)),
  );
  return edge ? (flow.nodes.find((n) => n.id === edge.to) ?? null) : null;
}

/**
 * Recorre el grafo hasta que se acaba el camino.
 *
 * Un nodo sin arista de salida que no sea `hangup` es un bug del grafo, no una
 * ruta válida: se anota como `!dead-end` en la traza para que se vea al pintarla.
 *
 * @param channel Canal de ari-client. Los tests pasan un doble.
 * @param ctx Se muta: acumula `vars` y `trace`.
 * @param nodes Implementaciones a usar. Se inyectan en los tests.
 * @throws {Hungup} Si el canal cuelga durante cualquier nodo.
 */
export async function run(
  channel: Channel,
  flow: Flow,
  ctx: Ctx,
  nodes: Nodes = NODES,
): Promise<void> {
  let node = flow.nodes.find((n) => n.id === flow.start) ?? null;

  while (node) {
    ctx.trace.push({ node: node.id, at: new Date().toISOString() });
    Object.assign(ctx.vars, await nodes[node.type]!(channel, node.config ?? {}, ctx));

    const next = nextNode(flow, node.id, ctx.vars);
    if (!next && node.type !== 'hangup') {
      ctx.trace.push({ node: '!dead-end', at: new Date().toISOString() });
    }
    node = next;
  }
}
