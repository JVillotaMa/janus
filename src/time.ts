/** @fileoverview Variables de calendario de una llamada. */

/**
 * Deriva las variables de calendario en la zona del negocio.
 *
 * Se calculan una sola vez desde `Ctx.startedAt`, no en cada nodo: una llamada
 * que entra a las 20:59 tiene que seguir el camino de las 20:59 aunque llegue a
 * la rama dos minutos después.
 *
 * @param startedAt Instante de inicio, en UTC.
 * @param timezone Zona IANA. Un offset fijo fallaría medio año.
 * @returns `hhmm` es la hora de pared como entero (19:30 -> 1930), para que los
 *     rangos en jsonlogic sean una comparación. `weekday` es ISO: 1 lunes … 7 domingo.
 */
export function callVars(
  startedAt: Date,
  timezone: string,
): { date: string; hhmm: number; weekday: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    })
      .formatToParts(startedAt)
      .map((part) => [part.type, part.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return {
    date,
    hhmm: Number(parts.hour) * 100 + Number(parts.minute),
    weekday: ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1,
  };
}
