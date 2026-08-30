import { useCallback, useEffect, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

const API = '/api/flow';

/** Condición de una arista, recortada para caber en la etiqueta. */
const shortWhen = (when) => (when ? JSON.stringify(when).slice(0, 36) : '*');

/** flow.json -> lo que entiende React Flow. */
function toGraph(flow) {
  return {
    nodes: flow.nodes.map((node, i) => ({
      id: node.id,
      position: node.position ?? { x: 80, y: i * 100 },
      data: {
        label: `${node.id}  ·  ${node.type}`,
        type: node.type,
        config: node.config ?? {},
      },
    })),
    edges: flow.edges.map((edge, i) => ({
      id: `e${i}`,
      source: edge.from,
      target: edge.to,
      label: shortWhen(edge.when),
      data: { when: edge.when ?? null },
    })),
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

export default function App() {
  const [meta, setMeta] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState('cargando…');

  useEffect(() => {
    fetch(API)
      .then((res) => res.json())
      .then((flow) => {
        const { nodes: n, edges: e } = toGraph(flow);
        setMeta({ start: flow.start, timezone: flow.timezone });
        setNodes(n);
        setEdges(e);
        setStatus(`${n.length} nodos, ${e.length} aristas`);
      })
      .catch((err) => setStatus(`error: ${err.message} — ¿está el motor levantado?`));
  }, []);

  const onNodesChange = useCallback((cs) => setNodes((ns) => applyNodeChanges(cs, ns)), []);
  const onEdgesChange = useCallback((cs) => setEdges((es) => applyEdgeChanges(cs, es)), []);
  const onConnect = useCallback(
    (conn) =>
      setEdges((es) => addEdge({ ...conn, id: `e${Date.now()}`, label: '*', data: { when: null } }, es)),
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
              }
            : n,
        ),
      );
    } else {
      setEdges((es) =>
        es.map((e) =>
          e.id === selected.id
            ? { ...e, data: { when: parsed.when }, label: shortWhen(parsed.when) }
            : e,
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
    setStatus(res.ok ? `aplicado ${new Date().toLocaleTimeString()}` : `error ${res.status}`);
  };

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ flex: 1 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
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
          width: 340,
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

        <small style={{ color: '#666' }}>{status}</small>
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
