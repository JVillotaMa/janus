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
import { parseEndpoint } from './endpoint.ts';
import { NODE_TYPES } from './schema.ts';
import type { Edge, Flow, NodeSpec } from './types.ts';

export interface Issue {
  level: 'error' | 'warning';
  /** Id del nodo, o `origen → destino` si es de una arista. */
  where: string;
  message: string;
}

/**
 * @param flow El grafo a comprobar.
 * @param trunks Nombres de las troncales dadas de alta, para avisar si la
 *     entrada nombra una que no existe.
 * @param types Tipos de nodo que el motor sabe ejecutar.
 * @returns Errores y avisos, en orden de aparición. Vacío si todo está bien.
 */
export function validate(
  flow: Flow,
  trunks: string[] = [],
  types: string[] = Object.keys(NODES),
): Issue[] {
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
    for (const issue of configIssues(node)) issues.push(issue);
  }

  // El nombre es un rótulo, no una clave: dos iguales confunden al leer la traza
  // pero no rompen nada, así que avisan en vez de bloquear.
  const byName = new Map<string, string[]>();
  for (const node of flow.nodes) {
    if (node.name) byName.set(node.name, [...(byName.get(node.name) ?? []), node.id]);
  }
  for (const [name, repes] of byName) {
    if (repes.length > 1) {
      for (const id of repes) warn(id, `hay ${repes.length} nodos llamados "${name}"`);
    }
  }

  if (!ids.has(flow.start)) {
    error(flow.start, 'el nodo de arranque no existe');
  }

  const entries = flow.nodes.filter((node) => node.type === 'entry');
  if (entries.length !== 1) {
    error('entry', `tiene que haber exactamente un nodo de entrada, hay ${entries.length}`);
  }

  const entry = entries[0];
  if (entry) {
    if (flow.start !== entry.id) {
      error(entry.id, 'el nodo de arranque tiene que ser el nodo de entrada');
    }
    for (const edge of flow.edges.filter((e) => e.to === entry.id)) {
      error(`${edge.from} → ${edge.to}`, 'no puede entrar ninguna arista en el nodo de entrada');
    }
    const trunk = entry.config?.trunk;
    if (trunk && !trunks.includes(trunk)) {
      warn(entry.id, `la troncal "${trunk}" no está dada de alta`);
    }
  }

  // Un `dial` que sale por una troncal que no existe falla mudo: el originate no
  // encuentra el endpoint, el nodo devuelve `dial: "failed"` y la llamada sigue
  // por la arista por defecto, así que en la traza se ve igual que si hubieran
  // colgado. Aviso y no error, porque montar el flujo antes de dar de alta la
  // troncal es un orden de trabajo válido.
  for (const node of flow.nodes) {
    if (node.type !== 'dial') continue;
    const destino = parseEndpoint(node.config?.endpoint);
    if (destino?.trunk && !trunks.includes(destino.trunk)) {
      warn(node.id, `llama por la troncal "${destino.trunk}", que no está dada de alta`);
    }
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

/**
 * Comprueba el config de un nodo contra los campos que declara su tipo.
 *
 * Falta un obligatorio o está con el tipo equivocado: error, porque revienta en
 * una llamada real. Un campo de más: aviso, porque el motor lo ignora y puede
 * ser el resto de un cambio de tipo.
 *
 * @param node El nodo a comprobar. Un tipo que el esquema no declara no produce
 *     nada aquí: de ese ya se queja el bucle principal.
 */
function configIssues(node: NodeSpec): Issue[] {
  const spec = NODE_TYPES[node.type];
  if (!spec) return [];

  const config = node.config ?? {};
  const issues: Issue[] = [];

  for (const field of spec.fields) {
    const value = config[field.name];
    if (value === undefined || value === null || value === '') {
      if (field.required) {
        issues.push({
          level: 'error',
          where: node.id,
          message: `falta "${field.label}" (${field.name}), que es obligatorio`,
        });
      }
      continue;
    }
    if (typeof value !== field.type) {
      issues.push({
        level: 'error',
        where: node.id,
        message: `"${field.name}" tiene que ser ${field.type === 'number' ? 'un número' : 'texto'}`,
      });
    }
  }

  for (const key of Object.keys(config)) {
    if (!spec.fields.some((field) => field.name === key)) {
      issues.push({
        level: 'warning',
        where: node.id,
        message: `un nodo de tipo "${node.type}" no usa el campo "${key}"`,
      });
    }
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
