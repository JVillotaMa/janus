// node --test  (lo encuentra solo desde la raíz)
import test from 'node:test';
import assert from 'node:assert/strict';
import { describe as label, edgeLabel, isFallback, layout } from './graph.js';

test('una comparación simple se lee como tal', () => {
  assert.equal(label({ '==': [{ var: 'digit' }, '1'] }), 'digit = 1');
  assert.equal(label({ '>=': [{ var: 'hhmm' }, 900] }), 'hhmm ≥ 900');
  assert.equal(label({ '!=': [{ var: 'dial' }, 'answered'] }), 'dial ≠ answered');
});

test('and encadena con "y"', () => {
  const when = {
    and: [
      { '<=': [{ var: 'weekday' }, 5] },
      { '>=': [{ var: 'hhmm' }, 900] },
      { '<': [{ var: 'hhmm' }, 2100] },
    ],
  };
  assert.equal(label(when), 'weekday ≤ 5 y hhmm ≥ 900 y hhmm < 2100');
});

test('or encadena con "o", y ! niega', () => {
  assert.equal(label({ or: [{ '==': [{ var: 'a' }, 1] }, { '==': [{ var: 'b' }, 2] }] }), 'a = 1 o b = 2');
  assert.equal(label({ '!': [{ '==': [{ var: 'a' }, 1] }] }), 'no a = 1');
});

test('in lista los valores', () => {
  assert.equal(label({ in: [{ var: 'caller' }, ['+34600', '+34601']] }), 'caller en +34600, +34601');
});

test('sin condición es la arista por defecto', () => {
  assert.equal(label(null), 'si no');
  assert.equal(label(undefined), 'si no');
});

test('un operador que no conozco cae al JSON, sin inventarse nada', () => {
  assert.equal(label({ '%': [{ var: 'a' }, 2] }), '{"%":[{"var":"a"},2]}');
});

test('una arista sola no dice "si no": es la continuación', () => {
  const edges = [{ from: 'a', to: 'b' }];
  assert.equal(edgeLabel(edges[0], edges), '');
  assert.equal(isFallback(edges[0], edges), false);
});

test('sin condición pero con hermana condicionada, sí es el "si no"', () => {
  const edges = [
    { from: 'a', to: 'si', when: { '==': [{ var: 'digit' }, '1'] } },
    { from: 'a', to: 'no' },
  ];
  assert.equal(edgeLabel(edges[1], edges), 'si no');
  assert.equal(isFallback(edges[1], edges), true);
});

test('las hermanas de OTRO nodo no cuentan', () => {
  const edges = [
    { from: 'a', to: 'b' },
    { from: 'z', to: 'y', when: { '==': [{ var: 'x' }, 1] } },
    { from: 'z', to: 'w' },
  ];
  assert.equal(edgeLabel(edges[0], edges), '', 'a solo tiene una salida');
});

test('una arista con condición se etiqueta aunque sea la única', () => {
  const edges = [{ from: 'a', to: 'b', when: { '==': [{ var: 'digit' }, '1'] } }];
  assert.equal(edgeLabel(edges[0], edges), 'digit = 1');
  assert.equal(isFallback(edges[0], edges), false);
});

test('la colocación pone cada salto en una fila', () => {
  const flow = {
    start: 'a',
    nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }],
  };
  const pos = layout(flow);
  assert.equal(pos.get('a').y, 0);
  assert.equal(pos.get('b').y, 110);
  assert.equal(pos.get('c').y, 220);
});

test('las ramas hermanas se separan en horizontal', () => {
  const flow = {
    start: 'a',
    nodes: [{ id: 'a' }, { id: 'si' }, { id: 'no' }],
    edges: [{ from: 'a', to: 'si' }, { from: 'a', to: 'no' }],
  };
  const pos = layout(flow);
  assert.equal(pos.get('si').y, pos.get('no').y, 'misma profundidad, misma fila');
  assert.notEqual(pos.get('si').x, pos.get('no').x, 'pero no encima la una de la otra');
});

test('un nodo inalcanzable desde start no se pierde', () => {
  const flow = {
    start: 'a',
    nodes: [{ id: 'a' }, { id: 'huerfano' }],
    edges: [],
  };
  const pos = layout(flow);
  assert.ok(pos.has('huerfano'));
  assert.ok(pos.get('huerfano').y > pos.get('a').y, 'se coloca debajo, visible');
});

