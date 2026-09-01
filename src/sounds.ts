/**
 * @fileoverview Los audios que reproduce el flujo: saneado del nombre,
 * conversión y listado.
 *
 * El motor los deja donde Asterisk los busca, en su propio subdirectorio, y no
 * toca los que ya hubiera. Es el segundo sitio donde escribe, después de
 * `pjsip_janus.conf`.
 */

import { execFile } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Subdirectorio del motor dentro del árbol de sonidos.
 *
 * Separa lo subido de lo que trae Asterisk, igual que `pjsip_janus.conf` separa
 * lo generado de lo escrito a mano. Un audio subido que se llame igual que uno
 * de serie convive con él, porque se referencian distinto.
 */
export const DIR = 'janus';

/**
 * Idioma bajo el que Asterisk busca los audios.
 *
 * ponytail: uno solo, que es donde están los de serie. El día que haga falta,
 * el idioma es un nivel más de directorio y una columna en el flujo.
 */
const LANG = 'en';

/**
 * Formato de destino: alaw a 8 kHz y un canal.
 *
 * Es el códec al que ya van las troncales (`allow=alaw` en `pjsip.ts`), así que
 * se reproduce sin transcodificar, y Asterisk lo lee de fichero con extensión
 * `.alaw`. Un segundo son 8000 bytes exactos, que es de donde sale la duración.
 */
const EXT = '.alaw';
const BYTES_PER_SECOND = 8000;

/** Diez megas. Un aviso de centralita dura segundos; esto son minutos de mp3. */
export const MAX_BYTES = 10 * 1024 * 1024;

export interface Sound {
  name: string;
  /** Lo que se escribe en el campo `media` de un nodo. */
  media: string;
  bytes: number;
  seconds: number;
}

/**
 * Reduce un nombre a los caracteres con los que se puede formar un fichero.
 *
 * Lista de permitidos, nunca de prohibidos: `[a-z0-9_-]` no puede dejar pasar
 * `../`, ni `..%2f`, ni una barra invertida, ni un byte nulo, mientras que una
 * lista de patrones prohibidos siempre se olvida de uno. Esto **es** la defensa
 * contra escribir fuera del directorio, y por eso no hay además un `if` que
 * busque `..`: sería sugerir que el saneado no basta.
 *
 * @param raw El nombre tal y como llega, normalmente el del fichero subido.
 * @returns El nombre saneado, o `null` si no queda nada utilizable.
 */
export function soundName(raw: string): string | null {
  // El nombre viene de un segmento de URL, así que puede traer un `%` suelto o
  // una secuencia inválida: `decodeURIComponent` lanza con eso, y un nombre
  // malformado no puede tumbar la petición. Se usa tal cual y el saneado hace
  // el resto.
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }

  const name = decoded
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\.[^.]*$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return name.length ? name : null;
}

/** Dónde viven los audios del motor dentro del árbol de sonidos. */
const soundsDir = (dir: string) => join(dir, LANG, DIR);

/**
 * Crea el directorio de audios al arrancar, y deja que falle si no puede.
 *
 * Se llama al arrancar y no solo al subir el primero: si el directorio no se
 * puede crear —una ruta mal puesta en `ASTERISK_SOUNDS`, permisos— crearlo tarde
 * hace que el fallo se vea como una biblioteca vacía para siempre, que es
 * indistinguible de "todavía no has subido nada". El motor tiene que decirlo al
 * arrancar, no callarse hasta que alguien intente subir algo.
 *
 * @throws {Error} Si el directorio no se puede crear.
 */
export function ensureSounds(dir: string): string {
  const destino = soundsDir(dir);
  mkdirSync(destino, { recursive: true });
  return destino;
}

/**
 * Guarda un audio, convertido a lo que Asterisk sabe reproducir.
 *
 * Se convierte siempre, aunque el fichero ya viniera bien: mirar la cabecera
 * para decidir añade la rama donde estaría el fallo —creerse que un wav es de 8
 * kHz porque lo dice— y convertir de más cuesta milisegundos.
 *
 * @param dir Raíz del árbol de sonidos de Asterisk.
 * @param name Nombre ya saneado con `soundName`.
 * @param bytes El fichero tal y como llegó.
 * @throws {Error} Si falta ffmpeg o si el fichero no se puede interpretar.
 */
export async function saveSound(dir: string, name: string, bytes: Buffer): Promise<Sound> {
  const destino = soundsDir(dir);
  mkdirSync(destino, { recursive: true });

  const temporal = join(tmpdir(), `janus-${process.pid}-${Date.now()}`);
  writeFileSync(temporal, bytes);
  try {
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', temporal,
      '-ar', String(BYTES_PER_SECOND), '-ac', '1', '-f', 'alaw',
      join(destino, name + EXT),
    ]);
  } catch (err) {
    const { code, stderr } = err as { code?: string; stderr?: string };
    throw new Error(
      code === 'ENOENT'
        ? 'falta ffmpeg en la máquina: sin él no se puede convertir el audio'
        : `no se ha podido convertir el audio: ${(stderr ?? '').trim().split('\n').pop() || 'formato no reconocido'}`,
    );
  } finally {
    rmSync(temporal, { force: true });
  }

  return describeSound(destino, name + EXT);
}

/**
 * Los audios subidos.
 *
 * Solo los del subdirectorio del motor: listar los cien y pico que trae
 * Asterisk sería ruido para encontrar el tuyo, y se siguen escribiendo a mano.
 *
 * @param dir Raíz del árbol de sonidos. Si no existe todavía, la lista va vacía.
 */
export function listSounds(dir: string): Sound[] {
  let files: string[];
  try {
    files = readdirSync(soundsDir(dir));
  } catch {
    return [];
  }
  return files
    .filter((file) => file.endsWith(EXT))
    .map((file) => describeSound(soundsDir(dir), file))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Nombre, tamaño y duración de un fichero ya convertido. */
function describeSound(dir: string, file: string): Sound {
  const name = file.slice(0, -EXT.length);
  const { size } = statSync(join(dir, file));
  return {
    name,
    media: `sound:${DIR}/${name}`,
    bytes: size,
    seconds: Math.round((size / BYTES_PER_SECOND) * 10) / 10,
  };
}
