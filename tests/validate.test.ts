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

// ─── El config contra el esquema del tipo ────────────────────────────────────

test('falta un campo obligatorio: es error y dice cuál', () => {
  const flow = conEntrada('saluda', [{ id: 'saluda', type: 'say' }], []);
  const [issue] = errors(flow);
  assert.equal(issue!.where, 'saluda');
  assert.match(issue!.message, /media.*obligatorio/);
});

test('un campo vacío cuenta como ausente', () => {
  const flow = conEntrada('saluda', [{ id: 'saluda', type: 'say', config: { media: '' } }], []);
  assert.match(errors(flow)[0]!.message, /obligatorio/);
});

test('un campo con el tipo equivocado es error', () => {
  const flow = conEntrada(
    'llama',
    [{ id: 'llama', type: 'dial', config: { endpoint: 'PJSIP/ana', timeout: '20' } }],
    [],
  );
  assert.match(errors(flow)[0]!.message, /"timeout" tiene que ser un número/);
});

test('un campo opcional ausente no molesta: gather puede no llevar audio', () => {
  const flow = conEntrada('menu', [{ id: 'menu', type: 'gather' }], []);
  assert.deepEqual(errors(flow), []);
});

test('un campo que el tipo no declara es aviso, no error', () => {
  const flow = conEntrada(
    'saluda',
    [{ id: 'saluda', type: 'say', config: { media: 'sound:hola', endpoint: 'PJSIP/ana' } }],
    [],
  );
  assert.deepEqual(errors(flow), []);
  assert.ok(warnings(flow).some((i) => /no usa el campo "endpoint"/.test(i.message)));
});

test('un tipo que el esquema no declara no produce quejas de config', () => {
  const flow = conEntrada('raro', [{ id: 'raro', type: 'inventado', config: { lo: 'que sea' } }], []);
  assert.equal(errors(flow).filter((i) => /campo/.test(i.message)).length, 0);
});

// ─── El nombre es un rótulo, no una clave ────────────────────────────────────

test('dos nodos con el mismo nombre son aviso, no error', () => {
  const flow: Flow = {
    ...sano,
    nodes: [
      { ...entrada, name: 'Recepción' },
      { id: 'saluda', type: 'say', name: 'Recepción', config: { media: 'sound:hola' } },
      { id: 'fin', type: 'hangup' },
    ],
  };
  assert.deepEqual(errors(flow), []);
  assert.equal(warnings(flow).filter((i) => /llamados "Recepción"/.test(i.message)).length, 2);
});

test('nombres distintos no dicen nada', () => {
  const flow: Flow = {
    ...sano,
    nodes: [
      { ...entrada, name: 'Recepción' },
      { id: 'saluda', type: 'say', name: 'Saludo', config: { media: 'sound:hola' } },
      { id: 'fin', type: 'hangup' },
    ],
  };
  assert.deepEqual(check(flow), []);
});

// ─── El esquema y el motor hablan del mismo vocabulario ──────────────────────

test('todo tipo que el motor ejecuta está declarado en el esquema, y al revés', async () => {
  const { NODES } = await import('../src/nodes.ts');
  const { NODE_TYPES } = await import('../src/schema.ts');
  assert.deepEqual(Object.keys(NODE_TYPES).sort(), Object.keys(NODES).sort());
});

test('las variables que dice producir cada tipo existen en el esquema', async () => {
  const { NODE_TYPES, VARIABLES, ALWAYS } = await import('../src/schema.ts');
  for (const [type, spec] of Object.entries(NODE_TYPES)) {
    for (const name of spec.produces) {
      assert.ok(VARIABLES[name], `${type} dice producir "${name}", que no está declarada`);
    }
  }
  for (const name of ALWAYS) assert.ok(VARIABLES[name], `"${name}" no está declarada`);
});

test('un campo con valor por defecto nunca es obligatorio', async () => {
  const { NODE_TYPES } = await import('../src/schema.ts');
  for (const [type, spec] of Object.entries(NODE_TYPES)) {
    for (const field of spec.fields) {
      assert.ok(
        !(field.required && field.default !== undefined),
        `${type}.${field.name} es obligatorio y tiene defecto a la vez`,
      );
    }
  }
});

// ─── El destino de un dial ───────────────────────────────────────────────────

/** Un flujo con un solo nodo que llama. */
const llamando = (endpoint: string): Flow =>
  conEntrada('llama', [{ id: 'llama', type: 'dial', config: { endpoint } }], []);

const sobreTroncal = (flow: Flow, trunks: string[]) =>
  validate(flow, trunks, TYPES).filter((i) => /troncal/.test(i.message));

test('llamar por una troncal que no existe es aviso, no error', () => {
  const issues = sobreTroncal(llamando('PJSIP/+1000000000@eleven'), []);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]!.level, 'warning');
  assert.equal(issues[0]!.where, 'llama');
  assert.match(issues[0]!.message, /"eleven".*no está dada de alta/);
});

test('llamar por una troncal dada de alta no dice nada', () => {
  assert.deepEqual(sobreTroncal(llamando('PJSIP/+1000000000@eleven'), ['eleven']), []);
});

test('llamar a una extensión interna no necesita troncal', () => {
  assert.deepEqual(sobreTroncal(llamando('PJSIP/ana'), []), []);
});

test('un destino que no se sabe leer no inventa un aviso de troncal', () => {
  assert.deepEqual(sobreTroncal(llamando('PJSIP/eleven/sip:x@host'), []), []);
});

// Montar el flujo y dar de alta la troncal después es un orden de trabajo
// válido, así que el aviso no puede bloquear la publicación.
test('el aviso de troncal no impide publicar', () => {
  assert.deepEqual(errors(llamando('PJSIP/+1000000000@eleven')), []);
});

test('el dominio puesto donde va la troncal salta como troncal inexistente', () => {
  const issues = sobreTroncal(llamando('PJSIP/+1000000000@sip.rtc.elevenlabs.io:5060'), ['eleven']);
  assert.match(issues[0]!.message, /sip\.rtc\.elevenlabs\.io:5060/);
});
