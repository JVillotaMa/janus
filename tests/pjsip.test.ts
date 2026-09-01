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

// ─── El transporte ───────────────────────────────────────────────────────────

const tcp: Trunk = {
  name: 'elevenlabs',
  host: 'sip.rtc.elevenlabs.io:5060',
  mode: 'register',
  transport: 'tcp',
  username: '12025550123',
  password: 'secreto',
};

test('una troncal por TCP lo dice en el endpoint y en la registración', () => {
  const conf = renderPjsip([tcp]);
  assert.equal(conf.match(/^transport=transport-tcp$/gm)?.length, 2, 'endpoint y registración');
});

// En un fichero de Asterisk el `;` abre un comentario: sin la barra, el
// `contact=sip:host;transport=tcp` se lee como `contact=sip:host` y el resto se
// tira EN SILENCIO. Carga bien y usa otro transporte.
test('el punto y coma de las URIs va escapado', () => {
  const conf = renderPjsip([tcp]);
  for (const linea of conf.split('\n').filter((l) => /^(contact|server_uri|client_uri)=/.test(l))) {
    assert.match(linea, /\\;transport=tcp$/, linea);
    assert.equal(/[^\\];/.test(linea), false, `punto y coma sin escapar: ${linea}`);
  }
});

test('el destino de la URI conserva el usuario y el host', () => {
  const conf = renderPjsip([tcp]);
  assert.ok(conf.includes('client_uri=sip:12025550123@sip.rtc.elevenlabs.io:5060\\;transport=tcp'));
  assert.ok(conf.includes('contact=sip:sip.rtc.elevenlabs.io:5060\\;transport=tcp'));
});

test('una troncal por UDP declarado también lo dice', () => {
  assert.ok(renderPjsip([{ ...tcp, transport: 'udp' }]).includes('transport=transport-udp'));
});

// Las troncales dadas de alta antes de que el transporte se pudiera elegir no
// pueden cambiar de comportamiento al regenerar el fichero.
test('sin transporte declarado se genera exactamente lo de antes', () => {
  const sinDeclarar = renderPjsip([{ ...tcp, transport: undefined }]);
  assert.equal(sinDeclarar.includes('transport='), false);
  assert.equal(sinDeclarar.includes('\\;'), false, 'ni rastro del escapado');
  assert.ok(sinDeclarar.includes('contact=sip:sip.rtc.elevenlabs.io:5060\n'));
});

test('el transporte es independiente del modo: identify por TCP vale', () => {
  const conf = renderPjsip([
    { name: 'x', host: 'sip.x.es', mode: 'identify', transport: 'tcp', matchIp: '1.2.3.4' },
  ]);
  assert.ok(conf.includes('transport=transport-tcp'));
  assert.ok(conf.includes('type=identify'));
  assert.equal(conf.includes('type=registration'), false);
});

test('el dialplan del repo define los dos transportes', async () => {
  const { readFile } = await import('node:fs/promises');
  const conf = await readFile(
    new URL('../asterisk-config/etc/pjsip.conf', import.meta.url),
    'utf8',
  );
  for (const seccion of ['[transport-udp]', '[transport-tcp]']) {
    assert.ok(new RegExp(`^\\${seccion.slice(0, -1)}\\]`, 'm').test(conf), `falta ${seccion}`);
  }
});