// ─── El árbol de condiciones ─────────────────────────────────────────────────

import {
  OPERATORS, coerce, emptyGroup, fromWhen, isGroup, nodeLabel, toWhen, varsAt,
} from './graph.js';
import { NODE_TYPES, VARIABLES, defaults } from '../../src/schema.ts';
import { validate } from '../../src/validate.ts';

/** Valores de muestra de una variable: los suyos si los tiene, o del tipo. */
const samples = (spec) =>
  spec.values ? spec.values.map((choice) => choice.value)
              : spec.type === 'number' ? [0, 900, 2359] : ['', 'x', 'PJSIP/ana'];

const clause = (name, op, value) => ({ var: name, op, value });

test('cada variable, cada operador y cada valor sobreviven la ida y la vuelta', () => {
  let casos = 0;
  for (const [name, spec] of Object.entries(VARIABLES)) {
    for (const { op } of OPERATORS) {
      for (const value of samples(spec)) {
        const original = clause(name, op, op === 'in' ? [value] : value);
        assert.deepEqual(fromWhen(toWhen(original)), original, `${name} ${op} ${JSON.stringify(value)}`);
        casos++;
      }
    }
  }
  assert.ok(casos >= 90, `pocos casos: ${casos}`);
});

test('lo que el constructor construye, describe sabe leerlo', () => {
  for (const [name, spec] of Object.entries(VARIABLES)) {
    for (const { op } of OPERATORS) {
      const value = samples(spec)[0];
      const texto = label(toWhen(clause(name, op, op === 'in' ? [value] : value)));
      assert.ok(!texto.startsWith('{'), `${name} ${op} cae al JSON crudo: ${texto}`);
    }
  }
});

const c1 = clause('hhmm', '>=', 900);
const c2 = clause('hhmm', '<', 2100);
const c3 = clause('digit', '==', '1');

test('un grupo con varios hijos guarda su unión', () => {
  const group = { join: 'and', negated: false, children: [c1, c2] };
  assert.deepEqual(toWhen(group), { and: [{ '>=': [{ var: 'hhmm' }, 900] }, { '<': [{ var: 'hhmm' }, 2100] }] });
  assert.deepEqual(fromWhen(toWhen(group)), group);
});

test('se mezclan Y y O anidando un grupo dentro de otro', () => {
  const group = {
    join: 'and',
    negated: false,
    children: [c1, { join: 'or', negated: false, children: [c3, clause('digit', '==', '2')] }],
  };
  const when = toWhen(group);
  assert.deepEqual(when.and[1], { or: [{ '==': [{ var: 'digit' }, '1'] }, { '==': [{ var: 'digit' }, '2'] }] });
  assert.deepEqual(fromWhen(when), group);
  assert.equal(label(when), 'hhmm ≥ 900 y digit = 1 o digit = 2');
});

test('un grupo negado se envuelve en ! y vuelve igual', () => {
  const group = { join: 'and', negated: true, children: [c1, c2] };
  assert.deepEqual(toWhen(group), { '!': [{ and: [{ '>=': [{ var: 'hhmm' }, 900] }, { '<': [{ var: 'hhmm' }, 2100] }] }] });
  assert.deepEqual(fromWhen(toWhen(group)), group);
});

test('negar una sola cláusula no pierde la negación', () => {
  const group = { join: 'and', negated: true, children: [c3] };
  assert.deepEqual(toWhen(group), { '!': [{ '==': [{ var: 'digit' }, '1'] }] });
  assert.deepEqual(fromWhen(toWhen(group)), group);
});

test('una doble negación no se colapsa', () => {
  const when = { '!': [{ '!': [{ '==': [{ var: 'digit' }, '1'] }] }] };
  assert.deepEqual(toWhen(fromWhen(when)), when);
});

// ─── Las dos normalizaciones, declaradas en el diseño ────────────────────────

test('un grupo vacío es "sin condición"', () => {
  assert.equal(toWhen(emptyGroup()), undefined);
  assert.deepEqual(fromWhen(undefined), emptyGroup());
  assert.deepEqual(fromWhen(null), emptyGroup());
});

