/**
 * @fileoverview API HTTP: el flujo que edita el editor y las llamadas ya hechas.
 *
 * ponytail: tres rutas con node:http. Cuando haya que servir la UI compilada o
 * pasen de media docena, migrar a Express o Hono son diez líneas.
 */

import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import type { Store } from './store.ts';
import type { Flow } from './types.ts';

/** Lee y reemplaza el flujo vivo del motor. */
export interface FlowStore {
  get(): Flow;
  set(flow: Flow): void;
}

/**
 * Levanta la API.
 *
 * Un PUT del flujo reescribe el fichero y lo cambia en caliente: las llamadas
 * en curso conservan el que tenían al entrar.
 */
export function serveApi(flow: FlowStore, calls: Store, file: URL, port = 3000) {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const json = (code: number, body: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === '/api/calls' && req.method === 'GET') {
      return void json(200, calls.recent(Number(url.searchParams.get('limit')) || 20));
    }

    if (url.pathname !== '/api/flow') return void res.writeHead(404).end();

    if (req.method === 'GET') return void json(200, flow.get());

    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      try {
        const nuevo = JSON.parse(Buffer.concat(chunks).toString()) as Flow;
        await writeFile(file, `${JSON.stringify(nuevo, null, 2)}\n`);
        flow.set(nuevo);
        console.log(`⟳ flujo actualizado: ${nuevo.nodes.length} nodos, ${nuevo.edges.length} aristas`);
        return void res.writeHead(204).end();
      } catch (err) {
        return void json(400, { error: (err as Error).message });
      }
    }

    res.writeHead(405).end();
  }).listen(port, () => console.log(`API en http://localhost:${port}/api/flow y /api/calls`));
}
