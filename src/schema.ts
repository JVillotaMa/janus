/**
 * @fileoverview El vocabulario de los nodos: qué campos tiene cada tipo, en qué
 * unidad, con qué valor por defecto, y qué variables deja en `ctx.vars` al salir.
 *
 * Es la única declaración de ese vocabulario. Lo leen `validate.ts` para
 * comprobar los configs, `nodes.ts` para los valores por defecto y el editor
 * para pintar los formularios y saber qué ofrecer en cada arista. Antes vivía
 * dentro del cuerpo de cada implementación y solo se sabía leyendo el código.
 *
 * Son datos, sin comportamiento y sin importar nada: lo carga también el
 * navegador, así que no puede tocar `node:` ni nada del motor.
 */

export type Scalar = 'string' | 'number';

/** Un campo de configuración de un nodo. */
export interface Field {
  name: string;
  label: string;
  type: Scalar;
  /**
   * Se escribe junto al input. `gather` cuenta en milisegundos y `dial` en
   * segundos: no se unifican, porque cambiar la unidad reinterpretaría los
   * configs de las versiones ya publicadas, que son inmutables.
   */
  unit?: string;
  /** Sin él el nodo falla en una llamada real. Un campo con defecto nunca lo es. */
  required?: boolean;
  /**
   * Campo cuyos valores no los sabe el esquema, así que tiene control propio en
   * el editor: `sound` deja subir un fichero, `trunk` elige de las dadas de alta.
   *
   * Va aquí y no como un `if` por nombre dentro del formulario, porque es una
   * decisión sobre el vocabulario y el vocabulario se declara en un sitio.
   */
  control?: 'sound' | 'trunk' | 'endpoint';
  default?: string | number;
  placeholder?: string;
}

/** Uno de los valores que puede tomar una variable de conjunto cerrado. */
export interface Choice {
  value: string | number | null;
  label: string;
}

/** Una variable de `ctx.vars`, tal y como se compara en las aristas. */
export interface Variable {
  label: string;
  type: Scalar;
  /** Si los tiene, se elige de entre ellos en vez de escribirlo. */
  values?: Choice[];
}

export interface NodeType {
  label: string;
  fields: Field[];
  /** Variables que este tipo deja en `ctx.vars` al salir de él. */
  produces: string[];
}

/**
 * Variables que la llamada tiene desde que entra: las siembran `callVars` y el
 * handler de `StasisStart`. Están disponibles en cualquier arista del grafo.
 */
export const ALWAYS = ['caller', 'did', 'hhmm', 'weekday', 'date'];

const WEEKDAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

export const VARIABLES: Record<string, Variable> = {
  caller: { label: 'Quién llama', type: 'string' },
  did: { label: 'Número marcado', type: 'string' },
  hhmm: { label: 'Hora, como número (19:30 → 1930)', type: 'number' },
  weekday: {
    label: 'Día de la semana',
    type: 'number',
    values: WEEKDAYS.map((label, i) => ({ value: i + 1, label })),
  },
  date: { label: 'Fecha (aaaa-mm-dd)', type: 'string' },
  digit: {
    label: 'Tecla pulsada',
    type: 'string',
    values: [
      ...'0123456789*#'.split('').map((key) => ({ value: key, label: key })),
      { value: null, label: 'no pulsó nada' },
    ],
  },
  dial: {
    label: 'Cómo acabó la llamada',
    type: 'string',
    values: [
      { value: 'answered', label: 'contestaron' },
      { value: 'busy', label: 'comunicaba' },
      { value: 'noanswer', label: 'no contestaron' },
      { value: 'failed', label: 'falló' },
    ],
  },
};

export const NODE_TYPES: Record<string, NodeType> = {
  entry: {
    label: 'Entrada',
    // La troncal se elige de las dadas de alta, nunca se escribe una credencial:
    // el grafo se sirve sin auth y sus versiones son inmutables.
    fields: [
      {
        name: 'trunk',
        label: 'Troncal por la que entra la llamada',
        type: 'string',
        control: 'trunk',
      },
    ],
    produces: [],
  },
  say: {
    label: 'Reproducir',
    fields: [
      {
        name: 'media',
        label: 'Audio',
        type: 'string',
        required: true,
        control: 'sound',
        placeholder: 'sound:hello-world',
      },
    ],
    produces: [],
  },
  gather: {
    label: 'Pedir una tecla',
    fields: [
      {
        name: 'media',
        label: 'Audio antes de escuchar',
        type: 'string',
        control: 'sound',
        placeholder: 'sound:demo-congrats',
      },
      { name: 'timeout', label: 'Cuánto espera', type: 'number', unit: 'ms', default: 5000 },
    ],
    produces: ['digit'],
  },
  dial: {
    label: 'Llamar',
    fields: [
      {
        name: 'endpoint',
        label: 'A quién llama',
        type: 'string',
        required: true,
        control: 'endpoint',
        placeholder: 'PJSIP/ana',
      },
      { name: 'timeout', label: 'Cuánto suena', type: 'number', unit: 'segundos', default: 30 },
    ],
    produces: ['dial'],
  },
  hangup: { label: 'Colgar', fields: [], produces: [] },
};

/**
 * Los valores por defecto de un tipo, como config de un nodo recién creado.
 *
 * Es el mismo dato que aplica el motor al ejecutar y que enseña el formulario al
 * crear, para que no puedan discrepar.
 *
 * @param type Tipo de nodo. Uno desconocido devuelve un objeto vacío.
 */
export function defaults(type: string): Record<string, string | number> {
  return Object.fromEntries(
    (NODE_TYPES[type]?.fields ?? [])
      .filter((field) => field.default !== undefined)
      .map((field) => [field.name, field.default!]),
  );
}
