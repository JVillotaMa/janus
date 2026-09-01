/**
 * Traducción entre flow.json y lo que entiende el editor: etiquetas legibles,
 * la ida y vuelta entre jsonlogic y el árbol de condiciones, cómo se rotula un
 * nodo y una colocación inicial que no lo apile todo en una columna.
 *
 * El vocabulario —campos, variables y sus tipos— no vive aquí: lo declara
 * `src/schema.ts`, que es el mismo que valida el motor.
 */

import { ALWAYS, NODE_TYPES, VARIABLES } from '../../src/schema.ts';

const OPS = { '==': '=', '!=': '≠', '>': '>', '>=': '≥', '<': '<', '<=': '≤' };

/**
 * Los operadores que el constructor ofrece.
 *
 * Son un subconjunto de los que `describe` sabe pintar, y tiene que seguir
 * siéndolo: si se pudiera construir uno que no traduce, la etiqueta de esa
 * arista sería JSON crudo y habrías fabricado con el formulario algo que el
 * propio editor no sabe leer.
 */
export const OPERATORS = [
  ...Object.entries(OPS).map(([op, label]) => ({ op, label })),
  { op: 'in', label: 'está entre' },
];

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

// ─── El árbol de condiciones ─────────────────────────────────────────────────
//
//   Grupo    = { join: 'and' | 'or', negated: boolean, children: [...] }
//   Cláusula = { var, op, value }
//
// Un grupo vacío es "sin condición". Mezclar Y y O es meter un grupo dentro de
// otro, que además quita la ambigüedad de precedencia: son cajas dentro de cajas.

/** Un grupo recién creado, que es también la forma de "esta arista siempre pasa". */
export const emptyGroup = () => ({ join: 'and', negated: false, children: [] });

export const isGroup = (node) => Array.isArray(node?.children);

/**
 * Árbol -> jsonlogic.
 *
 * @param node Un grupo o una cláusula.
 * @returns La expresión, o `undefined` si el grupo está vacío — que es como se
 *     guarda una arista sin condición.
 */
export function toWhen(node) {
  if (!isGroup(node)) {
    return node.op === 'in'
      ? { in: [{ var: node.var }, node.value ?? []] }
      : { [node.op]: [{ var: node.var }, node.value ?? null] };
  }

  const parts = node.children.map(toWhen).filter((part) => part !== undefined);
  if (parts.length === 0) return undefined;

  // Un solo hijo no necesita envoltorio: `{and: [X]}` y `X` significan lo mismo
  // y el segundo es el que se vuelve a leer igual.
  const inner = parts.length === 1 ? parts[0] : { [node.join]: parts };
  return node.negated ? { '!': [inner] } : inner;
}

/**
 * El árbol con un grupo en la raíz.
 *
 * `fromWhen` devuelve exactamente lo que hay: una condición suelta vuelve como
 * cláusula, no como grupo de una. El formulario sí necesita un grupo arriba —es
 * donde viven la unión y el botón de añadir— así que envuelve. La vuelta la
 * deshace sola: un grupo de un solo hijo se guarda pelado.
 *
 * @param node Lo que devolvió `fromWhen`. `null` se propaga: no cabe.
 */
export function asGroup(node) {
  if (node === null) return null;
  return isGroup(node) ? node : { join: 'and', negated: false, children: [node] };
}

/** ¿Es `{var: "algo"}`? */
const isVar = (value) => value && typeof value === 'object' && !Array.isArray(value) && 'var' in value;

/** Un literal: cualquier cosa que no sea una referencia a variable. */
const isLiteral = (value) => !isVar(value) && (value === null || typeof value !== 'object');

/**
 * jsonlogic -> árbol.
 *
 * @param when La condición guardada. Sin ella, un grupo vacío.
 * @returns El árbol, o `null` si contiene algo que el constructor no ofrece.
 *     `null` significa "no cabe en el formulario" y NUNCA una aproximación:
 *     reabrir una condición como algo parecido pero distinto cambia por dónde va
 *     una llamada real y no lo avisa nadie.
 */
