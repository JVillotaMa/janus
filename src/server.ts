/**
 * @fileoverview API HTTP: el flujo que edita el editor y las llamadas ya hechas.
 *
 * ponytail: cinco rutas con node:http. Cuando haya que servir la UI compilada
 * o pasen de media docena, migrar a Express o Hono son diez líneas.
 */

import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { FlowVersion, Store } from './store.ts';
import type { Trunk,Flow } from './types.ts';
import { renderPjsip } from './pjsip.ts';
import { validate } from './validate.ts';
import type { Issue } from './validate.ts';

/**
 * La API no sale de la máquina.
 *
 * Desde que hay contraseñas SIP en la base, este puerto es una máquina de
 * recolectar credenciales si escucha en `0.0.0.0`. El acceso remoto se hace por
 * túnel SSH, que autentica mejor que nada que se escribiese aquí.
 *
 * ponytail: filtrar por IP de origen en vez de no abrir el socket falla con un
 * proxy delante (todo llega de 127.0.0.1) y con Docker publicando el puerto. El
 * día que la UI se abra sin túnel — varios operadores, o un cliente sin SSH —
 * toca token de verdad, no un filtro.
 */
const HOST = '127.0.0.1';

/**
 * Lee y reemplaza el flujo vivo del motor.
 *
 * Lleva la versión además del grafo: es lo que cada llamada guarda al entrar
 * para que su traza se pinte después sobre el grafo que recorrió.
 */
export interface FlowStore {
  get(): FlowVersion;
  set(flow: FlowVersion): void;
}

/** Lo que la API necesita de Asterisk. Lo ata `main.ts`. */
export interface Provisioner {
  /** Vuelca las troncales a la configuración de Asterisk y recarga. */
  apply(trunks: Trunk[]): Promise<void>;
  /** Estado real de cada troncal, por nombre. */
  states(names: string[]): Promise<Record<string, string>>;
}

/**
 * Levanta la API.
 *
 * Un PUT publica una versión nueva en la base y la pone en caliente: las
 * llamadas en curso conservan la que tenían al entrar.
 */
