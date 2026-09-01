/** Tests del constructor de condiciones. Necesitan DOM: los corre vitest. */

import { useState } from 'react';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { render, screen, fireEvent, within } from '@testing-library/react';
import WhenForm from './WhenForm.jsx';

const flow = {
  nodes: [
    { id: 'e', type: 'entry' },
    { id: 'm', type: 'gather' },
    { id: 'd', type: 'dial' },
  ],
};

/**
 * El formulario es controlado, así que para encadenar clicks hace falta que
 * alguien le devuelva el `when` nuevo. Esto es lo que hace App.
 */
function Harness({ initial = null, source = 'm', onWhen = () => {} }) {
  const [when, setWhen] = useState(initial);
  return (
    <WhenForm
      flow={flow}
      edge={{ id: 'e0', source, target: 'd', data: { when } }}
      onChange={(next) => { setWhen(next ?? null); onWhen(next); }}
    />
  );
}

const mount = (props = {}) => {
  const emitted = [];
  const view = render(<Harness {...props} onWhen={(w) => emitted.push(w)} />);
  return { ...view, emitted };
};

test('una arista sin condición empieza en "siempre"', () => {
  mount();
  assert.equal(screen.getByLabelText(/siempre/).checked, true);
  assert.equal(screen.getByLabelText(/solo si/).checked, false);
});

test('pasar a "solo si" siembra una condición', () => {
  const { emitted } = mount();
  fireEvent.click(screen.getByLabelText(/solo si/));
  assert.notEqual(emitted.at(-1), undefined);
  assert.equal(Object.keys(emitted.at(-1)).length, 1);
});

test('volver a "siempre" quita la condición', () => {
  const { emitted } = mount({ initial: { '==': [{ var: 'digit' }, '1'] } });
  fireEvent.click(screen.getByLabelText(/siempre/));
  assert.equal(emitted.at(-1), undefined);
});

test('cambiar el valor de una comparación la reescribe', () => {
  const { emitted } = mount({ initial: { '==': [{ var: 'digit' }, '1'] } });
  fireEvent.change(screen.getByLabelText('valor'), { target: { value: '2' } });
  assert.deepEqual(emitted.at(-1), { '==': [{ var: 'digit' }, '2'] });
});

test('una variable de valores cerrados se elige de un desplegable', () => {
  mount({ initial: { '==': [{ var: 'digit' }, '1'] } });
  const valor = screen.getByLabelText('valor');
  assert.equal(valor.tagName, 'SELECT');
  assert.ok(within(valor).getByText('no pulsó nada'), 'digit puede no pulsarse');
});

test('una variable abierta se escribe', () => {
  mount({ initial: { '==': [{ var: 'caller' }, '600'] } });
  assert.equal(screen.getByLabelText('valor').tagName, 'INPUT');
});

test('hhmm sale como número y digit como cadena', () => {
  const { emitted } = mount({ initial: { '>=': [{ var: 'hhmm' }, 900] } });
  fireEvent.change(screen.getByLabelText('valor'), { target: { value: '2100' } });
  assert.deepEqual(emitted.at(-1), { '>=': [{ var: 'hhmm' }, 2100] });
  assert.equal(typeof emitted.at(-1)['>='][1], 'number');
});

test('solo se ofrecen las variables que existen en ese punto del flujo', () => {
  mount({ initial: { '==': [{ var: 'digit' }, '1'] } });
  const variable = screen.getByLabelText('variable');
  assert.ok(within(variable).getByText('digit'), 'sale de un gather: digit existe');
  assert.equal(within(variable).queryByText('dial'), null, 'todavía no ha llamado a nadie');
  assert.ok(within(variable).getByText('hhmm'));
});

test('detrás de la entrada no se ofrece digit', () => {
  mount({ initial: { '==': [{ var: 'caller' }, '600'] }, source: 'e' });
  const variable = screen.getByLabelText('variable');
  assert.equal(within(variable).queryByText('digit'), null);
});

// ─── El árbol ────────────────────────────────────────────────────────────────

test('añadir una condición al grupo la une con la que había', () => {
  const { emitted } = mount({ initial: { '==': [{ var: 'digit' }, '1'] } });
  fireEvent.click(screen.getByText('+ condición'));
  assert.ok('and' in emitted.at(-1), JSON.stringify(emitted.at(-1)));
  assert.equal(emitted.at(-1).and.length, 2);
});

test('un grupo dentro de otro mezcla Y con O', () => {
  const { emitted } = mount({ initial: { '==': [{ var: 'hhmm' }, 900] } });

  fireEvent.click(screen.getByText('+ grupo'));

  // El grupo recién creado trae una condición; hace falta la segunda para que
  // sea un `or` de verdad y deje de colapsarse a su único hijo. El botón se
  // busca dentro del grupo anidado, que es el segundo con selector de unión.
  const anidado = screen.getAllByLabelText('unión')[1].parentElement.parentElement;
  fireEvent.click(within(anidado).getByText('+ condición'));

  const when = emitted.at(-1);
  assert.ok('and' in when, JSON.stringify(when));
  assert.ok('or' in when.and[1], 'emitido: ' + JSON.stringify(when));
  assert.equal(when.and[1].or.length, 2);
});

test('cambiar la unión del grupo cambia el operador', () => {
  const { emitted } = mount({
    initial: { and: [{ '==': [{ var: 'digit' }, '1'] }, { '==': [{ var: 'digit' }, '2'] }] },
  });
  fireEvent.change(screen.getAllByLabelText('unión')[0], { target: { value: 'or' } });
  assert.ok('or' in emitted.at(-1), JSON.stringify(emitted.at(-1)));
});

test('negar el grupo lo envuelve en un !', () => {
  const { emitted } = mount({
    initial: { and: [{ '==': [{ var: 'digit' }, '1'] }, { '==': [{ var: 'hhmm' }, 900] }] },
  });
  fireEvent.click(screen.getAllByLabelText(/^$|no/).find((el) => el.type === 'checkbox'));
  assert.ok('!' in emitted.at(-1), JSON.stringify(emitted.at(-1)));
});

test('quitar una condición la borra del grupo', () => {
  const { emitted } = mount({
    initial: { and: [{ '==': [{ var: 'digit' }, '1'] }, { '==': [{ var: 'hhmm' }, 900] }] },
  });
  fireEvent.click(screen.getAllByLabelText('quitar')[0]);
  assert.deepEqual(emitted.at(-1), { '==': [{ var: 'hhmm' }, 900] }, 'queda una sola, sin envoltorio');
});

// ─── Lo que no cabe se enseña, no se toca ────────────────────────────────────

test('una condición que no cabe se pinta en solo lectura', () => {
  const raro = { '%': [{ var: 'hhmm' }, 2] };
  const { container } = mount({ initial: raro });

  assert.match(screen.getByText(/no cabe en el formulario/).textContent, /no se toca/);
  assert.equal(container.querySelectorAll('select, input').length, 0, 'nada editable');
  assert.match(container.querySelector('pre').textContent, /"%"/);
});

test('comparar dos variables entre sí tampoco cabe, y no se deforma', () => {
  const { container, emitted } = mount({ initial: { '==': [{ var: 'a' }, { var: 'b' }] } });
  assert.ok(screen.getByText(/no cabe en el formulario/));
  assert.deepEqual(emitted, [], 'no emite nada: no se guarda una aproximación');
  assert.match(container.querySelector('pre').textContent, /"var": "b"/);
});
