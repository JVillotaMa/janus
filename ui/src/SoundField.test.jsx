/** Tests del campo de audio. Necesitan DOM y un `fetch` de mentira. */

import { test, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SoundField from './SoundField.jsx';
import NodeForm from './NodeForm.jsx';

/** Lo que respondería el motor. `subida` puede ser un fallo. */
function fakeFetch({ lista = [], subida = null, fallo = null } = {}) {
  const llamadas = [];
  globalThis.fetch = async (url, options = {}) => {
    llamadas.push({ url, method: options.method ?? 'GET', body: options.body });
    if (url === '/api/sounds') return { ok: true, json: async () => lista };
    if (fallo) {
      return { ok: false, json: async () => ({ ok: false, issues: [{ message: fallo }] }) };
    }
    return { ok: true, json: async () => ({ ok: true, ...subida }) };
  };
  return llamadas;
}

const file = (name) => new File(['audio'], name, { type: 'audio/mpeg' });

let originalFetch;
beforeEach(() => { originalFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

test('el audio se puede seguir escribiendo a mano', async () => {
  fakeFetch();
  const cambios = [];
  render(<SoundField value="sound:hello-world" onChange={(v) => cambios.push(v)} />);

  const texto = screen.getByDisplayValue('sound:hello-world');
  fireEvent.change(texto, { target: { value: 'sound:vm-goodbye' } });
  assert.deepEqual(cambios, ['sound:vm-goodbye'], 'los de serie siguen funcionando');
});

test('elegir un fichero lo sube y deja el campo apuntando al audio', async () => {
  const llamadas = fakeFetch({
    subida: { name: 'bienvenida', media: 'sound:janus/bienvenida', seconds: 2.5 },
  });
  const cambios = [];
  render(<SoundField value="" onChange={(v) => cambios.push(v)} />);

  fireEvent.change(screen.getByLabelText('subir un audio'), {
    target: { files: [file('Bienvenida.mp3')] },
  });

  await waitFor(() => assert.deepEqual(cambios, ['sound:janus/bienvenida']));
  const subida = llamadas.find((l) => l.method === 'PUT');
  assert.equal(subida.url, '/api/sounds/Bienvenida.mp3');
  assert.ok(subida.body instanceof File, 'el fichero va en el cuerpo crudo, sin multipart');
});

test('el nombre saneado lo decide el motor, no el navegador', async () => {
  fakeFetch({ subida: { name: 'ano-nuevo', media: 'sound:janus/ano-nuevo', seconds: 1 } });
  const cambios = [];
  render(<SoundField value="" onChange={(v) => cambios.push(v)} />);

  fireEvent.change(screen.getByLabelText('subir un audio'), {
    target: { files: [file('Año Nuevo.mp3')] },
  });

  await waitFor(() => assert.deepEqual(cambios, ['sound:janus/ano-nuevo']));
});

test('un error de subida se enseña y el campo no cambia', async () => {
  fakeFetch({ fallo: 'falta ffmpeg en la máquina' });
  const cambios = [];
  render(<SoundField value="sound:hello-world" onChange={(v) => cambios.push(v)} />);

  fireEvent.change(screen.getByLabelText('subir un audio'), {
    target: { files: [file('roto.txt')] },
  });

  await waitFor(() => assert.ok(screen.getByText(/falta ffmpeg/)));
  assert.deepEqual(cambios, [], 'el campo se queda como estaba');
});

test('los audios subidos se pueden elegir de un desplegable', async () => {
  fakeFetch({
    lista: [
      { name: 'bienvenida', media: 'sound:janus/bienvenida', seconds: 2 },
      { name: 'despedida', media: 'sound:janus/despedida', seconds: 1 },
    ],
  });
  const cambios = [];
  render(<SoundField value="" onChange={(v) => cambios.push(v)} />);

  const lista = await screen.findByLabelText('audios subidos');
  fireEvent.change(lista, { target: { value: 'sound:janus/despedida' } });
  assert.deepEqual(cambios, ['sound:janus/despedida']);
});

test('sin audios subidos no se pinta el desplegable vacío', async () => {
  fakeFetch({ lista: [] });
  render(<SoundField value="" onChange={() => {}} />);
  await waitFor(() => assert.equal(screen.queryByLabelText('audios subidos'), null));
});

test('el desplegable NO lista los audios de serie de Asterisk', async () => {
  fakeFetch({ lista: [{ name: 'bienvenida', media: 'sound:janus/bienvenida', seconds: 2 }] });
  render(<SoundField value="sound:hello-world" onChange={() => {}} />);

  const lista = await screen.findByLabelText('audios subidos');
  assert.equal(lista.querySelectorAll('option').length, 2, 'el vacío y el subido, nada más');
});

// ─── Enganchado al formulario del nodo ───────────────────────────────────────

test('el campo de audio de un say usa el control de audio, no un input pelado', async () => {
  fakeFetch();
  render(
    <NodeForm
      node={{ id: 'n-1', data: { type: 'say', config: { media: 'sound:hola' } } }}
      onChange={() => {}}
    />,
  );
  assert.ok(screen.getByLabelText('subir un audio'));
});

test('un campo normal sigue siendo un input pelado', async () => {
  fakeFetch();
  render(
    <NodeForm
      node={{ id: 'n-1', data: { type: 'dial', config: { endpoint: 'PJSIP/ana' } } }}
      onChange={() => {}}
    />,
  );
  assert.equal(screen.queryByLabelText('subir un audio'), null);
  assert.equal(screen.getByLabelText(/A quién llama/).tagName, 'INPUT');
});
