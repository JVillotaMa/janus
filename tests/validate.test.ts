/** @fileoverview Tests de la validación del grafo. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../src/validate.ts';
import type { Flow } from '../src/types.ts';

const TYPES = ['entry', 'say', 'gather', 'dial', 'hangup'];
const check = (flow: Flow, trunks: string[] = []) => validate(flow, trunks, TYPES);
const errors = (flow: Flow) => check(flow).filter((i) => i.level === 'error');
const warnings = (flow: Flow) => check(flow).filter((i) => i.level === 'warning');

/** El nodo de entrada, que es obligatorio en todo flujo. */
const entrada = { id: 'entrada', type: 'entry' };

/** Un flujo mínimo y correcto. */
const sano: Flow = {
  start: 'entrada',
  nodes: [entrada, { id: 'saluda', type: 'say', config: { media: 'sound:hola' } }, { id: 'fin', type: 'hangup' }],
  edges: [{ from: 'entrada', to: 'saluda' }, { from: 'saluda', to: 'fin' }],
};

/** Cuelga un flujo de un nodo de entrada, para los tests que van de otra cosa. */
const conEntrada = (start: string, nodes: Flow['nodes'], edges: Flow['edges']): Flow => ({
  start: 'entrada',
  nodes: [entrada, ...nodes],
  edges: [{ from: 'entrada', to: start }, ...edges],
});

test('un flujo correcto no produce nada', () => {
  assert.deepEqual(check(sano), []);
});

// ─── Errores: bloquean el guardado ───────────────────────────────────────────

test('un tipo de nodo que el motor no conoce es error', () => {
  const flow: Flow = { ...sano, nodes: [entrada, { id: 'saluda', type: 'inventado' }, sano.nodes[2]!] };
  const [issue] = errors(flow);
  assert.equal(issue!.where, 'saluda');
  assert.match(issue!.message, /no conoce el tipo "inventado"/);
});

test('un start que no existe es error', () => {
  assert.ok(errors({ ...sano, start: 'fantasma' }).some((i) => /no existe/.test(i.message)));
});

test('una arista a un nodo inexistente es error', () => {
  const flow: Flow = { ...sano, edges: [...sano.edges, { from: 'saluda', to: 'fantasma' }] };
  const [issue] = errors(flow);
  assert.equal(issue!.where, 'saluda → fantasma');
  assert.match(issue!.message, /destino/);
});

test('una arista desde un nodo inexistente también es error', () => {
  const flow: Flow = { ...sano, edges: [...sano.edges, { from: 'fantasma', to: 'fin' }] };
  assert.match(errors(flow)[0]!.message, /origen/);
});

test('dos nodos con el mismo id es error', () => {
  const flow: Flow = { ...sano, nodes: [...sano.nodes, { id: 'saluda', type: 'say' }] };
  assert.match(errors(flow)[0]!.message, /dos nodos con este id/);
});

// ─── El nodo de entrada ──────────────────────────────────────────────────────

test('un flujo sin nodo de entrada es error', () => {
  const flow: Flow = { start: 'fin', nodes: [{ id: 'fin', type: 'hangup' }], edges: [] };
  assert.match(errors(flow)[0]!.message, /exactamente un nodo de entrada, hay 0/);
});

test('dos nodos de entrada es error', () => {
  const flow: Flow = { ...sano, nodes: [...sano.nodes, { id: 'otra', type: 'entry' }] };
  assert.ok(errors(flow).some((i) => /hay 2/.test(i.message)));
});

test('el arranque tiene que ser el nodo de entrada', () => {
  const flow: Flow = { ...sano, start: 'saluda' };
  assert.ok(errors(flow).some((i) => /el nodo de arranque tiene que ser el nodo de entrada/.test(i.message)));
});

test('una arista hacia el nodo de entrada es error', () => {
  const flow: Flow = { ...sano, edges: [...sano.edges, { from: 'fin', to: 'entrada' }] };
  const [issue] = errors(flow);
  assert.equal(issue!.where, 'fin → entrada');
  assert.match(issue!.message, /no puede entrar ninguna arista/);
});

