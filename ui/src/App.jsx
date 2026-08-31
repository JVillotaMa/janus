import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import Calls from './Calls.jsx';
import { edgeLabel, isFallback, layout } from './graph.js';

const API = '/api/flow';

/** Un color por tipo de nodo: se distinguen de un vistazo sin leer la etiqueta. */
const TYPE = {
  say: { bg: '#eef4ff', line: '#4a7fd4' },
  gather: { bg: '#fff6e5', line: '#c8892a' },
  dial: { bg: '#eaf6ec', line: '#3d9153' },
  hangup: { bg: '#fdeceb', line: '#c0453d' },
};
const UNKNOWN = { bg: '#f4f4f4', line: '#999' };

const nodeStyle = (type) => {
  const { bg, line } = TYPE[type] ?? UNKNOWN;
  return {
    background: bg,
    border: `1px solid ${line}`,
    borderRadius: 6,
    padding: 8,
    width: 165,
    fontSize: 12,
  };
};

/** flow.json -> lo que entiende React Flow. */
function toGraph(flow) {
  const placed = layout(flow);
  return {
    nodes: flow.nodes.map((node) => ({
      id: node.id,
      position: node.position ?? placed.get(node.id),
      style: nodeStyle(node.type),
      data: {
        label: `${node.id}  ·  ${node.type}`,
        type: node.type,
        config: node.config ?? {},
      },
    })),
    edges: flow.edges.map((edge, i) => {
      // Solo la salida por defecto de una bifurcación va discontinua. Una arista
      // que es la única salida del nodo es una línea fija y no dice nada.
      const fallback = isFallback(edge, flow.edges);
      return {
        id: `e${i}`,
        source: edge.from,
        target: edge.to,
        label: edgeLabel(edge, flow.edges),
        style: fallback ? { strokeDasharray: '5 4', stroke: '#999' } : undefined,
        labelStyle: { fontSize: 11, fill: fallback ? '#999' : '#333' },
        data: { when: edge.when ?? null },
      };
    }),
  };
}

/** React Flow -> flow.json. */
function toFlow(meta, nodes, edges) {
  return {
    ...meta,
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.data.type,
      ...(Object.keys(node.data.config ?? {}).length ? { config: node.data.config } : {}),
      position: node.position,
    })),
    edges: edges.map((edge) => ({
      from: edge.source,
      to: edge.target,
      ...(edge.data?.when ? { when: edge.data.when } : {}),
    })),
  };
}

/**
 * Nodos y aristas por los que pasó una llamada.
 *
 * Los pasos que empiezan por `!` son marcadores del motor (`!dead-end`), no
 * nodos del grafo: no tienen nada que encender.
 */
function traversed(call) {
  if (!call) return { nodes: new Set(), edges: new Set() };
  const path = call.trace.map((step) => step.node).filter((node) => !node.startsWith('!'));
  const edges = new Set();
  for (let i = 0; i < path.length - 1; i++) edges.add(`${path[i]}→${path[i + 1]}`);
  return { nodes: new Set(path), edges };
}

const LIT = '#0969da';

/** Recalcula etiqueta y estilo de todas las aristas: quién es "si no" depende
 *  de cuántas salidas tenga su nodo, así que cambia al añadir o borrar. */
function relabel(edges) {
  const plain = edges.map((e) => ({ from: e.source, to: e.target, when: e.data?.when ?? null }));
  return edges.map((edge, i) => {
    const fallback = isFallback(plain[i], plain);
    return {
      ...edge,
      label: edgeLabel(plain[i], plain),
      style: fallback ? { strokeDasharray: '5 4', stroke: '#999' } : undefined,
      labelStyle: { fontSize: 11, fill: fallback ? '#999' : '#333' },
    };
  });
}

