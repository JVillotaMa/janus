/**
 * @fileoverview API del flujo para el editor.
 *
 * ponytail: dos rutas con node:http. Cuando haya que servir la UI compilada o
 * pasen de media docena, migrar a Express o Hono son diez líneas.
 */

import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import type { Flow } from './types.ts';

/** Lee y reemplaza el flujo vivo del motor. */
export interface FlowStore {
  get(): Flow;
  set(flow: Flow): void;
}

/**
 * Levanta la API. Un PUT reescribe el fichero y cambia el flujo en caliente:
 * las llamadas en curso conservan el que tenían al entrar.
 */
export function serveFlow(store: FlowStore, file: URL, port = 3000) {
  return createServer(async (req, res) => {
    if (req.url !== '/api/flow') return void res.writeHead(404).end();

    if (req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return void res.end(JSON.stringify(store.get()));
    }

    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      try {
        const flow = JSON.parse(Buffer.concat(chunks).toString()) as Flow;
        await writeFile(file, `${JSON.stringify(flow, null, 2)}\n`);
        store.set(flow);
        console.log(`⟳ flujo actualizado: ${flow.nodes.length} nodos, ${flow.edges.length} aristas`);
        return void res.writeHead(204).end();
      } catch (err) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return void res.end(JSON.stringify({ error: (err as Error).message }));
      }
    }

    res.writeHead(405).end();
  }).listen(port, () => console.log(`API del flujo en http://localhost:${port}/api/flow`));
}
