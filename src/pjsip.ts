/**
 * @fileoverview Genera la configuración PJSIP de las troncales.
 *
 * Son funciones puras: devuelven texto y no tocan disco ni Asterisk. Así el
 * aprovisionamiento se prueba entero sin levantar el laboratorio, que es donde
 * un fallo se manifestaría como "la troncal no registra y no sé por qué".
 *
 * `pjsip_janus.conf` se reescribe entero en cada cambio. El resto de la config
 * de Asterisk está versionada en `asterisk-config/etc/` y el motor no la toca;
 * el otro sitio donde sí escribe es el directorio de audios subidos.
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
 * El destino de una troncal, con su parámetro de transporte si lo tiene.
 *
 * **El `;` va escapado.** En un fichero de Asterisk abre un comentario, así que
 * un `sip:host;transport=tcp` sin barra se lee como `sip:host` y el resto se tira
 * en silencio: la configuración carga sin quejarse y usa otro transporte. Es el
 * fallo que carga bien y hace otra cosa, así que lo cubre un test.
 */
const uri = (host: string, trunk: Trunk): string =>
  trunk.transport ? `sip:${host}\\;transport=${trunk.transport}` : `sip:${host}`;

/** La línea que elige el transporte local de salida. Sin declarar, no se emite. */
const transportLine = (trunk: Trunk): string[] =>
  trunk.transport ? [`transport=transport-${trunk.transport}`] : [];

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
    ...transportLine(trunk),
    'disallow=all',
    'allow=alaw',
    `aors=${name}`,
    ...(trunk.mode === 'register'
      ? [`outbound_auth=${name}`, ...(trunk.username ? [`from_user=${trunk.username}`] : [])]
      : []),
    '',
    `[${name}]`,
    'type=aor',
    `contact=${uri(host, trunk)}`,
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
          ...transportLine(trunk),
          `outbound_auth=${name}`,
          `server_uri=${uri(host, trunk)}`,
          `client_uri=${uri(`${trunk.username ?? ''}@${host}`, trunk)}`,
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
