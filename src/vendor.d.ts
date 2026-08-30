// ponytail: ni ari-client ni json-logic-js traen tipos, y sus @types no existen.
// Se declaran como `any` en su frontera; el motor los envuelve con los tipos
// estructurales de types.ts, que es donde interesa tener chequeo de verdad.
declare module 'ari-client';
declare module 'json-logic-js';
