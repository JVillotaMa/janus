import { useCallback, useEffect, useState } from 'react';

const stamp = (iso) =>
  new Date(iso).toLocaleString('es-ES', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * Las versiones publicadas del flujo.
 *
 * La que está en vivo no la dice la API: es la más reciente, porque publicar es
 * lo único que la cambia e inserta al final. Por eso es la primera de la lista.
 *
 * `refresh` cambia cuando se publica, para que la lista no siga diciendo que la
 * viva es otra.
 */
export default function Versions({ viewing, refresh, onView, onLoad }) {
  const [versions, setVersions] = useState([]);
  const [status, setStatus] = useState('cargando…');

  const load = useCallback(() => {
    fetch('/api/flows')
      .then((res) => res.json())
      .then((data) => {
        setVersions(data);
        setStatus(data.length ? `${data.length} versiones` : 'todavía no hay ninguna');
      })
      .catch((err) => setStatus(`error: ${err.message}`));
  }, []);

  useEffect(load, [load, refresh]);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 10 }}>
        <small style={{ color: '#666' }}>{status}</small>
        <button onClick={load} style={{ marginLeft: 'auto', fontSize: 12 }}>
          Recargar
        </button>
      </div>

      <div style={{ overflowY: 'auto', flex: 1, padding: '0 8px 8px' }}>
        {versions.map((version, i) => {
          const live = i === 0;
          const active = viewing?.version === version.version;
          return (
            <div
              key={version.version}
              style={{
                marginBottom: 6,
                padding: 8,
                border: '1px solid #ddd',
                borderLeft: `4px solid ${live ? '#1a7f37' : '#ddd'}`,
                borderRadius: 4,
                background: active ? '#eef4ff' : '#fff',
                fontSize: 12,
              }}
            >
              <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                <strong>v{version.version}</strong>
                {live && <span style={{ color: '#1a7f37', fontSize: 11 }}>en vivo</span>}
                <span style={{ color: '#666', marginLeft: 'auto' }}>
                  {stamp(version.publishedAt)}
                </span>
              </div>
              <div style={{ color: '#888', fontSize: 11, marginTop: 2 }}>
                {version.nodes} nodos, {version.edges} aristas
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button onClick={() => onView(version.version)} style={{ fontSize: 11 }}>
                  ver
                </button>
                <button onClick={() => onLoad(version.version)} style={{ fontSize: 11 }}>
                  cargar en el editor
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