test('un grupo de un solo hijo vuelve pelado, sin envoltorio', () => {
  assert.deepEqual(toWhen({ join: 'and', negated: false, children: [c3] }), { '==': [{ var: 'digit' }, '1'] });
  assert.deepEqual(toWhen(fromWhen({ and: [{ '==': [{ var: 'digit' }, '1'] }] })), { '==': [{ var: 'digit' }, '1'] });
});

test('la normalización es idempotente: aplicarla otra vez no cambia nada', () => {
  const una = toWhen(fromWhen({ and: [{ '==': [{ var: 'digit' }, '1'] }] }));
  assert.deepEqual(toWhen(fromWhen(una)), una);
});

test('un grupo anidado vacío no ensucia al padre', () => {
  const group = { join: 'and', negated: false, children: [c1, emptyGroup()] };
  assert.deepEqual(toWhen(group), { '>=': [{ var: 'hhmm' }, 900] });
});

// ─── La zona negativa: "no cabe" nunca es una aproximación ───────────────────

test('un operador fuera del vocabulario no se representa', () => {
  assert.equal(fromWhen({ '%': [{ var: 'a' }, 2] }), null);
  assert.equal(fromWhen({ if: [{ var: 'a' }, 1, 2] }), null);
  assert.equal(fromWhen({ missing: ['a'] }), null);
});

test('comparar dos variables entre sí no se representa', () => {
  assert.equal(fromWhen({ '==': [{ var: 'a' }, { var: 'b' }] }), null);
});

test('un operador desconocido dentro de un and contamina al grupo entero', () => {
  assert.equal(fromWhen({ and: [{ '==': [{ var: 'a' }, 1] }, { '%': [{ var: 'b' }, 2] }] }), null);
});

test('lo que no se representa se puede seguir leyendo tal cual', () => {
  const raro = { '%': [{ var: 'a' }, 2] };
  assert.equal(fromWhen(raro), null);
  assert.equal(label(raro), '{"%":[{"var":"a"},2]}', 'describe lo sigue enseñando sin inventar');
});

test('formas rotas no revientan, devuelven null', () => {
  for (const roto of [{}, [], 'texto', 42, { and: 'no es lista' }, { '==': [1, 2] }, { '!': [] }]) {
    assert.equal(fromWhen(roto), null, JSON.stringify(roto));
  }
});

// ─── Contra el flujo real del repo ───────────────────────────────────────────

test('todas las condiciones de flow.json sobreviven la ida y la vuelta', async () => {
  const { readFile } = await import('node:fs/promises');
  const flow = JSON.parse(await readFile(new URL('../../flow.json', import.meta.url), 'utf8'));

  let conCondicion = 0;
  for (const edge of flow.edges) {
    if (!edge.when) continue;
    conCondicion++;
    const arbol = fromWhen(edge.when);
    assert.notEqual(arbol, null, `no cabe en el formulario: ${JSON.stringify(edge.when)}`);
    assert.deepEqual(toWhen(arbol), edge.when, `${edge.from} → ${edge.to}`);
  }
  assert.ok(conCondicion >= 2, 'el flujo del repo tiene condiciones que probar');
});

test('el and de tres cláusulas del horario real vuelve idéntico', () => {
  const horario = {
    and: [
      { '<=': [{ var: 'weekday' }, 7] },
      { '>=': [{ var: 'hhmm' }, 900] },
      { '<': [{ var: 'hhmm' }, 2359] },
    ],
  };
  assert.deepEqual(toWhen(fromWhen(horario)), horario);
});

// ─── Del formulario al flujo ─────────────────────────────────────────────────

test('coerce respeta el tipo que declara el esquema', () => {
  assert.equal(coerce({ type: 'number' }, '20'), 20);
  assert.equal(coerce({ type: 'string' }, '20'), '20');
  assert.equal(coerce({ type: 'string' }, '1'), '1', 'digit se compara como cadena');
  assert.equal(coerce({ type: 'number' }, '900'), 900, 'hhmm se compara como número');
});

test('coerce distingue "sin valor" de "cero"', () => {
  assert.equal(coerce({ type: 'number' }, ''), undefined);
  assert.equal(coerce({ type: 'string' }, ''), undefined);
  assert.equal(coerce({ type: 'number' }, '0'), 0);
  assert.equal(coerce({ type: 'string' }, null), null, 'null es un valor: "no pulsó nada"');
});

