/**
 * @fileoverview El primitivo de cancelación.
 *
 * El cuelgue llega en cualquier momento y tiene que ganar siempre. `cancelable`
 * es el único punto del motor donde se espera algo, así que la cancelación se
 * maneja una vez y ningún nodo tiene que acordarse. Un `await` crudo dentro de
 * un nodo reintroduce el bug de las llamadas zombi.
 */

/** Error con el que se rechaza cualquier espera cuando el canal cuelga. */
export class Hungup extends Error {
  constructor() {
    super('el canal colgó');
    this.name = 'Hungup';
  }
}

/**
 * Deshace una suscripción.
 */
export type Unsubscribe = () => void;

/**
 * Espera a un evento, salvo que el canal cuelgue antes.
 *
 * @param signal Señal que se dispara al colgar.
 * @param subscribe Recibe `done(valor)` y devuelve cómo deshacer la suscripción.
 * @throws {Hungup} Si el canal cuelga antes de que `done` se llame.
 */
export function cancelable<T>(
  signal: AbortSignal,
  subscribe: (done: (value: T) => void) => Unsubscribe,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(new Hungup());

    let unsubscribe: Unsubscribe | null = null;
    let settled = false;

    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      unsubscribe?.();
      signal.removeEventListener('abort', onHangup);
      finish();
    };
    const onHangup = () => settle(() => reject(new Hungup()));

    signal.addEventListener('abort', onHangup, { once: true });
    unsubscribe = subscribe((value) => settle(() => resolve(value)));
    if (settled) unsubscribe?.();
  });
}
