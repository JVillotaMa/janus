/**
 * Traducción entre flow.json y React Flow: etiquetas legibles, colores por
 * tipo de nodo y una colocación inicial que no lo apile todo en una columna.
 */

const OPS = { '==': '=', '!=': '≠', '>': '>', '>=': '≥', '<': '<', '<=': '≤' };

/** Un operando: `{var: "digit"}` es el nombre, y un literal se muestra pelado. */
const term = (value) =>
  value && typeof value === 'object' && 'var' in value ? value.var : String(value);

/**
 * jsonlogic -> castellano. Sin condición es la arista por defecto.
 *
 * Solo traduce los operadores que se usan; cualquier otro cae al JSON crudo,
 * que es feo pero nunca miente sobre lo que hace la arista.
 */
export function describe(when) {
  if (!when) return 'si no';

  const [op, args] = Object.entries(when)[0];
  if (op === 'and') return args.map(describe).join(' y ');
  if (op === 'or') return args.map(describe).join(' o ');
  if (op === '!') return `no ${describe(args[0])}`;
  if (op === 'in') return `${term(args[0])} en ${args[1].map(term).join(', ')}`;
  if (OPS[op]) return `${term(args[0])} ${OPS[op]} ${term(args[1])}`;

  return JSON.stringify(when);
}

/**
 * ¿Es esta arista la salida por defecto de una bifurcación?
 *
 * Sin condición y siendo la única salida del nodo, no es un "si no": es la
 * continuación, una línea fija. Solo hay defecto cuando hay algo de lo que
 * defenderse — otra arista con condición que puede no casar.
 */
export function isFallback(edge, edges) {
  return !edge.when && edges.filter((other) => other.from === edge.from).length > 1;
}

/** Texto de una arista. Vacío cuando es la única salida y no condiciona nada. */
export function edgeLabel(edge, edges) {
  if (edge.when) return describe(edge.when);
  return isFallback(edge, edges) ? 'si no' : '';
}

/**
 * Coloca los nodos por profundidad desde `start`: una fila por salto, los
 * hermanos repartidos en horizontal. Solo se usa para los que aún no tienen
 * `position` guardada, así que en cuanto arrastras uno, manda tu posición.
 */
export function layout(flow) {
  const depth = new Map([[flow.start, 0]]);
  const queue = [flow.start];

  while (queue.length) {
    const id = queue.shift();
    for (const edge of flow.edges) {
      if (edge.from === id && !depth.has(edge.to)) {
        depth.set(edge.to, depth.get(id) + 1);
        queue.push(edge.to);
      }
    }
  }

  // Los nodos inalcanzables desde start van al final, para que se vean.
  const maxDepth = Math.max(0, ...depth.values());
  const rows = new Map();
  const positions = new Map();

  for (const node of flow.nodes) {
    const row = depth.get(node.id) ?? maxDepth + 1;
    const column = rows.get(row) ?? 0;
    rows.set(row, column + 1);
    positions.set(node.id, { x: column * 230, y: row * 110 });
  }
  return positions;
}