test('la entrada puede ramificar sin ejecutar nada antes', () => {
  const flow: Flow = {
    start: 'entrada',
    nodes: [entrada, { id: 'abierto', type: 'hangup' }, { id: 'cerrado', type: 'hangup' }],
    edges: [
      { from: 'entrada', to: 'abierto', when: { '>=': [{ var: 'hhmm' }, 900] } },
      { from: 'entrada', to: 'cerrado' },
    ],
  };
  assert.deepEqual(check(flow), []);
});

test('una troncal que no está dada de alta avisa, no bloquea', () => {
  const flow: Flow = {
    ...sano,
    nodes: [{ ...entrada, config: { trunk: 'fantasma' } }, ...sano.nodes.slice(1)],
  };
  assert.deepEqual(errors(flow), []);
  assert.match(warnings(flow)[0]!.message, /la troncal "fantasma" no está dada de alta/);
});

test('una troncal dada de alta no avisa', () => {
  const flow: Flow = {
    ...sano,
    nodes: [{ ...entrada, config: { trunk: 'masmovil' } }, ...sano.nodes.slice(1)],
  };
  assert.deepEqual(check(flow, ['masmovil']), []);
});

// ─── Avisos: dejan guardar pero se ven ───────────────────────────────────────

test('un nodo sin salida que no es hangup avisa', () => {
  const flow = conEntrada('a', [{ id: 'a', type: 'say' }], []);
  assert.match(warnings(flow)[0]!.message, /no tiene salida/);
});

test('un hangup sin salida NO avisa: ahí termina la llamada', () => {
  const flow = conEntrada('a', [{ id: 'a', type: 'hangup' }], []);
  assert.deepEqual(check(flow), []);
});

test('una arista sin condición tapa a las que van detrás', () => {
  const flow = conEntrada(
    'menu',
    [{ id: 'menu', type: 'gather' }, { id: 'uno', type: 'hangup' }, { id: 'otro', type: 'hangup' }],
    [
      { from: 'menu', to: 'otro' },
      { from: 'menu', to: 'uno', when: { '==': [{ var: 'digit' }, '1'] } },
    ],
  );
  const [issue] = warnings(flow);
  assert.equal(issue!.where, 'menu');
  assert.match(issue!.message, /tapa a las 1 siguientes/);
});

test('la condicionada primero y la abierta al final no avisa', () => {
  const flow = conEntrada(
    'menu',
    [{ id: 'menu', type: 'gather' }, { id: 'uno', type: 'hangup' }, { id: 'otro', type: 'hangup' }],
    [
      { from: 'menu', to: 'uno', when: { '==': [{ var: 'digit' }, '1'] } },
      { from: 'menu', to: 'otro' },
    ],
  );
  assert.deepEqual(check(flow), []);
});

test('un nodo al que no se llega desde start avisa', () => {
  const flow: Flow = { ...sano, nodes: [...sano.nodes, { id: 'suelto', type: 'hangup' }] };
  const [issue] = warnings(flow);
  assert.equal(issue!.where, 'suelto');
  assert.match(issue!.message, /no se llega/);
});

test('un ciclo no cuelga la comprobación de alcanzables', () => {
  const flow = conEntrada(
    'a',
    [{ id: 'a', type: 'say' }, { id: 'b', type: 'say' }],
    [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }],
  );
  assert.deepEqual(warnings(flow), []);
});

test('acumula varios problemas a la vez', () => {
  const flow: Flow = {
    start: 'fantasma',
    nodes: [{ id: 'a', type: 'inventado' }],
    edges: [{ from: 'a', to: 'tampoco' }],
  };
  assert.equal(errors(flow).length, 4, 'tipo, start, destino y entrada que falta');
});

test('el flujo real del repo está sano', async () => {
  const { readFile } = await import('node:fs/promises');
  const flow = JSON.parse(
    await readFile(new URL('../flow.json', import.meta.url), 'utf8'),
  ) as Flow;
  assert.deepEqual(check(flow), []);
});
