/**
 * Tests del formulario de nodo. Necesitan DOM, así que los corre vitest desde
 * `ui/`; los puros van con `node --test` desde la raíz.
 */

import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NodeForm, { CREATABLE, TypePicker } from './NodeForm.jsx';

// El campo de troncal del nodo de entrada las pide a la API. Aquí no hay motor.
let originalFetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => [] });
});
afterEach(() => { globalThis.fetch = originalFetch; });

/** Un nodo de React Flow como el que le pasa App. */
const node = (type, config = {}, name) => ({ id: 'n-7f3a', data: { type, name, config } });

/** Recoge los parches y los avisos que emite el formulario. */
function mount(nodo) {
  const changes = [];
  const notices = [];
  const view = render(
    <NodeForm node={nodo} onChange={(p) => changes.push(p)} onNotice={(n) => notices.push(n)} />,
  );
  return { ...view, changes, notices };
}

test('cada campo del tipo tiene su control, con su unidad', () => {
  mount(node('gather', { timeout: 5000 }));
  assert.ok(screen.getByLabelText(/Cuánto espera/), 'falta el campo timeout');
  assert.match(screen.getByLabelText(/Cuánto espera/).closest('div').textContent, /\(ms\)/);
  assert.ok(screen.getByLabelText(/Audio antes de escuchar/), 'falta el campo media');
});

test('escribir en un campo numérico guarda un número, no la cadena tecleada', () => {
  const { changes } = mount(node('dial', { endpoint: 'PJSIP/ana', timeout: 30 }));
  fireEvent.change(screen.getByLabelText(/Cuánto suena/), { target: { value: '45' } });
  assert.deepEqual(changes.at(-1), { config: { endpoint: 'PJSIP/ana', timeout: 45 } });
  assert.equal(typeof changes.at(-1).config.timeout, 'number');
});

test('escribir en un campo de texto lo guarda tal cual', () => {
  const { changes } = mount(node('say', { media: 'sound:hola' }));
  fireEvent.change(screen.getByLabelText(/Audio/), { target: { value: 'sound:adios' } });
  assert.deepEqual(changes.at(-1), { config: { media: 'sound:adios' } });
});

test('vaciar un campo lo quita del config en vez de dejarlo vacío', () => {
  const { changes } = mount(node('say', { media: 'sound:hola' }));
  fireEvent.change(screen.getByLabelText(/Audio/), { target: { value: '' } });
  assert.deepEqual(changes.at(-1), { config: {} });
});

test('el nombre se escribe y sale como name, no como config', () => {
  const { changes } = mount(node('say', { media: 'sound:hola' }));
  fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Bienvenida' } });
  assert.deepEqual(changes.at(-1), { name: 'Bienvenida' });
});

test('borrar el nombre lo quita, no lo deja en cadena vacía', () => {
  const { changes } = mount(node('say', { media: 'sound:hola' }, 'Bienvenida'));
  fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: '' } });
  assert.deepEqual(changes.at(-1), { name: undefined });
});

test('el id no aparece por ninguna parte del formulario', () => {
  const { container } = mount(node('say', { media: 'sound:hola' }, 'Bienvenida'));
  assert.equal(container.textContent.includes('n-7f3a'), false);
});

// ─── Cambiar de tipo ─────────────────────────────────────────────────────────

test('cambiar de tipo conserva el campo que coincide y nombra el que descarta', () => {
  const { changes, notices } = mount(node('gather', { media: 'sound:menu', timeout: 5000 }));
  fireEvent.change(screen.getByLabelText('Qué hace'), { target: { value: 'say' } });

  assert.deepEqual(changes.at(-1), { type: 'say', config: { media: 'sound:menu' } });
  assert.match(notices.at(-1), /descartan timeout/);
});

test('el timeout NO sobrevive de gather a dial: no es la misma unidad', () => {
  const { changes, notices } = mount(node('gather', { media: 'sound:menu', timeout: 5000 }));
  fireEvent.change(screen.getByLabelText('Qué hace'), { target: { value: 'dial' } });

  assert.deepEqual(changes.at(-1).config, { timeout: 30 }, 'los 5000 ms no pueden pasar a 5000 s');
  assert.match(notices.at(-1), /descartan media, timeout/);
});

test('sin nada que descartar, el aviso no inventa una pérdida', () => {
  const { notices } = mount(node('hangup'));
  fireEvent.change(screen.getByLabelText('Qué hace'), { target: { value: 'say' } });
  assert.equal(/descartan/.test(notices.at(-1)), false);
});

test('al cambiar de tipo se pintan los campos del tipo nuevo', () => {
  const { rerender } = mount(node('gather', { timeout: 5000 }));
  assert.ok(screen.queryByLabelText(/Cuánto espera/));

  rerender(<NodeForm node={node('dial', { timeout: 30 })} onChange={() => {}} onNotice={() => {}} />);
  assert.equal(screen.queryByLabelText(/Cuánto espera/), null);
  assert.ok(screen.queryByLabelText(/A quién llama/));
});

