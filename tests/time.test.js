/**
 * @fileoverview Tests de las variables de calendario. Todo con instantes fijos:
 * nunca se consulta el reloj.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { callVars } from '../engine.js';

const at = (iso, tz) => callVars(new Date(iso), tz);

test('el mismo instante UTC da hora distinta según el horario de verano', () => {
  assert.equal(at('2026-01-15T18:30:00Z', 'Europe/Madrid').hhmm, 1930, 'invierno, +1');
  assert.equal(at('2026-07-15T18:30:00Z', 'Europe/Madrid').hhmm, 2030, 'verano, +2');
});

test('un offset fijo se habría equivocado: por eso la zona es IANA', () => {
  const invierno = at('2026-01-15T18:30:00Z', 'Europe/Madrid').hhmm;
  const verano = at('2026-07-15T18:30:00Z', 'Europe/Madrid').hhmm;
  assert.notEqual(invierno, verano);
});

test('la medianoche local da hhmm 0 y rueda la fecha', () => {
  const medianoche = at('2026-01-15T23:00:00Z', 'Europe/Madrid');
  assert.equal(medianoche.hhmm, 0);
  assert.equal(medianoche.date, '2026-01-16', 'ya es el día siguiente en Madrid');
});

test('las 23:59 locales dan 2359', () => {
  assert.equal(at('2026-01-15T22:59:00Z', 'Europe/Madrid').hhmm, 2359);
});

test('weekday es ISO: 1 lunes … 7 domingo', () => {
  const dias = {
    '2026-08-31': 1, '2026-09-01': 2, '2026-09-02': 3, '2026-09-03': 4,
    '2026-09-04': 5, '2026-09-05': 6, '2026-09-06': 7,
  };
  for (const [fecha, esperado] of Object.entries(dias)) {
    const vars = at(`${fecha}T12:00:00Z`, 'Europe/Madrid');
    assert.equal(vars.weekday, esperado, fecha);
    assert.equal(vars.date, fecha);
  }
});

test('el weekday es el del día local, no el del día UTC', () => {
  // 23:30Z del domingo ya es lunes en Madrid.
  const vars = at('2026-09-06T23:30:00Z', 'Europe/Madrid');
  assert.equal(vars.date, '2026-09-07');
  assert.equal(vars.weekday, 1, 'lunes en Madrid, aunque en UTC siga siendo domingo');
});

test('otra zona horaria da otra hora para el mismo instante', () => {
  const instante = '2026-01-15T18:30:00Z';
  assert.equal(at(instante, 'Europe/Madrid').hhmm, 1930);
  assert.equal(at(instante, 'America/Argentina/Buenos_Aires').hhmm, 1530);
  assert.equal(at(instante, 'UTC').hhmm, 1830);
});

test('aguanta zonas con offset de media hora', () => {
  assert.equal(at('2026-01-15T18:30:00Z', 'Asia/Kolkata').hhmm, 0);
  assert.equal(at('2026-01-15T18:30:00Z', 'Asia/Kolkata').date, '2026-01-16');
});

test('el día del cambio de hora no rompe nada', () => {
  // 2026-03-29: Madrid salta de 02:00 a 03:00.
  assert.equal(at('2026-03-29T00:30:00Z', 'Europe/Madrid').hhmm, 130, 'antes del salto');
  assert.equal(at('2026-03-29T01:30:00Z', 'Europe/Madrid').hhmm, 330, 'después del salto');
});
