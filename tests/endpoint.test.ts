/** @fileoverview Tests del destino de una llamada: cómo se lee y cómo se escribe. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { formatEndpoint, parseEndpoint } from '../src/endpoint.ts';

// ─── Lo que sí cabe en el formulario ─────────────────────────────────────────

test('una extensión interna no lleva troncal', () => {
  assert.deepEqual(parseEndpoint('PJSIP/ana'), { resource: 'ana', trunk: null });
});

test('un destino por troncal se parte en sus dos partes', () => {
  assert.deepEqual(parseEndpoint('PJSIP/+1000000000@eleven'), {
    resource: '+1000000000',
    trunk: 'eleven',
  });
});

test('la ida y la vuelta son la identidad para lo que cabe', () => {
  for (const endpoint of [
    'PJSIP/ana',
    'PJSIP/+1000000000@eleven',
    'PJSIP/612345678@masmovil',
    'PJSIP/agente-de-la-clinica@eleven',
    'PJSIP/1234',
  ]) {
    assert.equal(formatEndpoint(parseEndpoint(endpoint)!), endpoint, endpoint);
  }
});

test('escribir sin destino no produce una cadena a medias', () => {
  assert.equal(formatEndpoint({ resource: '', trunk: 'eleven' }), '');
  assert.equal(formatEndpoint({ resource: '   ', trunk: 'eleven' }), '');
  assert.equal(formatEndpoint({ resource: 'ana', trunk: '' }), 'PJSIP/ana');
  assert.equal(formatEndpoint({ resource: 'ana', trunk: null }), 'PJSIP/ana');
});

test('un nodo recién creado, sin destino todavía, se abre vacío y no como "no cabe"', () => {
  for (const vacio of [undefined, null, '', 'PJSIP/']) {
    assert.deepEqual(parseEndpoint(vacio), { resource: '', trunk: null }, JSON.stringify(vacio));
  }
});

// ─── Lo que no cabe lo dice, y no se lo inventa ──────────────────────────────

test('la forma de URI explícita no se representa', () => {
  assert.equal(parseEndpoint('PJSIP/eleven/sip:+1000000000@sip.rtc.elevenlabs.io:5060'), null);
});

test('una tecnología que no es PJSIP no se representa', () => {
  assert.equal(parseEndpoint('Local/1@from-internal'), null);
  assert.equal(parseEndpoint('SIP/ana'), null, 'chan_sip está muerto desde Asterisk 21');
});

// El typo que se publicó de verdad esta tarde. Antes se veía igual que un
// destino bueno; ahora el formulario dice que no lo entiende.
test('un typo en la tecnología no se representa', () => {
  assert.equal(parseEndpoint('JSIP/ana'), null);
});

test('algo sin barra no se representa', () => {
  assert.equal(parseEndpoint('ana'), null);
  assert.equal(parseEndpoint('+1000000000@eleven'), null);
});

// El error real: 'endpoint sip.rtc.elevenlabs.io:5060 was not found'. Se lee
// como troncal porque eso ES lo que Asterisk hace con ello, y por eso el aviso
// de validate lo caza en vez de dejarlo fallar en la llamada.
test('un dominio puesto donde va la troncal se lee como troncal', () => {
  assert.deepEqual(parseEndpoint('PJSIP/+1000000000@sip.rtc.elevenlabs.io:5060'), {
    resource: '+1000000000',
    trunk: 'sip.rtc.elevenlabs.io:5060',
  });
});

test('con varias arrobas manda la última, para leer entera la troncal', () => {
  assert.deepEqual(parseEndpoint('PJSIP/a@b@eleven'), { resource: 'a@b', trunk: 'eleven' });
});

// ─── Contra el flujo real del repo ───────────────────────────────────────────

test('los destinos de flow.json se siguen leyendo', async () => {
  const { readFile } = await import('node:fs/promises');
  const flow = JSON.parse(await readFile(new URL('../flow.json', import.meta.url), 'utf8'));

  const dials = flow.nodes.filter((node: { type: string }) => node.type === 'dial');
  assert.ok(dials.length > 0, 'el flujo del repo tiene algún dial que probar');
  for (const node of dials) {
    const destino = parseEndpoint(node.config.endpoint);
    assert.notEqual(destino, null, node.config.endpoint);
    assert.equal(formatEndpoint(destino!), node.config.endpoint);
  }
});