export default function App() {
  const [meta, setMeta] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState('cargando…');
  const [call, setCall] = useState(null);
  const [issues, setIssues] = useState([]);

  useEffect(() => {
    fetch(API)
      .then((res) => res.json())
      .then((flow) => {
        const graph = toGraph(flow);
        setMeta({ start: flow.start, timezone: flow.timezone });
        setNodes(graph.nodes);
        setEdges(graph.edges);
        setStatus(`${graph.nodes.length} nodos, ${graph.edges.length} aristas`);
      })
      .catch((err) => setStatus(`error: ${err.message} — ¿está el motor levantado?`));
  }, []);

  const path = useMemo(() => traversed(call), [call]);

  // El camino recorrido se pinta encima, sin tocar el grafo que se va a guardar.
  const litNodes = useMemo(
    () =>
      nodes.map((node) =>
        path.nodes.has(node.id)
          ? {
              ...node,
              style: {
                ...node.style,
                border: `2px solid ${LIT}`,
                boxShadow: `0 0 0 3px ${LIT}33`,
              },
            }
          : node,
      ),
    [nodes, path],
  );

  const litEdges = useMemo(
    () =>
      edges.map((edge) =>
        path.edges.has(`${edge.source}→${edge.target}`)
          ? { ...edge, animated: true, style: { stroke: LIT, strokeWidth: 2 } }
          : edge,
      ),
    [edges, path],
  );

  const onNodesChange = useCallback((cs) => setNodes((ns) => applyNodeChanges(cs, ns)), []);
  // Borrar una arista puede convertir a su hermana en línea fija, así que se
  // reetiqueta el conjunto entero en cada cambio.
  const onEdgesChange = useCallback(
    (cs) => setEdges((es) => relabel(applyEdgeChanges(cs, es))),
    [],
  );
  const onConnect = useCallback(
    (conn) =>
      setEdges((es) => relabel(addEdge({ ...conn, id: `e${Date.now()}`, data: { when: null } }, es))),
    [],
  );

  const select = (kind, element) => {
    setSelected({ kind, id: element.id });
    setDraft(
      JSON.stringify(
        kind === 'node'
          ? { type: element.data.type, config: element.data.config ?? {} }
          : { when: element.data?.when ?? null },
        null,
        2,
      ),
    );
  };

  /** Vuelca el textarea sobre el elemento seleccionado. */
  const applyDraft = () => {
    let parsed;
    try {
      parsed = JSON.parse(draft);
    } catch (err) {
      setStatus(`JSON inválido: ${err.message}`);
      return;
    }
    if (selected.kind === 'node') {
      setNodes((ns) =>
        ns.map((n) =>
          n.id === selected.id
            ? {
                ...n,
                data: {
                  ...n.data,
                  type: parsed.type,
                  config: parsed.config ?? {},
                  label: `${n.id}  ·  ${parsed.type}`,
                },
                style: nodeStyle(parsed.type),
              }
            : n,
        ),
      );
    } else {
      setEdges((es) =>
        relabel(
          es.map((e) => (e.id === selected.id ? { ...e, data: { when: parsed.when } } : e)),
        ),
      );
    }
    setStatus('elemento actualizado — falta aplicar al motor');
  };

  const addNode = () => {
    const id = `nodo-${nodes.length + 1}`;
    setNodes((ns) => [
      ...ns,
      {
        id,
        position: { x: 400, y: 40 + ns.length * 20 },
        style: nodeStyle('say'),
        data: { label: `${id}  ·  say`, type: 'say', config: { media: 'sound:hello-world' } },
      },
    ]);
  };

  const push = async () => {
    const res = await fetch(API, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(toFlow(meta, nodes, edges)),
    });
    const body = await res.json().catch(() => ({ issues: [] }));
    setIssues(body.issues ?? []);
    setStatus(
      res.ok
        ? `aplicado ${new Date().toLocaleTimeString()}`
        : 'NO se ha guardado: hay errores',
    );
  };

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <Calls selected={call} onSelect={setCall} />

      <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
        {call && (
          <div
            style={{
              position: 'absolute',
              zIndex: 5,
              top: 10,
              left: 10,
              background: '#fff',
              border: `1px solid ${LIT}`,
              borderRadius: 4,
              padding: '6px 10px',
              fontSize: 12,
              display: 'flex',
              gap: 10,
              alignItems: 'center',
            }}
          >
            <span style={{ fontFamily: 'monospace' }}>
              {call.trace.map((step) => step.node).join(' → ')}
            </span>
            <button onClick={() => setCall(null)}>apagar</button>
          </div>
        )}

        <ReactFlow
          nodes={litNodes}
          edges={litEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) => select('node', node)}
          onEdgeClick={(_, edge) => select('edge', edge)}
          fitView
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>

      <aside
        style={{
          width: 320,
          borderLeft: '1px solid #ddd',
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={addNode}>+ nodo</button>
          <button onClick={push} style={{ fontWeight: 600 }}>
            Aplicar al motor
          </button>
        </div>

        <small style={{ color: issues.some((i) => i.level === 'error') ? '#cf222e' : '#666' }}>
          {status}
        </small>

        {issues.length > 0 && (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: 12 }}>
            {issues.map((issue, i) => (
              <li
                key={i}
                style={{
                  padding: '5px 8px',
                  marginBottom: 4,
                  borderRadius: 4,
                  borderLeft: `3px solid ${issue.level === 'error' ? '#cf222e' : '#9a6700'}`,
                  background: issue.level === 'error' ? '#fdeceb' : '#fff8e5',
                }}
              >
                <strong style={{ fontFamily: 'monospace' }}>{issue.where}</strong>
                <br />
                {issue.message}
              </li>
            ))}
          </ul>
        )}

        <small style={{ color: '#666' }}>
          Arrastra de un nodo a otro para crear una arista. Supr borra lo seleccionado.
        </small>

        <hr style={{ width: '100%', border: 0, borderTop: '1px solid #eee' }} />

        {selected ? (
          <>
            <strong>
              {selected.kind === 'node' ? 'Nodo' : 'Arista'} {selected.id}
            </strong>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              style={{ flex: 1, fontFamily: 'monospace', fontSize: 12, padding: 8 }}
            />
            <button onClick={applyDraft}>Guardar en el elemento</button>
          </>
        ) : (
          <small style={{ color: '#999' }}>Pincha un nodo o una arista para editarlo.</small>
        )}
      </aside>
    </div>
  );
}
