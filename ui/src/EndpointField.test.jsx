/** Tests del destino de un nodo que llama. Necesitan DOM: los corre vitest. */

import { useState } from 'react';
import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EndpointField from './EndpointField.jsx';
import NodeForm from './NodeForm.jsx';

const TRONCALES = [
  { name: 'eleven', host: 'sip.rtc.elevenlabs.io:5060', mode: 'identify', state: 'online' },
  { name: 'masmovil', host: 'sip.masmovil.es', mode: 'register', state: 'online' },
];

let originalFetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) =>
    url === '/api/trunks'
      ? { ok: true, json: async () => TRONCALES }
      : { ok: true, json: async () => [] };
});
afterEach(() => { globalThis.fetch = originalFetch; });

/**
 * El campo es controlado, así que para encadenar ediciones hace falta que
 * alguien le devuelva el valor nuevo. Esto es lo que hace `NodeForm`.
 */
function Harness({ initial, onEmit }) {
  const [value, setValue] = useState(initial);
  return <EndpointField value={value} onChange={(v) => { setValue(v); onEmit(v); }} />;
}

/** Monta el campo y recoge las cadenas que emite. */
function mount(value) {
  const emitidos = [];
  const view = render(<Harness initial={value} onEmit={(v) => emitidos.push(v)} />);
  return { ...view, emitidos };
}

test('un destino interno abre en "extensión interna"', () => {
  mount('PJSIP/ana');
  assert.equal(screen.getByLabelText(/extensión interna/).checked, true);
  assert.equal(screen.getByLabelText('qué extensión').value, 'ana');
});

test('un destino por troncal abre con su troncal elegida', async () => {
  mount('PJSIP/+1000000000@eleven');
  assert.equal(screen.getByLabelText(/por una troncal/).checked, true);
  assert.equal(screen.getByLabelText('a qué número').value, '+1000000000');
  await waitFor(() => assert.equal(screen.getByLabelText('Por la troncal').value, 'eleven'));
});

test('una extensión interna no mete arroba', () => {
  const { emitidos } = mount('PJSIP/ana');
  fireEvent.change(screen.getByLabelText('qué extensión'), { target: { value: 'jaime' } });
  assert.deepEqual(emitidos, ['PJSIP/jaime']);
});

test('elegir troncal y destino compone la cadena entera', async () => {
  const { emitidos } = mount('PJSIP/+1000000000@eleven');
  await waitFor(() => screen.getByLabelText('Por la troncal'));

  fireEvent.change(screen.getByLabelText('Por la troncal'), { target: { value: 'masmovil' } });
  assert.deepEqual(emitidos.at(-1), 'PJSIP/+1000000000@masmovil');

  fireEvent.change(screen.getByLabelText('a qué número'), { target: { value: '612345678' } });
  assert.deepEqual(emitidos.at(-1), 'PJSIP/612345678@masmovil');
});

test('el PJSIP/ no lo teclea nadie', () => {
  const { emitidos } = mount('PJSIP/ana');
  fireEvent.change(screen.getByLabelText('qué extensión'), { target: { value: 'x' } });
  assert.ok(emitidos.at(-1).startsWith('PJSIP/'), emitidos.at(-1));
});

// El fallo que costó la tarde: eliges "por una troncal", escribes el número, y
// hasta que no eliges troncal lo guardado es `PJSIP/x`. Si el modo se leyera del
// valor, el botón se volvería solo a "interna" antes de poder terminar.
test('elegir "por una troncal" no se deshace solo mientras eliges cuál', async () => {
  mount('PJSIP/ana');

  fireEvent.click(screen.getByLabelText(/por una troncal/));

  assert.equal(screen.getByLabelText(/por una troncal/).checked, true, 'sigue en "por troncal"');
  await waitFor(() => assert.ok(screen.getByLabelText('Por la troncal')));
});

test('volver a interna quita la troncal del destino', async () => {
  const { emitidos } = mount('PJSIP/+1000000000@eleven');
  fireEvent.click(screen.getByLabelText(/extensión interna/));
  assert.equal(emitidos.at(-1), 'PJSIP/+1000000000');
});

// ─── Lo que no cabe se escribe, y no se deforma ──────────────────────────────

test('un destino que no encaja se edita como texto, con su aviso', () => {
  const { container } = mount('PJSIP/eleven/sip:x@sip.rtc.elevenlabs.io:5060');

  assert.ok(screen.getByText(/no encaja en el formulario/));
  assert.equal(screen.queryByLabelText(/por una troncal/), null);
  assert.equal(container.querySelector('input').value, 'PJSIP/eleven/sip:x@sip.rtc.elevenlabs.io:5060');
});

test('el typo de la tecnología se puede arreglar escribiendo', () => {
  const { emitidos } = mount('JSIP/ana');
  assert.ok(screen.getByText(/no encaja en el formulario/), 'JSIP/ana no lo entiende, y lo dice');

  fireEvent.change(screen.getByDisplayValue('JSIP/ana'), { target: { value: 'PJSIP/ana' } });
  assert.deepEqual(emitidos, ['PJSIP/ana']);
});

test('un nodo dial recién creado abre vacío, no como "no cabe"', () => {
  mount(undefined);
  assert.equal(screen.queryByText(/no encaja/), null);
  assert.equal(screen.getByLabelText('qué extensión').value, '');
});

// ─── Enganchado al formulario del nodo ───────────────────────────────────────

test('el campo de destino de un dial usa este control, no un input pelado', () => {
  render(
    <NodeForm
      node={{ id: 'n-1', data: { type: 'dial', config: { endpoint: 'PJSIP/ana' } } }}
      onChange={() => {}}
    />,
  );
  assert.ok(screen.getByLabelText(/por una troncal/));
});

// Los controles con estado propio no pueden arrastrarse de un nodo a otro: si
// el modo sobreviviera, abrir un dial interno después de uno por troncal lo
// enseñaría en el modo del anterior.
test('cambiar de nodo resiembra el modo del destino', async () => {
  const porTroncal = { id: 'n-1', data: { type: 'dial', config: { endpoint: 'PJSIP/1@eleven' } } };
  const interno = { id: 'n-2', data: { type: 'dial', config: { endpoint: 'PJSIP/ana' } } };

  const { rerender } = render(<NodeForm node={porTroncal} onChange={() => {}} />);
  assert.equal(screen.getByLabelText(/por una troncal/).checked, true);

  rerender(<NodeForm node={interno} onChange={() => {}} />);
  assert.equal(screen.getByLabelText(/extensión interna/).checked, true);
});
