/**
 * @fileoverview Genera la configuración PJSIP de las troncales.
 *
 * Son funciones puras: devuelven texto y no tocan disco ni Asterisk. Así el
 * aprovisionamiento se prueba entero sin levantar el laboratorio, que es donde
 * un fallo se manifestaría como "la troncal no registra y no sé por qué".
 *
 * Es el único fichero que escribe el motor, y lo reescribe entero. Todo lo demás
 * de la config de Asterisk está versionado en `asterisk-config/etc/`.
 */

import type { Trunk } from './types.ts';

/**
 * Contexto de dialplan al que apuntan todas las troncales generadas.
 *
 * El contexto en sí no se genera: es constante y vive versionado en
 * `asterisk-config/etc/extensions.conf`, que es donde se puede leer.
 */
export const CONTEXT = 'janus';

const HEADER = '; generado por Janus — no editar a mano, se reescribe entero\n';

/**
 * Traduce las troncales a secciones de PJSIP.
 *
 * ponytail: `alaw` fijo, que es lo que usan las troncales españolas.
 * Transcodificar es lo que desploma la concurrencia, así que si algún proveedor
 * pide otro códec, el arreglo es un campo `codec` por troncal.
 *
 * @param trunks Las troncales guardadas, con su contraseña.
 * @returns El contenido completo de `pjsip_janus.conf`.
 */
export function renderPjsip(trunks: Trunk[]): string {
  return HEADER + trunks.map(section).join('');
}

/** Las secciones de una troncal. Mismo nombre, distinto `type`: sorcery las separa. */
function section(trunk: Trunk): string {
  const { name, host } = trunk;

  const endpoint = [
    `\n[${name}]`,
    'type=endpoint',
    `context=${CONTEXT}`,
    'disallow=all',
    'allow=alaw',
    `aors=${name}`,
    ...(trunk.mode === 'register'
      ? [`outbound_auth=${name}`, ...(trunk.username ? [`from_user=${trunk.username}`] : [])]
      : []),
    '',
    `[${name}]`,
    'type=aor',
    `contact=sip:${host}`,
    '',
  ];

  const auth =
    trunk.mode === 'register'
      ? [
          `[${name}]`,
          'type=auth',
          'auth_type=userpass',
          `username=${trunk.username ?? ''}`,
          `password=${trunk.password ?? ''}`,
          '',
          `[${name}]`,
          'type=registration',
          `outbound_auth=${name}`,
          `server_uri=sip:${host}`,
          `client_uri=sip:${trunk.username ?? ''}@${host}`,
          '',
        ]
      : [
          `[${name}]`,
          'type=identify',
          `endpoint=${name}`,
          `match=${trunk.matchIp ?? ''}`,
          '',
        ];

  return [...endpoint, ...auth].join('\n');
}