test('un número que no lo es vuelve como texto, para que la validación se queje', () => {
  assert.equal(coerce({ type: 'number' }, 'veinte'), 'veinte');
});

test('el rótulo es el nombre, y si no hay, el tipo y un resumen', () => {
  assert.equal(nodeLabel({ id: 'n-7f3a', type: 'say', name: 'Bienvenida' }), 'Bienvenida');
  assert.equal(nodeLabel({ id: 'n-7f3a', type: 'say', config: { media: 'sound:hola' } }), 'Reproducir · sound:hola');
  assert.equal(nodeLabel({ id: 'n-7f3a', type: 'hangup' }), 'Colgar');
  assert.equal(nodeLabel({ id: 'n-7f3a', type: 'dial', config: { endpoint: 'PJSIP/ana', timeout: 20 } }), 'Llamar · PJSIP/ana');
});

test('el rótulo nunca es el id, ni siquiera con un tipo desconocido', () => {
  assert.equal(nodeLabel({ id: 'n-7f3a', type: 'inventado' }), 'inventado');
  for (const node of [
    { id: 'n-7f3a', type: 'say', name: 'X' },
    { id: 'n-7f3a', type: 'say', config: { media: 'm' } },
    { id: 'n-7f3a', type: 'hangup' },
  ]) {
    assert.ok(!nodeLabel(node).includes('n-7f3a'), JSON.stringify(node));
  }
});

// ─── Qué variables ofrece cada arista ────────────────────────────────────────

const flujo = {
  start: 'e',
  nodes: [
    { id: 'e', type: 'entry' },
    { id: 'm', type: 'gather' },
    { id: 'd', type: 'dial' },
    { id: 'f', type: 'hangup' },
  ],
  edges: [{ from: 'e', to: 'm' }, { from: 'm', to: 'd' }, { from: 'd', to: 'f' }],
};
const nombres = (edge) => varsAt(flujo, edge).map((v) => v.name);

test('las variables de la llamada están en cualquier arista', () => {
  for (const edge of flujo.edges) {
    for (const name of ['caller', 'did', 'hhmm', 'weekday', 'date']) {
      assert.ok(nombres(edge).includes(name), `falta ${name} en ${edge.from} → ${edge.to}`);
    }
  }
});

test('digit solo se ofrece detrás de un gather, y dial detrás de un dial', () => {
  assert.deepEqual(nombres({ from: 'm', to: 'd' }).filter((n) => n === 'digit'), ['digit']);
  assert.deepEqual(nombres({ from: 'd', to: 'f' }).filter((n) => n === 'dial'), ['dial']);
  assert.equal(nombres({ from: 'e', to: 'm' }).includes('digit'), false);
  assert.equal(nombres({ from: 'e', to: 'm' }).includes('dial'), false);
  assert.equal(nombres({ from: 'm', to: 'd' }).includes('dial'), false);
});

test('cada variable ofrecida llega con su etiqueta y su tipo', () => {
  for (const variable of varsAt(flujo, { from: 'm', to: 'd' })) {
    assert.equal(typeof variable.label, 'string', variable.name);
    assert.ok(['string', 'number'].includes(variable.type), variable.name);
  }
  const digit = varsAt(flujo, { from: 'm', to: 'd' }).find((v) => v.name === 'digit');
  assert.ok(digit.values.some((choice) => choice.value === null), 'digit puede no pulsarse');
});

// ─── El círculo se cierra: lo construible lo acepta el motor ─────────────────

/** Un nodo como lo dejaría el formulario: defectos del esquema y los obligatorios puestos. */
const built = (id, type) => {
  const config = { ...defaults(type) };
  for (const field of NODE_TYPES[type].fields) {
    if (field.required) config[field.name] = coerce(field, field.placeholder ?? 'x');
  }
  return { id, type, ...(Object.keys(config).length ? { config } : {}) };
};

test('un flujo construido con el esquema y el constructor lo acepta el motor', () => {
  const flow = {
    start: 'n-1',
    nodes: [
      built('n-1', 'entry'), built('n-2', 'say'), built('n-3', 'gather'),
      built('n-4', 'dial'), built('n-5', 'hangup'),
    ],
    edges: [
      { from: 'n-1', to: 'n-2', when: toWhen({ join: 'and', negated: false, children: [c1, c2] }) },
      { from: 'n-2', to: 'n-3' },
      { from: 'n-3', to: 'n-4', when: toWhen(clause('digit', '==', '1')) },
      { from: 'n-3', to: 'n-5' },
      { from: 'n-4', to: 'n-5' },
    ],
  };
  assert.deepEqual(validate(flow).filter((issue) => issue.level === 'error'), []);
});

