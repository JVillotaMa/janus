/** @fileoverview El bucle: recorre el grafo ejecutando un nodo tras otro. */

import jsonLogic from 'json-logic-js';
import { NODES } from './nodes.ts';
import type { Channel, Ctx, Flow, NodeSpec, Nodes, Vars } from './types.ts';

/**
 * Techo de nodos por llamada.
 *
 * Un ciclo en el grafo es legítimo —reintentar un menú lo es— pero uno sin
 * salida gira para siempre y se lleva el proceso por delante. La validación no
 * puede distinguirlos, así que la protección va aquí.
 *
 * ponytail: número fijo. Si algún flujo real necesita más, subirlo; no hace
 * falta que sea configurable por flujo hasta que alguien lo pida.
 */
export const MAX_STEPS = 100;

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
 * @param maxSteps Techo de nodos recorridos, para que un ciclo no cuelgue.
 * @throws {Hungup} Si el canal cuelga durante cualquier nodo.
 * @throws {Error} Si se pasa de `maxSteps`.
 */
export async function run(
  channel: Channel,
  flow: Flow,
  ctx: Ctx,
  nodes: Nodes = NODES,
  maxSteps = MAX_STEPS,
): Promise<void> {
  let node = flow.nodes.find((n) => n.id === flow.start) ?? null;
  let steps = 0;

  while (node) {
    if (++steps > maxSteps) {
      ctx.trace.push({ node: '!too-many-steps', at: new Date().toISOString() });
      throw new Error(`el flujo pasó de ${maxSteps} nodos: hay un ciclo sin salida`);
    }
    ctx.trace.push({ node: node.id, at: new Date().toISOString() });
    Object.assign(ctx.vars, await nodes[node.type]!(channel, node.config ?? {}, ctx));

    const next = nextNode(flow, node.id, ctx.vars);
    if (!next && node.type !== 'hangup') {
      ctx.trace.push({ node: '!dead-end', at: new Date().toISOString() });
    }
    node = next;
  }
}
