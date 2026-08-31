/** @fileoverview Tests de la validación del grafo. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../src/validate.ts';
import type { Flow } from '../src/types.ts';

const TYPES = ['say', 'gather', 'dial', 'hangup'];
const check = (flow: Flow) => validate(flow, TYPES);
const errors = (flow: Flow) => check(flow).filter((i) => i.level === 'error');
const warnings = (flow: Flow) => check(flow).filter((i) => i.level === 'warning');

/** Un flujo mínimo y correcto. */
const sano: Flow = {
  start: 'saluda',
  nodes: [
    { id: 'saluda', type: 'say', config: { media: 'sound:hola' } },
    { id: 'fin', type: 'hangup' },
  ],
  edges: [{ from: 'saluda', to: 'fin' }],
};

test('un flujo correcto no produce nada', () => {
  assert.deepEqual(check(sano), []);
});

// ─── Errores: bloquean el guardado ───────────────────────────────────────────

test('un tipo de nodo que el motor no conoce es error', () => {
  const flow = { ...sano, nodes: [{ id: 'saluda', type: 'inventado' }, sano.nodes[1]!] };
  const [issue] = errors(flow as Flow);
  assert.equal(issue!.where, 'saluda');
  assert.match(issue!.message, /no conoce el tipo "inventado"/);
});

test('un start que no existe es error', () => {
  assert.equal(errors({ ...sano, start: 'fantasma' }).length, 1);
});

test('una arista a un nodo inexistente es error', () => {
  const flow: Flow = { ...sano, edges: [{ from: 'saluda', to: 'fantasma' }] };
  const [issue] = errors(flow);
  assert.equal(issue!.where, 'saluda → fantasma');
  assert.match(issue!.message, /destino/);
});

test('una arista desde un nodo inexistente también es error', () => {
  const flow: Flow = { ...sano, edges: [{ from: 'fantasma', to: 'fin' }] };
  assert.match(errors(flow)[0]!.message, /origen/);
});

test('dos nodos con el mismo id es error', () => {
  const flow: Flow = {
    ...sano,
    nodes: [...sano.nodes, { id: 'saluda', type: 'say' }],
  };
  assert.match(errors(flow)[0]!.message, /dos nodos con este id/);
});

// ─── Avisos: dejan guardar pero se ven ───────────────────────────────────────

test('un nodo sin salida que no es hangup avisa', () => {
  const flow: Flow = { start: 'a', nodes: [{ id: 'a', type: 'say' }], edges: [] };
  assert.match(warnings(flow)[0]!.message, /no tiene salida/);
});

test('un hangup sin salida NO avisa: ahí termina la llamada', () => {
  const flow: Flow = { start: 'a', nodes: [{ id: 'a', type: 'hangup' }], edges: [] };
  assert.deepEqual(check(flow), []);
});

test('una arista sin condición tapa a las que van detrás', () => {
  const flow: Flow = {
    start: 'menu',
    nodes: [
      { id: 'menu', type: 'gather' },
      { id: 'uno', type: 'hangup' },
      { id: 'otro', type: 'hangup' },
    ],
    edges: [
      { from: 'menu', to: 'otro' },
      { from: 'menu', to: 'uno', when: { '==': [{ var: 'digit' }, '1'] } },
    ],
  };
  const [issue] = warnings(flow);
  assert.equal(issue!.where, 'menu');
  assert.match(issue!.message, /tapa a las 1 siguientes/);
});

test('la condicionada primero y la abierta al final no avisa', () => {
  const flow: Flow = {
    start: 'menu',
    nodes: [
      { id: 'menu', type: 'gather' },
      { id: 'uno', type: 'hangup' },
      { id: 'otro', type: 'hangup' },
    ],
    edges: [
      { from: 'menu', to: 'uno', when: { '==': [{ var: 'digit' }, '1'] } },
      { from: 'menu', to: 'otro' },
    ],
  };
  assert.deepEqual(check(flow), []);
});

test('un nodo al que no se llega desde start avisa', () => {
  const flow: Flow = {
    ...sano,
    nodes: [...sano.nodes, { id: 'suelto', type: 'hangup' }],
  };
  const [issue] = warnings(flow);
  assert.equal(issue!.where, 'suelto');
  assert.match(issue!.message, /no se llega/);
});

test('un ciclo no cuelga la comprobación de alcanzables', () => {
  const flow: Flow = {
    start: 'a',
    nodes: [{ id: 'a', type: 'say' }, { id: 'b', type: 'say' }],
    edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }],
  };
  assert.deepEqual(warnings(flow), []);
});

test('acumula varios problemas a la vez', () => {
  const flow: Flow = {
    start: 'fantasma',
    nodes: [{ id: 'a', type: 'inventado' }],
    edges: [{ from: 'a', to: 'tampoco' }],
  };
  assert.equal(errors(flow).length, 3, 'tipo, start y destino');
});

test('el flujo real del repo está sano', async () => {
  const { readFile } = await import('node:fs/promises');
  const flow = JSON.parse(
    await readFile(new URL('../flow.json', import.meta.url), 'utf8'),
  ) as Flow;
  assert.deepEqual(check(flow), []);
});
