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
