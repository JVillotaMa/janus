/**
 * @fileoverview Tests de la biblioteca de audios. El saneado del nombre no
 * necesita nada; guardar sí necesita ffmpeg, y ese test se salta diciéndolo.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DIR, MAX_BYTES, ensureSounds, listSounds, saveSound, soundName } from '../src/sounds.ts';

// ─── El nombre ───────────────────────────────────────────────────────────────

test('un nombre corriente se queda en lo esencial', () => {
  assert.equal(soundName('Bienvenida.mp3'), 'bienvenida');
  assert.equal(soundName('saludo.wav'), 'saludo');
  assert.equal(soundName('a.b.c.mp3'), 'a-b-c');
});

test('acentos, mayúsculas y espacios se normalizan', () => {
  assert.equal(soundName('Saludo de Año Nuevo.WAV'), 'saludo-de-ano-nuevo');
  assert.equal(soundName('MENÚ Principal.mp3'), 'menu-principal');
});

// Lo importante no es que dé `null` o que dé algo: es que lo que devuelve NO
// puede salir del directorio, porque solo tiene caracteres de la lista blanca.
test('ningún nombre puede escribir fuera del directorio', () => {
  const ataques = [
    '../../etc/passwd',
    '..%2f..%2fetc%2fpasswd',
    '....//....//x.wav',
    '/etc/passwd',
    'C:\\Windows\\x.mp3',
    'x/../../y.wav',
    'a\u0000b.wav',
    '%2e%2e%2fx.wav',
    '..;/x.wav',
  ];
  for (const raw of ataques) {
    const name = soundName(raw);
    if (name === null) continue;
    assert.match(name, /^[a-z0-9_-]+$/, `"${raw}" -> "${name}"`);
  }
});

test('un nombre que no deja nada utilizable se rechaza', () => {
  for (const vacio of ['', '   ', '....', '???', '///', '.mp3', '---']) {
    assert.equal(soundName(vacio), null, JSON.stringify(vacio));
  }
});

test('un porcentaje malformado no revienta, se sanea', () => {
  assert.equal(soundName('100%.wav'), '100');
  assert.equal(soundName('%zz.mp3'), 'zz');
  assert.equal(soundName('%.wav'), null);
});

// ─── Guardar y listar ────────────────────────────────────────────────────────

const hayFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/** Un wav de verdad, generado con ffmpeg, para tener algo que convertir. */
const tono = (dir: string, seconds: number): Buffer => {
  const file = join(dir, 'tono.wav');
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
    '-ar', '44100', '-ac', '2', file,
  ]);
  return readFileSync(file);
};

test('guardar convierte a alaw 8 kHz mono y deja el fichero en su sitio', async (t) => {
  if (!hayFfmpeg) return t.skip('ffmpeg no está instalado en esta máquina');
  const dir = mkdtempSync(join(tmpdir(), 'janus-sounds-'));

  const sound = await saveSound(dir, 'bienvenida', tono(dir, 2));

  assert.equal(sound.name, 'bienvenida');
  assert.equal(sound.media, `sound:${DIR}/bienvenida`);
  // alaw a 8 kHz y un canal son 8000 bytes por segundo, así que dos segundos
  // son 16000. Si sale otra cosa, la conversión no ha hecho lo que decía.
  assert.equal(sound.bytes, 16000);
  assert.equal(sound.seconds, 2);
  assert.deepEqual(readdirSync(join(dir, 'en', DIR)), ['bienvenida.alaw']);
});

test('guardar no toca los audios que ya había al lado', async (t) => {
  if (!hayFfmpeg) return t.skip('ffmpeg no está instalado en esta máquina');
  const dir = mkdtempSync(join(tmpdir(), 'janus-sounds-'));
  mkdirSync(join(dir, 'en'), { recursive: true });
  writeFileSync(join(dir, 'en', 'hello-world.gsm'), 'de serie');

  await saveSound(dir, 'mio', tono(dir, 1));

  assert.equal(statSync(join(dir, 'en', 'hello-world.gsm')).size, 8);
  assert.deepEqual(readdirSync(join(dir, 'en')).sort(), ['hello-world.gsm', DIR].sort());
});

test('subir dos veces el mismo nombre reemplaza, no duplica', async (t) => {
  if (!hayFfmpeg) return t.skip('ffmpeg no está instalado en esta máquina');
  const dir = mkdtempSync(join(tmpdir(), 'janus-sounds-'));

  await saveSound(dir, 'saludo', tono(dir, 2));
  const segundo = await saveSound(dir, 'saludo', tono(dir, 1));

  assert.equal(segundo.bytes, 8000, 'se queda el último');
  assert.equal(readdirSync(join(dir, 'en', DIR)).length, 1);
});

test('un fichero que no es audio se rechaza diciendo por qué', async (t) => {
  if (!hayFfmpeg) return t.skip('ffmpeg no está instalado en esta máquina');
  const dir = mkdtempSync(join(tmpdir(), 'janus-sounds-'));

  await assert.rejects(
    () => saveSound(dir, 'roto', Buffer.from('esto no es un audio')),
    (err: Error) => /no se ha podido convertir/.test(err.message),
  );
  assert.deepEqual(listSounds(dir), [], 'no queda nada a medias');
});

test('listar una base sin audios devuelve una lista vacía, no revienta', () => {
  assert.deepEqual(listSounds(mkdtempSync(join(tmpdir(), 'janus-sounds-'))), []);
  assert.deepEqual(listSounds('/no/existe/este/directorio'), []);
});

test('listar ignora lo que no ha convertido el motor', async (t) => {
  if (!hayFfmpeg) return t.skip('ffmpeg no está instalado en esta máquina');
  const dir = mkdtempSync(join(tmpdir(), 'janus-sounds-'));
  await saveSound(dir, 'mio', tono(dir, 1));
  writeFileSync(join(dir, 'en', DIR, 'basura.txt'), 'x');

  assert.deepEqual(listSounds(dir).map((s) => s.name), ['mio']);
});

test('el límite por fichero es un número, no una idea', () => {
  assert.equal(MAX_BYTES, 10 * 1024 * 1024);
});

test('el directorio se crea al arrancar, sin esperar al primer audio', () => {
  const dir = mkdtempSync(join(tmpdir(), 'janus-sounds-'));

  const destino = ensureSounds(dir);

  assert.equal(destino, join(dir, 'en', DIR));
  assert.deepEqual(readdirSync(destino), [], 'existe y está vacío');
  assert.deepEqual(listSounds(dir), []);
});

test('arrancar dos veces sobre el mismo directorio no falla', () => {
  const dir = mkdtempSync(join(tmpdir(), 'janus-sounds-'));
  ensureSounds(dir);
  assert.doesNotThrow(() => ensureSounds(dir));
});

// Si no se puede crear, tiene que verse. Una biblioteca que parece vacía para
// siempre es indistinguible de "todavía no has subido nada".
test('un directorio que no se puede crear se queja, no se calla', () => {
  const dir = mkdtempSync(join(tmpdir(), 'janus-sounds-'));
  writeFileSync(join(dir, 'en'), 'esto es un fichero, no un directorio');

  assert.throws(() => ensureSounds(dir));
});
