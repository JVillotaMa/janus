/**
 * @fileoverview Tests de lo que el motor escribe en el directorio de Asterisk.
 * Sobre un directorio temporal: ni laboratorio, ni contenedor, ni red.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeTrunks } from '../src/asterisk.ts';
import type { Trunk } from '../src/types.ts';

const trunk: Trunk = {
  name: 'masmovil',
  host: 'sip.masmovil.es',
  mode: 'register',
  username: 'u1',
  password: 'secreto',
};

const dir = () => mkdtempSync(join(tmpdir(), 'janus-'));
const read = (d: string) => readFileSync(join(d, 'pjsip_janus.conf'), 'utf8');

test('las troncales acaban en el fichero del motor', () => {
  const d = dir();
  writeTrunks(d, [trunk]);

  assert.match(read(d), /\[masmovil\]/);
  assert.match(read(d), /password=secreto/);
});

test('el fichero se reescribe entero: lo que ya no está, desaparece', () => {
  const d = dir();
  writeTrunks(d, [trunk]);
  writeTrunks(d, []);

  assert.doesNotMatch(read(d), /masmovil/);
  assert.match(read(d), /generado por Janus/);
});

test('el fichero con contraseñas no lo lee nadie más', () => {
  const d = dir();
  writeTrunks(d, [trunk]);

  assert.equal(statSync(join(d, 'pjsip_janus.conf')).mode & 0o777, 0o600);
});