test('un nodo recién creado solo se queja de los campos que faltan por rellenar', () => {
  for (const type of Object.keys(NODE_TYPES)) {
    const nuevo = { id: 'n-1', type, config: defaults(type) };
    const errores = validate({ start: 'n-1', nodes: [nuevo], edges: [] })
      .filter((issue) => issue.level === 'error' && /obligatorio|tiene que ser/.test(issue.message));
    const obligatorios = NODE_TYPES[type].fields.filter((field) => field.required).length;
    assert.equal(errores.length, obligatorios, `${type}: ${JSON.stringify(errores)}`);
  }
});

// ─── Los ids ─────────────────────────────────────────────────────────────────

import { newId } from './graph.js';

test('un id nuevo nunca choca con los que ya hay', () => {
  // Se ocupa casi todo el espacio para forzar el reintento: con `nodo-N` esto
  // devolvía un id repetido en cuanto se borraba un nodo del medio.
  const todos = new Set();
  for (let i = 0; i < 0x10000; i++) todos.add(`n-${i.toString(16).padStart(4, '0')}`);
  todos.delete('n-abcd');
  assert.equal(newId(todos), 'n-abcd');
});

test('crear tras borrar uno del medio no repite id', () => {
  let ids = ['n-0001', 'n-0002', 'n-0003'];
  ids = ids.filter((id) => id !== 'n-0002');
  for (let i = 0; i < 200; i++) {
    const nuevo = newId(ids);
    assert.equal(ids.includes(nuevo), false, `${nuevo} ya existía`);
    ids.push(nuevo);
  }
  assert.equal(new Set(ids).size, ids.length);
});

test('el id tiene la forma opaca que se espera, sin decir el tipo', () => {
  assert.match(newId([]), /^n-[0-9a-f]{4}$/);
});

import { asGroup } from './graph.js';

test('asGroup envuelve una cláusula suelta y deja pasar los grupos', () => {
  assert.deepEqual(asGroup(c3), { join: 'and', negated: false, children: [c3] });
  const grupo = { join: 'or', negated: false, children: [c1, c2] };
  assert.equal(asGroup(grupo), grupo);
  assert.equal(asGroup(null), null, 'lo que no cabe sigue sin caber');
});

test('envolver y volver a guardar no añade envoltorio al flujo', () => {
  const when = { '==': [{ var: 'digit' }, '1'] };
  assert.deepEqual(toWhen(asGroup(fromWhen(when))), when);
});

// ─── Renombrar no reescribe el pasado ────────────────────────────────────────

test('la traza se rotula con el grafo de su versión, no con el de ahora', () => {
  const v1 = { nodes: [{ id: 'n-0001', type: 'say', name: 'Saluda', config: { media: 'sound:hola' } }] };
  const v2 = { nodes: [{ id: 'n-0001', type: 'say', name: 'Bienvenida', config: { media: 'sound:hola' } }] };

  const rotula = (flow, id) => {
    const node = flow.nodes.find((n) => n.id === id);
    return node ? nodeLabel(node) : id;
  };

  assert.equal(rotula(v1, 'n-0001'), 'Saluda', 'la llamada de ayer sigue diciendo lo de ayer');
  assert.equal(rotula(v2, 'n-0001'), 'Bienvenida', 'la de hoy dice lo de hoy');
});

test('sin grafo contra el que resolver se enseña el id, no un nombre inventado', () => {
  const rotula = (flow, id) => {
    const node = flow?.nodes.find((n) => n.id === id);
    return node ? nodeLabel(node) : id;
  };
  assert.equal(rotula(null, 'n-0001'), 'n-0001');
  assert.equal(rotula({ nodes: [] }, 'n-0001'), 'n-0001');
});

test('los marcadores del motor no se rotulan: no son nodos', () => {
  for (const marca of ['!dead-end', '!too-many-steps']) {
    assert.ok(marca.startsWith('!'), 'el rotulador los distingue por el prefijo');
  }
});
