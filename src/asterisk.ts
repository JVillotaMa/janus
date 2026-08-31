/**
 * @fileoverview Lo que el motor le hace a Asterisk fuera de una llamada:
 * escribir las troncales, recargar y preguntar por el estado de un endpoint.
 *
 * El texto lo produce `pjsip.ts`, que es puro. Aquí está lo que toca disco y
 * red, que es lo que no se puede probar sin laboratorio.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderPjsip } from './pjsip.ts';
import type { AriAdmin, Trunk } from './types.ts';

/**
 * El único fichero que escribe el motor. El resto de la config de Asterisk está
 * versionada en el repo, incluida la línea `#include` que carga este fichero y
 * el contexto de dialplan al que apuntan las troncales.
 *
 * Va fuera de git: es el único que lleva contraseñas de proveedor.
 */
const GENERATED = 'pjsip_janus.conf';

/**
 * Solo el dueño del fichero: lleva contraseñas SIP en claro.
 *
 * ponytail: en el laboratorio Asterisk corre como root y lo lee igual. Si algún
 * día corre como usuario `asterisk`, el fichero necesita un grupo compartido y
 * esto pasa a 0o640.
 */
const MODE = 0o600;

/** Vuelca las troncales a la configuración de PJSIP. */
export function writeTrunks(dir: string, trunks: Trunk[]): void {
  writeFileSync(join(dir, GENERATED), renderPjsip(trunks), { mode: MODE });
}

/**
 * Recarga un módulo de Asterisk.
 *
 * ARI expone la recarga desde Asterisk 13, así que no hace falta AMI ni shell:
 * va por el mismo cliente que ya está conectado. `res_pjsip` no corta las
 * llamadas en curso, a diferencia de un `reload` global.
 *
 * @throws {Error} Si Asterisk no puede recargar.
 */
export async function reload(client: AriAdmin, moduleName: string): Promise<void> {
  await client.asterisk.reloadModule({ moduleName });
}

/**
 * Estado real de cada troncal según Asterisk.
 *
 * Lo que el motor cree que hay configurado y lo que Asterisk tiene cargado
 * pueden divergir, y sin esto la divergencia es silenciosa.
 *
 * @returns Por nombre: el estado de Asterisk, `unknown` si no conoce el
 *     endpoint, o `unreachable` si Asterisk no contesta.
 */
export async function endpointStates(
  client: AriAdmin,
  names: string[],
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    names.map(async (name) => {
      try {
        const endpoint = await client.endpoints.get({ tech: 'PJSIP', resource: name });
        return [name, endpoint.state ?? 'unknown'] as const;
      } catch (err) {
        return [name, (err as { message?: string }).message?.includes('not found')
          ? 'unknown'
          : 'unreachable'] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}