test('el nombre sobrevive al cambio de tipo: es del nodo, no del tipo', () => {
  const { changes } = mount(node('gather', { timeout: 5000 }, 'Menú'));
  fireEvent.change(screen.getByLabelText('Qué hace'), { target: { value: 'say' } });
  assert.equal('name' in changes.at(-1), false, 'el parche del tipo no toca el nombre');
});

// ─── La entrada es un caso aparte ────────────────────────────────────────────

test('el nodo de entrada no deja cambiar de tipo', () => {
  mount(node('entry', { trunk: 'masmovil' }));
  assert.equal(screen.queryByLabelText('Qué hace'), null);
});

test('el nodo de entrada sí se puede nombrar', () => {
  const { changes } = mount(node('entry', { trunk: 'masmovil' }));
  fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Fijo de la oficina' } });
  assert.deepEqual(changes.at(-1), { name: 'Fijo de la oficina' });
});

// El entry dejó de ser un caso especial: su campo se pinta por el mismo camino
// que los demás, mirando el `control` que declara el esquema.
test('la troncal de la entrada se elige, no se escribe', () => {
  mount(node('entry', { trunk: 'masmovil' }));
  const control = screen.getByLabelText('Troncal por la que entra la llamada');
  assert.equal(control.tagName, 'SELECT', 'un desplegable, no un input de texto');
});

test('la entrada ofrece dar de alta una troncal desde el propio nodo', () => {
  mount(node('entry', {}));
  assert.ok(screen.getByText('+ nueva troncal'));
});

test('elegir troncal escribe en el campo que declara el esquema', () => {
  const { changes } = mount(node('entry', {}));
  fireEvent.change(screen.getByLabelText('Troncal por la que entra la llamada'), {
    target: { value: '' },
  });
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0], { config: {} }, 'sin troncal, la clave se borra');
});

// ─── El selector de creación ─────────────────────────────────────────────────

test('el selector de creación no ofrece la entrada', () => {
  render(<TypePicker onPick={() => {}} onCancel={() => {}} />);
  assert.equal(screen.queryByText('Entrada'), null);
  assert.equal(CREATABLE.some(([type]) => type === 'entry'), false);
});

test('el selector ofrece los cuatro tipos que sí se crean', () => {
  render(<TypePicker onPick={() => {}} onCancel={() => {}} />);
  for (const texto of ['Reproducir', 'Pedir una tecla', 'Llamar', 'Colgar']) {
    assert.ok(screen.getByText(texto), `falta ${texto}`);
  }
});

test('pinchar un tipo lo crea', () => {
  const picked = [];
  render(<TypePicker onPick={(t) => picked.push(t)} onCancel={() => {}} />);
  fireEvent.click(screen.getByText('Llamar'));
  assert.deepEqual(picked, ['dial']);
});

// ─── Un tipo que el motor ya no conoce ───────────────────────────────────────

test('un tipo desconocido se dice, no se pinta un formulario en blanco', () => {
  mount(node('ai_agent', { modelo: 'x' }));
  assert.match(screen.getByText(/no conoce el tipo/).textContent, /ai_agent/);
});

// ─── El transporte de una troncal nueva ──────────────────────────────────────

test('el alta de troncal deja elegir el transporte', async () => {
  const enviados = [];
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'PUT') enviados.push(JSON.parse(options.body));
    return { ok: true, json: async () => (options.method === 'PUT' ? { ok: true } : []) };
  };

  mount(node('entry', {}));
  fireEvent.click(screen.getByText('+ nueva troncal'));

  fireEvent.change(screen.getByLabelText('Nombre de la troncal'), { target: { value: 'eleven' } });
  fireEvent.change(screen.getByLabelText('Host del proveedor'), {
    target: { value: 'sip.rtc.elevenlabs.io:5060' },
  });
  fireEvent.change(screen.getByLabelText('Por qué protocolo habla'), { target: { value: 'tcp' } });
  fireEvent.change(screen.getByLabelText('Cómo te autentica'), { target: { value: 'identify' } });
  fireEvent.change(screen.getByLabelText('IP del proveedor'), { target: { value: '1.2.3.4' } });
  fireEvent.click(screen.getByText('Guardar troncal'));

  await waitFor(() => assert.equal(enviados.length, 1));
  assert.equal(enviados[0].at(-1).transport, 'tcp', 'el transporte viaja en el PUT');
});

test('por defecto se ofrece UDP, que es como se comportaba antes', () => {
  mount(node('entry', {}));
  fireEvent.click(screen.getByText('+ nueva troncal'));
  assert.equal(screen.getByLabelText('Por qué protocolo habla').value, 'udp');
});