export function fromWhen(when) {
  if (when === null || when === undefined) return emptyGroup();
  if (typeof when !== 'object' || Array.isArray(when)) return null;

  const entries = Object.entries(when);
  if (entries.length !== 1) return null;
  const [op, args] = entries[0];
  if (!Array.isArray(args)) return null;

  if (op === 'and' || op === 'or') {
    const children = args.map(fromWhen);
    if (children.some((child) => child === null)) return null;
    return { join: op, negated: false, children };
  }

  if (op === '!') {
    if (args.length !== 1) return null;
    const inner = fromWhen(args[0]);
    if (inner === null) return null;
    // Un grupo sin negar se marca; una cláusula o un grupo ya negado se envuelve,
    // para que `!!x` siga siendo `!!x` al volver.
    return isGroup(inner) && !inner.negated
      ? { ...inner, negated: true }
      : { join: 'and', negated: true, children: [inner] };
  }

  if (op === 'in') {
    if (args.length !== 2 || !isVar(args[0]) || !Array.isArray(args[1])) return null;
    if (!args[1].every(isLiteral)) return null;
    return { var: args[0].var, op, value: args[1] };
  }

  if (!OPS[op]) return null;
  if (args.length !== 2 || !isVar(args[0]) || !isLiteral(args[1])) return null;
  return { var: args[0].var, op, value: args[1] };
}

// ─── Del formulario al flujo ─────────────────────────────────────────────────

/**
 * Lo que devuelve un input, con el tipo que declara el esquema.
 *
 * Sin esto el formulario emitiría `digit == 1` donde el flujo dice `digit == "1"`:
 * jsonlogic compara con `==` flojo, así que funcionaría igual y por eso es
 * peligroso — no falla, solo deja de ser el mismo JSON.
 *
 * @param spec Un campo del esquema o una variable: basta con que declare `type`.
 * @param raw El texto del input. Vacío es "sin valor".
 * @returns El valor tipado, o `undefined` si no hay valor. Un número que no lo es
 *     vuelve como texto, para que la validación se queje en vez de tragárselo.
 */
export function coerce(spec, raw) {
  if (raw === null) return null;
  if (raw === undefined || raw === '') return undefined;
  if (spec?.type !== 'number') return raw;
  const value = Number(raw);
  return Number.isNaN(value) ? raw : value;
}

/**
 * El rótulo de un nodo: su nombre, y si no tiene, su tipo y un resumen.
 *
 * El id no aparece nunca: desde que se genera solo, no dice nada.
 */
export function nodeLabel(node) {
  if (node.name) return node.name;

  const spec = NODE_TYPES[node.type];
  if (!spec) return node.type;

  const config = node.config ?? {};
  const first = spec.fields.find((field) => config[field.name] !== undefined && config[field.name] !== '');
  return first ? `${spec.label} · ${config[first.name]}` : spec.label;
}

/**
 * Las variables que la llamada tiene disponibles al salir de un nodo.
 *
 * `ctx.vars` no es un saco fijo: `digit` solo existe después de un `gather` y
 * `dial` después de un `dial`. Ofrecer una que ahí no existe es ofrecer una
 * condición que no casa nunca, y nada lo diría.
 *
 * ponytail: se mira solo el nodo anterior inmediato, no todos los caminos que
 * llegan hasta él. Con flujos lineales acierta; si hace falta, se recorre hacia
 * atrás desde la arista.
 *
 * @returns Cada variable con su nombre, para pintar el desplegable.
 */
export function varsAt(flow, edge) {
  const from = flow.nodes.find((node) => node.id === edge?.from);
  const names = [...ALWAYS, ...(NODE_TYPES[from?.type]?.produces ?? [])];
  return names.map((name) => ({ name, ...VARIABLES[name] }));
}

/**
 * Un id de nodo nuevo.
 *
 * Opaco a propósito: lo referencian las aristas y `call_steps`, así que no se
 * puede cambiar, y por eso no puede llevar dentro nada que caduque — un prefijo
 * con el tipo se quedaría mintiendo en cuanto se cambie el tipo del nodo. No se
 * enseña en ningún sitio: para eso está el nombre.
 *
 * @param taken Ids que ya existen. Se reintenta hasta no chocar, en vez de
 *     confiar en que cuatro hex no repitan: `nodo-${length + 1}` ya colisionaba
 *     al borrar un nodo del medio y crear otro.
 */
export function newId(taken) {
  const ocupados = taken instanceof Set ? taken : new Set(taken);
  let id;
  do {
    id = `n-${Math.random().toString(16).slice(2, 6).padEnd(4, '0')}`;
  } while (ocupados.has(id));
  return id;
}
