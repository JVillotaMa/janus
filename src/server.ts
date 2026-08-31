/**
 * @fileoverview API HTTP: el flujo que edita el editor y las llamadas ya hechas.
 *
 * ponytail: tres rutas con node:http. Cuando haya que servir la UI compilada o
 * pasen de media docena, migrar a Express o Hono son diez líneas.
 */

import { createServer } from 'node:http';
import type { Store } from './store.ts';
import { validate } from './validate.ts';
import type { Flow } from './types.ts';

/** Lee y reemplaza el flujo vivo del motor. */
export interface FlowStore {
  get(): Flow;
  set(flow: Flow): void;
}

/**
 * Levanta la API.
 *
 * Un PUT publica una versión nueva en la base y la pone en caliente: las
 * llamadas en curso conservan la que tenían al entrar.
 */
export function serveApi(flow: FlowStore, store: Store, port = 3000) {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const json = (code: number, body: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === '/api/calls' && req.method === 'GET') {
      return void json(200, store.recent(Number(url.searchParams.get('limit')) || 20));
    }

    if (url.pathname !== '/api/flow') return void res.writeHead(404).end();

    if (req.method === 'GET') return void json(200, flow.get());

    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      try {
        const nuevo = JSON.parse(Buffer.concat(chunks).toString()) as Flow;

        // Los errores no se guardan: un tipo de nodo desconocido reventaría en
        // una llamada real. Los avisos sí, y viajan de vuelta para que se vean.
        const issues = validate(nuevo);
        if (issues.some((issue) => issue.level === 'error')) {
          console.log(`✗ flujo rechazado: ${issues.filter((i) => i.level === 'error').length} errores`);
          return void json(400, { ok: false, issues });
        }

        const { version } = store.publish(nuevo);
        flow.set(nuevo);
        console.log(`⟳ flujo v${version}: ${nuevo.nodes.length} nodos, ${nuevo.edges.length} aristas`);
        return void json(200, { ok: true, version, issues });
      } catch (err) {
        return void json(400, { ok: false, issues: [
          { level: 'error', where: 'json', message: (err as Error).message },
        ] });
      }
    }

    res.writeHead(405).end();
  }).listen(port, () => console.log(`API en http://localhost:${port}/api/flow y /api/calls`));
}
