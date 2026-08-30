import { useCallback, useEffect, useState } from 'react';

const COLOR = { completed: '#1a7f37', hungup: '#9a6700', error: '#cf222e' };

const seconds = (call) =>
  Math.max(0, Math.round((new Date(call.endedAt) - new Date(call.startedAt)) / 1000));

const clock = (iso) =>
  new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/**
 * Lista de llamadas. Pinchar una la selecciona y el grafo enciende su camino;
 * volver a pincharla lo apaga.
 */
export default function Calls({ selected, onSelect }) {
  const [calls, setCalls] = useState([]);
  const [status, setStatus] = useState('cargando…');

  const load = useCallback(() => {
    fetch('/api/calls?limit=50')
      .then((res) => res.json())
      .then((data) => {
        setCalls(data);
        setStatus(data.length ? `${data.length} llamadas` : 'todavía no hay llamadas');
      })
      .catch((err) => setStatus(`error: ${err.message}`));
  }, []);

  useEffect(load, [load]);

  return (
    <aside
      style={{
        width: 260,
        borderRight: '1px solid #ddd',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 10 }}>
        <strong style={{ fontSize: 13 }}>Llamadas</strong>
        <button onClick={load} style={{ marginLeft: 'auto', fontSize: 12 }}>
          Recargar
        </button>
      </div>
      <small style={{ color: '#666', padding: '0 10px 8px' }}>{status}</small>

      <div style={{ overflowY: 'auto', flex: 1, padding: '0 8px 8px' }}>
        {calls.map((call) => {
          const active = selected?.id === call.id;
          return (
            <button
              key={call.id}
              onClick={() => onSelect(active ? null : call)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                cursor: 'pointer',
                marginBottom: 6,
                padding: 8,
                border: '1px solid #ddd',
                borderLeft: `4px solid ${COLOR[call.outcome] ?? '#888'}`,
                borderRadius: 4,
                background: active ? '#eef4ff' : '#fff',
                font: 'inherit',
                fontSize: 12,
              }}
            >
              <div style={{ display: 'flex', gap: 6 }}>
                <span style={{ color: '#666' }}>{clock(call.startedAt)}</span>
                <span style={{ color: COLOR[call.outcome] ?? '#888', marginLeft: 'auto' }}>
                  {call.outcome}
                </span>
              </div>
              <div>
                <strong>{call.caller ?? '?'}</strong>
                <span style={{ color: '#666' }}> → {call.did ?? '?'} · {seconds(call)}s</span>
              </div>
              <div style={{ color: '#888', fontFamily: 'monospace', fontSize: 11, marginTop: 2 }}>
                {call.trace.length} pasos
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
