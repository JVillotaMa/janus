/**
 * @fileoverview Tests del generador de configuración. Son funciones puras: ni
 * disco, ni Asterisk, ni dobles.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTEXT, renderPjsip } from '../src/pjsip.ts';
import type { Trunk } from '../src/store.ts';

const register: Trunk = {
  name: 'masmovil',
  host: 'sip.masmovil.es',
  mode: 'register',
  username: 'u123',
  password: 'secreto',
};

const identify: Trunk = {
  name: 'voztele',
  host: 'sip.voztele.com',
  mode: 'identify',
  matchIp: '212.0.0.5',
};

/** Las secciones que declara un texto de pjsip, como `nombre:tipo`. */
function sections(text: string): string[] {
  const found: string[] = [];
  let name = '';
  for (const line of text.split('\n')) {
    const header = line.match(/^\[(.+)\]$/);
    if (header) name = header[1]!;
    const type = line.match(/^type=(.+)$/);
    if (type) found.push(`${name}:${type[1]}`);
  }
  return found;
}

test('una troncal con registro genera auth y registration', () => {
  const conf = renderPjsip([register]);

  assert.deepEqual(sections(conf), [
    'masmovil:endpoint',
    'masmovil:aor',
    'masmovil:auth',
    'masmovil:registration',
  ]);
  assert.match(conf, /username=u123/);
  assert.match(conf, /password=secreto/);
  assert.match(conf, /client_uri=sip:u123@sip\.masmovil\.es/);
});

test('una troncal por IP genera identify y ninguna credencial', () => {
  const conf = renderPjsip([identify]);

  assert.deepEqual(sections(conf), ['voztele:endpoint', 'voztele:aor', 'voztele:identify']);
  assert.match(conf, /match=212\.0\.0\.5/);
  assert.doesNotMatch(conf, /password=/);
  assert.doesNotMatch(conf, /type=auth/);
});

test('todas las troncales entran y apuntan al contexto del motor', () => {
  const conf = renderPjsip([register, identify]);

  assert.equal(conf.match(/type=endpoint/g)?.length, 2);
  assert.equal(conf.match(new RegExp(`context=${CONTEXT}`, 'g'))?.length, 2);
});

test('sin troncales solo queda la cabecera', () => {
  const conf = renderPjsip([]);

  assert.match(conf, /^; generado por Janus/);
  assert.doesNotMatch(conf, /type=/);
});

test('el fichero avisa de que lo reescribe el motor', () => {
  assert.match(renderPjsip([register]), /generado por Janus/);
});

test('el dialplan del repo entrega a Stasis con el número marcado', async () => {
  const { readFile } = await import('node:fs/promises');
  const conf = await readFile(
    new URL('../asterisk-config/etc/extensions.conf', import.meta.url),
    'utf8',
  );
  const context = conf.slice(conf.indexOf(`[${CONTEXT}]`)).split(/\n\[/)[0]!;

  assert.match(context, /exten => _X\.,1,Answer\(\)/);
  assert.match(context, /Stasis\(janus,\$\{EXTEN\}\)/);
  // Tres líneas de dialplan y ni una más: es el invariante.
  assert.equal(context.split('\n').filter((line) => /^\s*(exten|same)/.test(line)).length, 3);
});
