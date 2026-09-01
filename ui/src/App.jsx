import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import Calls from './Calls.jsx';
import NodeForm, { TypePicker } from './NodeForm.jsx';
import Trunks from './Trunks.jsx';
import Versions from './Versions.jsx';
import WhenForm from './WhenForm.jsx';
import { edgeLabel, isFallback, layout, newId, nodeLabel } from './graph.js';
import { NODE_TYPES, defaults } from '../../src/schema.ts';

const API = '/api/flow';

/** Un color por tipo de nodo: se distinguen de un vistazo sin leer la etiqueta. */
const TYPE = {
  entry: { bg: '#f3eefc', line: '#8250df' },
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

/**
 * El nodo de entrada. Solo tiene handle de salida, así que React Flow no deja
 * dibujar una arista hacia él: la regla se aplica sola, sin validar nada.
 */
function EntryNode({ data }) {
  return (
    <>
      <div style={{ fontWeight: 600 }}>▼ {data.name ?? 'Entrada'}</div>
      <div style={{ color: '#666', marginTop: 2 }}>
        {data.config?.trunk ?? 'sin troncal'}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </>
  );
}

// Fuera del componente: React Flow avisa si el objeto cambia en cada render.
const nodeTypes = { entry: EntryNode };

/** flow.json -> lo que entiende React Flow. */
function toGraph(flow) {
  const placed = layout(flow);
  return {
    nodes: flow.nodes.map((node) => ({
      id: node.id,
      position: node.position ?? placed.get(node.id),
      ...(node.type === 'entry' ? { type: 'entry' } : {}),
      style: nodeStyle(node.type),
      data: {
        label: nodeLabel(node),
        type: node.type,
        name: node.name,
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
      ...(node.data.name ? { name: node.data.name } : {}),
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
  const [picking, setPicking] = useState(false);
  const [status, setStatus] = useState('cargando…');
  const [call, setCall] = useState(null);
  const [issues, setIssues] = useState([]);
  const [zoomed, setZoomed] = useState(null);
  const [tab, setTab] = useState('calls');

  // Lo que se está mirando en vez de editar: `null` mientras se edita, y
  // `{version, flow}` cuando se mira algo publicado. El borrador (`meta`,
  // `nodes`, `edges`) no se toca en ningún momento, así que al salir vuelve
  // intacto sin necesidad de guardarlo ni de restaurarlo.
  const [viewing, setViewing] = useState(null);
  // Se mueve al publicar, para que la lista de versiones no siga diciendo que
  // la viva es otra.
  const [published, setPublished] = useState(0);

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

  // Lo mínimo del grafo que necesita el constructor de condiciones: de qué tipo
  // es el nodo del que sale cada arista, para saber qué variables ofrecer.
  const plainFlow = useMemo(
    () => ({ nodes: nodes.map((node) => ({ id: node.id, type: node.data.type })) }),
    [nodes],
  );

  /**
   * El rótulo de un paso de la traza.
   *
   * Se resuelve contra el grafo de la versión con la que corrió la llamada, no
   * contra el que se está editando: por eso renombrar un nodo y publicar no
   * reescribe cómo se lee el recorrido de las llamadas de ayer. Sin versión
   * guardada no hay grafo contra el que resolver, y se enseña el id tal cual.
   */
  const stepLabel = (step) => {
    if (step.startsWith('!')) return step;
    const node = viewing?.flow?.nodes.find((n) => n.id === step);
    return node ? nodeLabel(node) : step;
  };

  const viewed = useMemo(() => (viewing ? toGraph(viewing.flow) : null), [viewing]);
  const shownNodes = viewed ? viewed.nodes : nodes;
  const shownEdges = viewed ? viewed.edges : edges;

  // El camino recorrido se pinta encima, sin tocar el grafo que se va a guardar.
  const litNodes = useMemo(
    () =>
      shownNodes.map((node) =>
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
    [shownNodes, path],
  );

  const litEdges = useMemo(
    () =>
      shownEdges.map((edge) =>
        path.edges.has(`${edge.source}→${edge.target}`)
          ? { ...edge, animated: true, style: { stroke: LIT, strokeWidth: 2 } }
          : edge,
      ),
    [shownEdges, path],
  );

  // Mientras se mira una versión publicada, los ids que llegan en los cambios
  // son los del grafo mirado. Aplicarlos al borrador lo corrompería en silencio,
  // así que se ignoran: lo que se mira no se edita.
  const onNodesChange = useCallback(
    (cs) => !viewing && setNodes((ns) => applyNodeChanges(cs, ns)),
    [viewing],
  );
  // Borrar una arista puede convertir a su hermana en línea fija, así que se
  // reetiqueta el conjunto entero en cada cambio.
  const onEdgesChange = useCallback(
    (cs) => !viewing && setEdges((es) => relabel(applyEdgeChanges(cs, es))),
    [viewing],
  );
  const onConnect = useCallback(
    (conn) =>
      !viewing &&
      setEdges((es) => relabel(addEdge({ ...conn, id: `e${Date.now()}`, data: { when: null } }, es))),
    [viewing],
  );

  /** Trae el grafo de una versión publicada. `null` si no se puede leer. */
  const fetchVersion = async (version) => {
    const res = await fetch(`/api/flows?version=${version}`);
    if (!res.ok) {
      setStatus(`no se pudo leer la v${version}`);
      return null;
    }
    return res.json();
  };

  /**
   * Selecciona una llamada: primero trae el grafo de su versión y solo entonces
   * la enciende, para no iluminar ni un frame sobre el grafo equivocado.
   */
  const selectCall = async (llamada) => {
    if (!llamada) {
      setViewing(null);
      setCall(null);
      return;
    }
    // Sin versión guardada no hay grafo que traer: se enciende sobre lo que
    // haya, avisando de que puede no corresponder.
    if (llamada.flowVersion == null) {
      setViewing(null);
      setCall(llamada);
      return;
    }
    const flow = await fetchVersion(llamada.flowVersion);
    if (!flow) return;
    setSelected(null);
    setViewing({ version: llamada.flowVersion, flow });
    setCall(llamada);
  };

  /** Dibuja una versión publicada, en solo lectura y sin encender nada. */
  const viewVersion = async (version) => {
    const flow = await fetchVersion(version);
    if (!flow) return;
    setCall(null);
    setSelected(null);
    setViewing({ version, flow });
  };

  /**
   * Trae una versión publicada al borrador. No publica nada: se edita si hace
   * falta y se aplica con el botón de siempre, que crea versión nueva.
   */
  const loadIntoEditor = async (version) => {
    const flow = await fetchVersion(version);
    if (!flow) return;
    const graph = toGraph(flow);
    setMeta({ start: flow.start, timezone: flow.timezone });
    setNodes(graph.nodes);
    setEdges(graph.edges);
    setViewing(null);
    setCall(null);
    setSelected(null);
    setIssues([]);
    setStatus(`v${version} cargada en el editor — falta aplicar al motor`);
  };

  /** Vuelve al borrador, que no se ha tocado en ningún momento. */
  const stopViewing = () => {
    setViewing(null);
    setCall(null);
  };

  const select = (kind, element) => setSelected({ kind, id: element.id });

  /**
   * Aplica un cambio del formulario al nodo: nombre, tipo o config.
   *
   * El rótulo se recalcula aquí, que es el único sitio donde cambia lo que lo
   * determina; así el lienzo y el panel no pueden decir cosas distintas.
   */
  const patchNode = (id, patch) => {
    setNodes((ns) =>
      ns.map((n) => {
        if (n.id !== id) return n;
        const data = { ...n.data, ...patch };
        return {
          ...n,
          data: { ...data, label: nodeLabel({ id, ...data }) },
          style: nodeStyle(data.type),
        };
      }),
    );
    setStatus('elemento actualizado — falta aplicar al motor');
  };

  /** La condición de una arista, tal y como la construye el formulario. */
  const setEdgeWhen = (id, when) => {
    setEdges((es) =>
      relabel(es.map((e) => (e.id === id ? { ...e, data: { when: when ?? null } } : e))),
    );
    setStatus('elemento actualizado — falta aplicar al motor');
  };

  const addNode = (type) => {
    setPicking(false);
    const id = newId(nodes.map((node) => node.id));
    const config = defaults(type);
    setNodes((ns) => [
      ...ns,
      {
        id,
        position: { x: 400, y: 40 + ns.length * 20 },
        style: nodeStyle(type),
        data: { label: nodeLabel({ id, type, config }), type, config },
      },
    ]);
    setStatus(`${NODE_TYPES[type].label} añadido — falta aplicar al motor`);
  };

  const selectedNode =
    selected?.kind === 'node' ? nodes.find((node) => node.id === selected.id) : null;
  const selectedEdge =
    selected?.kind === 'edge' ? edges.find((edge) => edge.id === selected.id) : null;
  const zoomedNode = zoomed ? nodes.find((node) => node.id === zoomed) : null;

  const push = async () => {
    const res = await fetch(API, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(toFlow(meta, nodes, edges)),
    });
    const body = await res.json().catch(() => ({ issues: [] }));
    setIssues(body.issues ?? []);
    if (res.ok) setPublished((n) => n + 1);
    setStatus(
      res.ok
        ? `v${body.version} aplicada ${new Date().toLocaleTimeString()}`
        : 'NO se ha guardado: hay errores',
    );
  };

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <aside
        style={{
          width: 260,
          borderRight: '1px solid #ddd',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        <div style={{ display: 'flex', borderBottom: '1px solid #ddd' }}>
          {[['calls', 'Llamadas'], ['versions', 'Versiones']].map(([id, texto]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              style={{
                flex: 1,
                padding: '8px 0',
                border: 0,
                cursor: 'pointer',
                font: 'inherit',
                fontSize: 13,
                fontWeight: tab === id ? 600 : 400,
                color: tab === id ? '#0969da' : '#666',
                background: tab === id ? '#fff' : '#f6f8fa',
                borderBottom: `2px solid ${tab === id ? '#0969da' : 'transparent'}`,
              }}
            >
              {texto}
            </button>
          ))}
        </div>

        {tab === 'calls' ? (
          <Calls selected={call} onSelect={selectCall} />
        ) : (
          <Versions
            viewing={viewing}
            refresh={published}
            onView={viewVersion}
            onLoad={loadIntoEditor}
          />
        )}
      </aside>

      <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
        {(call || viewing) && (
          <div
            style={{
              position: 'absolute',
              zIndex: 5,
              top: 10,
              left: 10,
              right: 10,
              background: '#fff',
              border: `1px solid ${viewing ? LIT : '#9a6700'}`,
              borderRadius: 4,
              padding: '6px 10px',
              fontSize: 12,
              display: 'flex',
              gap: 10,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            {viewing && <strong>v{viewing.version}</strong>}
            {call ? (
              <span>{call.trace.map((step) => stepLabel(step.node)).join(' → ')}</span>
            ) : (
              <span style={{ color: '#666' }}>versión publicada · solo lectura</span>
            )}
            {call && !viewing && (
              <span style={{ color: '#9a6700' }}>
                sin versión guardada: este grafo puede no ser el que recorrió
              </span>
            )}
            {viewing && (
              <button
                onClick={() => loadIntoEditor(viewing.version)}
                style={{ marginLeft: 'auto' }}
              >
                cargar en el editor
              </button>
            )}
            <button onClick={stopViewing} style={viewing ? undefined : { marginLeft: 'auto' }}>
              {viewing ? 'volver a mi flujo' : 'apagar'}
            </button>
          </div>
        )}

        <ReactFlow
          nodes={litNodes}
          edges={litEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          nodesDraggable={!viewing}
          nodesConnectable={!viewing}
          elementsSelectable={!viewing}
          deleteKeyCode={viewing ? null : undefined}
          onNodeClick={(_, node) => !viewing && select('node', node)}
          onNodeDoubleClick={(_, node) => {
            if (viewing) return;
            select('node', node);
            if (node.data.type === 'entry') setZoomed(node.id);
          }}
          onEdgeClick={(_, edge) => !viewing && select('edge', edge)}
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
          <button onClick={() => setPicking((v) => !v)} disabled={!!viewing}>+ nodo</button>
          <button onClick={push} disabled={!!viewing} style={{ fontWeight: 600 }}>
            Aplicar al motor
          </button>
        </div>

        {picking && !viewing && <TypePicker onPick={addNode} onCancel={() => setPicking(false)} />}

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

        {viewing ? (
          <small style={{ color: '#666' }}>
            Estás mirando la v{viewing.version}, que ya está publicada y no se puede editar.
            Para partir de ella, cárgala en el editor.
          </small>
        ) : selectedNode ? (
          <NodeForm
            node={selectedNode}
            onChange={(patch) => patchNode(selectedNode.id, patch)}
            onNotice={setStatus}
          />
        ) : selectedEdge ? (
          <WhenForm
            flow={plainFlow}
            edge={selectedEdge}
            onChange={(when) => setEdgeWhen(selectedEdge.id, when)}
          />
        ) : (
          <small style={{ color: '#999' }}>Pincha un nodo o una arista para editarlo.</small>
        )}
      </aside>

      {zoomedNode && (
        <div
          onClick={() => setZoomed(null)}
          style={{
            position: 'fixed', inset: 0, background: '#0006', zIndex: 20,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 8, padding: 20, width: 560,
              maxHeight: '85vh', overflow: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <strong>Entrada · {nodeLabel({ ...zoomedNode.data, id: zoomedNode.id })}</strong>
              <button onClick={() => setZoomed(null)}>cerrar</button>
            </div>
            <Trunks
              config={zoomedNode.data.config ?? {}}
              onChange={(config) => patchNode(zoomedNode.id, { config })}
              wide
            />
          </div>
        </div>
      )}
    </div>
  );
}