export function serveApi(flow: FlowStore, store: Store, asterisk: Provisioner, port = 3000) {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const json = (code: number, body: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === '/api/calls' && req.method === 'GET') {
      return void json(200, store.recent(Number(url.searchParams.get('limit')) || 20));
    }

    // Las versiones publicadas: sin `version`, la lista; con él, ese grafo. Una
    // sola ruta para las dos lecturas, que es lo que deja `server.ts` en seis.
    //
    // La versión en vivo no se dice, se deduce: publicar es lo único que la
    // cambia e inserta al final, así que es la primera de la lista.
    if (url.pathname === '/api/flows' && req.method === 'GET') {
      const pedida = url.searchParams.get('version');
      if (pedida === null) return void json(200, store.flowVersions());

      const version = store.flowAt(Number(pedida));
      if (!version) {
        return void json(404, { ok: false, issues: [
          { level: 'error', where: `v${pedida}`, message: 'esa versión no está publicada' },
        ] });
      }
      return void json(200, version.graph);
    }

    // La config generada, para poder verla desde la UI sin entrar por SSH. Las
    // contraseñas se tapan: el fichero de verdad las lleva en claro porque
    // Asterisk las necesita, pero por la API no salen nunca.
    if (url.pathname === '/api/trunks/config' && req.method === 'GET') {
      const tapadas = store.trunks().map((trunk) => ({
        ...trunk,
        password: trunk.password ? '••••••' : null,
      }));
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return void res.end(renderPjsip(tapadas));
    }

    if (url.pathname === '/api/trunks') {
      if (req.method === 'GET') {
        const trunks = store.trunks().map(sinSecreto);
        const states = await asterisk.states(trunks.map((trunk) => trunk.name));
        return void json(200, trunks.map((trunk) => ({ ...trunk, state: states[trunk.name] })));
      }

      if (req.method === 'PUT') {
        let list: Trunk[];
        try {
          list = JSON.parse(await body(req)) as Trunk[];
        } catch (err) {
          return void json(400, { ok: false, issues: [jsonRoto(err as Error)] });
        }

        const issues = validateTrunks(list);
        if (issues.length) {
          console.log(`✗ troncales rechazadas: ${issues.length} errores`);
          return void json(400, { ok: false, issues });
        }

        store.saveTrunks(list);

        // La base es la fuente de verdad y el fichero es derivado, así que se
        // guarda primero. Si la recarga falla, el usuario se entera aquí: dar
        // por bueno un cambio que Asterisk no tiene es el fallo silencioso que
        // este proyecto existe para evitar.
        try {
          await asterisk.apply(store.trunks());
        } catch (err) {
          console.error('✗ Asterisk no recargó:', (err as Error).message);
          return void json(502, { ok: false, issues: [
            { level: 'error', where: 'asterisk',
              message: `guardado, pero Asterisk no recargó: ${(err as Error).message}` },
          ] });
        }

        console.log(`⟳ troncales: ${list.length}, Asterisk recargado`);
        return void json(200, { ok: true, trunks: store.trunks().map(sinSecreto) });
      }

      return void res.writeHead(405).end();
    }

    if (url.pathname !== '/api/flow') return void res.writeHead(404).end();

    // El grafo pelado, como siempre: quién es la versión viva se sabe por
    // `/api/flows`, y así el editor no se entera de este cambio.
    if (req.method === 'GET') return void json(200, flow.get().graph);

    if (req.method === 'PUT') {
      try {
        const nuevo = JSON.parse(await body(req)) as Flow;

        // Los errores no se guardan: un tipo de nodo desconocido reventaría en
        // una llamada real. Los avisos sí, y viajan de vuelta para que se vean.
        const issues = validate(nuevo, store.trunks().map((trunk) => trunk.name));
        if (issues.some((issue) => issue.level === 'error')) {
          console.log(`✗ flujo rechazado: ${issues.filter((i) => i.level === 'error').length} errores`);
          return void json(400, { ok: false, issues });
        }

        const publicado = store.publish(nuevo);
        flow.set(publicado);
        console.log(
          `⟳ flujo v${publicado.version}: ${nuevo.nodes.length} nodos, ${nuevo.edges.length} aristas`,
        );
        return void json(200, { ok: true, version: publicado.version, issues });
      } catch (err) {
        return void json(400, { ok: false, issues: [jsonRoto(err as Error)] });
      }
    }

    res.writeHead(405).end();
  }).listen(port, HOST, () =>
    console.log(`API en http://${HOST}:${port} — flujo, troncales y llamadas`),
  );
}

/** El cuerpo de la petición, como texto. */
async function body(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString();
}

const jsonRoto = (err: Error): Issue => ({ level: 'error', where: 'json', message: err.message });

/** Una troncal tal y como sale por la API: sin contraseña. */
function sinSecreto(trunk: Trunk): Omit<Trunk, 'password'> {
  const { password: _, ...resto } = trunk;
  return resto;
}

/**
 * Comprueba lo que llega por la API antes de guardarlo.
 *
 * Una troncal a medias genera configuración que Asterisk carga sin quejarse y
 * que no registra nunca, así que el fallo tiene que salir aquí.
 */
function validateTrunks(list: Trunk[]): Issue[] {
  if (!Array.isArray(list)) return [{ level: 'error', where: 'trunks', message: 'se esperaba una lista' }];

  const issues: Issue[] = [];
  const vistos = new Set<string>();

  for (const [i, trunk] of list.entries()) {
    const where = trunk?.name || `troncal ${i + 1}`;
    const error = (message: string) => issues.push({ level: 'error', where, message });

    if (!trunk?.name?.trim()) error('falta el nombre');
    else if (vistos.has(trunk.name)) error('hay dos troncales con este nombre');
    vistos.add(trunk?.name);

    if (!trunk?.host?.trim()) error('falta el host del proveedor');

    if (trunk?.mode === 'register') {
      if (!trunk.username?.trim()) error('el modo register necesita usuario');
    } else if (trunk?.mode === 'identify') {
      if (!trunk.matchIp?.trim()) error('el modo identify necesita la IP del proveedor');
    } else {
      error(`modo desconocido "${trunk?.mode}": es register o identify`);
    }
  }

  return issues;
}
