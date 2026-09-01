/**
 * @fileoverview Cómo se escribe el destino de una llamada.
 *
 * La sintaxis de Asterisk tiene una trampa que no se ve mirando el campo:
 *
 *     PJSIP/ana                    el endpoint se llama "ana"
 *     PJSIP/+34600111222@masmovil  llama a ese número POR el endpoint "masmovil"
 *                                                        └─ nombre de sección de
 *                                                           pjsip.conf, NO un dominio
 *
 * Poner un dominio después de la arroba da `endpoint '<dominio>' was not found`.
 * Aquí vive el reparto entre las dos partes, para que el editor pueda pedirlas
 * por separado y `validate` pueda comprobar la troncal.
 */

/** Tecnología fija: `chan_sip` está muerto desde Asterisk 21. */
const TECH = 'PJSIP';

export interface Destination {
  /** A quién se llama: un número, o el nombre de una extensión interna. */
  resource: string;
  /** Por qué troncal sale, o `null` si es una extensión de la propia máquina. */
  trunk: string | null;
}

/**
 * Lee un destino guardado.
 *
 * @param endpoint La cadena tal y como está en el config del nodo.
 * @returns Sus dos partes, o `null` si el formulario no lo representa: la forma
 *     de URI explícita (`PJSIP/eleven/sip:…`), una tecnología que no sea PJSIP, o
 *     algo sin barra. `null` significa "no cabe en el formulario" y **nunca** una
 *     aproximación: reescribir `PJSIP/eleven/sip:x@host` como `PJSIP/eleven`
 *     cambiaría a quién se llama sin decirlo.
 */
export function parseEndpoint(endpoint: string | undefined | null): Destination | null {
  if (!endpoint) return { resource: '', trunk: null };
  if (typeof endpoint !== 'string') return null;

  const barra = endpoint.indexOf('/');
  if (barra === -1) return null;
  if (endpoint.slice(0, barra) !== TECH) return null;

  const resto = endpoint.slice(barra + 1);
  if (resto.includes('/')) return null; // PJSIP/endpoint/sip:… , la forma explícita
  if (resto === '') return { resource: '', trunk: null };

  // Por la última arroba: si llega algo raro, el nombre de troncal se lee entero.
  // Una troncal mal leída falla con "endpoint not found", que no dice cuál era el
  // destino; un recurso mal leído falla en el proveedor, que al menos contesta.
  const arroba = resto.lastIndexOf('@');
  if (arroba === -1) return { resource: resto, trunk: null };
  return { resource: resto.slice(0, arroba), trunk: resto.slice(arroba + 1) || null };
}

/**
 * Escribe un destino.
 *
 * @param destination Las dos partes. Sin `resource` no hay destino que escribir.
 * @returns La cadena para el config del nodo, o `''` si no hay destino.
 */
export function formatEndpoint({ resource, trunk }: Destination): string {
  const quien = (resource ?? '').trim();
  if (!quien) return '';
  const porDonde = (trunk ?? '').trim();
  return porDonde ? `${TECH}/${quien}@${porDonde}` : `${TECH}/${quien}`;
}
