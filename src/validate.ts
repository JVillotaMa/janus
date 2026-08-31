/**
 * @fileoverview Comprobaciones sobre un grafo antes de aceptarlo.
 *
 * Sin esto el editor deja guardar un flujo roto y el fallo aparece en una
 * llamada real: un tipo de nodo que el motor no conoce revienta a mitad, y una
 * arista a un nodo inexistente se traga la ruta sin decir nada.
 *
 * Los errores bloquean el guardado. Los avisos no: mientras construyes hay
 * estados intermedios legítimos (un nodo recién puesto todavía no tiene aristas).
 */

import { NODES } from './nodes.ts';
import type { Edge, Flow } from './types.ts';

export interface Issue {
  level: 'error' | 'warning';
  /** Id del nodo, o `origen → destino` si es de una arista. */
  where: string;
  message: string;
}

/**
 * @param flow El grafo a comprobar.
 * @param types Tipos de nodo que el motor sabe ejecutar.
 * @returns Errores y avisos, en orden de aparición. Vacío si todo está bien.
 */
export function validate(flow: Flow, types: string[] = Object.keys(NODES)): Issue[] {
  const issues: Issue[] = [];
  const error = (where: string, message: string) =>
    issues.push({ level: 'error', where, message });
  const warn = (where: string, message: string) =>
    issues.push({ level: 'warning', where, message });

  const ids = new Set<string>();
  for (const node of flow.nodes) {
    if (ids.has(node.id)) error(node.id, 'hay dos nodos con este id');
    ids.add(node.id);
    if (!types.includes(node.type)) {
      error(node.id, `el motor no conoce el tipo "${node.type}"`);
    }
  }

  if (!ids.has(flow.start)) {
    error(flow.start, 'el nodo de arranque no existe');
  }

  const outgoing = new Map<string, Edge[]>();
  for (const edge of flow.edges) {
    const where = `${edge.from} → ${edge.to}`;
    if (!ids.has(edge.from)) error(where, `no existe el nodo de origen "${edge.from}"`);
    if (!ids.has(edge.to)) error(where, `no existe el nodo de destino "${edge.to}"`);
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
  }

  for (const node of flow.nodes) {
    const salidas = outgoing.get(node.id) ?? [];

    if (salidas.length === 0 && node.type !== 'hangup') {
      warn(node.id, 'no tiene salida: la llamada termina aquí y se marca !dead-end');
    }

    // Gana la primera arista que casa, así que lo que venga detrás de una sin
    // condición no se alcanza jamás.
    const abierta = salidas.findIndex((edge) => !edge.when);
    if (abierta !== -1 && abierta < salidas.length - 1) {
      warn(
        node.id,
        `la arista sin condición hacia "${salidas[abierta]!.to}" tapa a las ${salidas.length - abierta - 1} siguientes`,
      );
    }
  }

  for (const id of unreachable(flow, ids)) {
    warn(id, 'no se llega desde el nodo de arranque');
  }

  return issues;
}

/** Nodos a los que no se llega desde `start`. */
function unreachable(flow: Flow, ids: Set<string>): string[] {
  const seen = new Set<string>();
  const queue = ids.has(flow.start) ? [flow.start] : [];

  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const edge of flow.edges) {
      if (edge.from === id && !seen.has(edge.to)) queue.push(edge.to);
    }
  }

  return flow.nodes.map((node) => node.id).filter((id) => !seen.has(id));
}
