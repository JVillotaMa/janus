import { useCallback, useEffect, useState } from 'react';

/** Verde cuando Asterisk la reconoce, ámbar si la conoce pero no registra. */
const DOT = { online: '#1a7f37', offline: '#9a6700', unknown: '#cf222e', unreachable: '#999' };

const LABEL = {
  online: 'Asterisk la reconoce',
  offline: 'configurada, sin registrar',
  unknown: 'Asterisk no la conoce',
  unreachable: 'Asterisk no responde',
};

const input = { width: '100%', padding: '4px 6px', fontSize: 12, boxSizing: 'border-box' };
const label = { fontSize: 11, color: '#666', marginTop: 6, display: 'block' };

/** Una troncal nueva, en blanco. */
const empty = () => ({ name: '', host: '', mode: 'register', username: '', password: '', matchIp: '' });

/**
 * Formulario del nodo de entrada: qué troncal atiende este flujo y si Asterisk
 * la tiene cargada.
 *
 * El mismo componente sirve en el panel lateral y en el modal; `wide` solo añade
 * lo que no cabe en 320px.
 */
export default function Trunks({ config, onChange, wide = false }) {
  const [trunks, setTrunks] = useState([]);
  const [draft, setDraft] = useState(null);
  const [status, setStatus] = useState('');
  const [issues, setIssues] = useState([]);
  const [generated, setGenerated] = useState('');

  const load = useCallback(() => {
    fetch('/api/trunks')
      .then((res) => res.json())
      .then(setTrunks)
      .catch((err) => setStatus(`error: ${err.message}`));
  }, []);

  useEffect(load, [load]);

  useEffect(() => {
    if (!wide) return;
    fetch('/api/trunks/config')
      .then((res) => res.text())
      .then(setGenerated)
      .catch(() => setGenerated('(no se ha podido leer)'));
  }, [wide, trunks]);

  /** Guarda la lista entera: la API la lee y la escribe completa. */
  const save = async (list) => {
    setStatus('guardando…');
    const res = await fetch('/api/trunks', { method: 'PUT', body: JSON.stringify(list) });
    const body = await res.json().catch(() => ({}));
    setIssues(body.issues ?? []);
    if (!res.ok) return void setStatus('NO se ha guardado');
    setStatus('aplicado a Asterisk');
    setDraft(null);
    load();
  };

  // La contraseña no vuelve en el GET, así que se manda solo si se ha escrito
  // una: sin campo, el motor conserva la que ya tenía guardada.
  const add = () => save([...trunks, Object.fromEntries(
    Object.entries(draft).filter(([, value]) => value !== ''),
  )]);

  const remove = (name) => save(trunks.filter((trunk) => trunk.name !== name));

  const current = trunks.find((trunk) => trunk.name === config.trunk);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={label}>Troncal por la que entra la llamada</label>
      <select
        value={config.trunk ?? ''}
        onChange={(e) => onChange({ ...config, trunk: e.target.value || undefined })}
        style={input}
      >
        <option value="">— ninguna —</option>
        {trunks.map((trunk) => (
          <option key={trunk.name} value={trunk.name}>{trunk.name}</option>
        ))}
      </select>

      {current && (
        <small style={{ fontSize: 11, marginTop: 4 }}>
          <span style={{ color: DOT[current.state] ?? '#999' }}>●</span>{' '}
          {LABEL[current.state] ?? current.state ?? 'sin determinar'}
          {' · '}
          <span style={{ fontFamily: 'monospace' }}>{current.host}</span>
          {' · '}
          <button onClick={() => remove(current.name)} style={{ fontSize: 11, padding: '0 4px' }}>
            borrar
          </button>
        </small>
      )}

      {config.trunk && !current && (
        <small style={{ fontSize: 11, color: '#cf222e' }}>
          esta troncal no está dada de alta
        </small>
      )}

      <hr style={{ width: '100%', border: 0, borderTop: '1px solid #eee', margin: '8px 0 0' }} />

      {draft ? (
        <>
          <label style={label}>Nombre</label>
          <input style={input} value={draft.name} placeholder="masmovil"
            onChange={(e) => setDraft({ ...draft, name: e.target.value })} />

          <label style={label}>Host del proveedor</label>
          <input style={input} value={draft.host} placeholder="sip.masmovil.es"
            onChange={(e) => setDraft({ ...draft, host: e.target.value })} />

          <label style={label}>Cómo te autentica</label>
          <select style={input} value={draft.mode}
            onChange={(e) => setDraft({ ...draft, mode: e.target.value })}>
            <option value="register">Con usuario y contraseña (registro)</option>
            <option value="identify">Por IP de origen</option>
          </select>

          {draft.mode === 'register' ? (
            <>
              <label style={label}>Usuario</label>
              <input style={input} value={draft.username}
                onChange={(e) => setDraft({ ...draft, username: e.target.value })} />
              <label style={label}>Contraseña</label>
              <input style={input} type="password" value={draft.password}
                onChange={(e) => setDraft({ ...draft, password: e.target.value })} />
            </>
          ) : (
            <>
              <label style={label}>IP del proveedor</label>
              <input style={input} value={draft.matchIp} placeholder="212.0.0.5"
                onChange={(e) => setDraft({ ...draft, matchIp: e.target.value })} />
            </>
          )}

          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button onClick={add} style={{ fontWeight: 600 }}>Guardar troncal</button>
            <button onClick={() => { setDraft(null); setIssues([]); }}>Cancelar</button>
          </div>
        </>
      ) : (
        <button onClick={() => setDraft(empty())} style={{ marginTop: 8 }}>+ nueva troncal</button>
      )}

      {status && (
        <small style={{ fontSize: 11, color: issues.length ? '#cf222e' : '#666', marginTop: 6 }}>
          {status}
        </small>
      )}

      {issues.map((issue, i) => (
        <small key={i} style={{ fontSize: 11, color: '#cf222e' }}>
          {issue.where}: {issue.message}
        </small>
      ))}

      {wide && (
        <>
          <label style={label}>Lo que Janus le ha escrito a Asterisk</label>
          <pre style={{
            margin: 0, padding: 8, background: '#f6f8fa', border: '1px solid #ddd',
            borderRadius: 4, fontSize: 11, maxHeight: 260, overflow: 'auto',
          }}>
            {generated || '(sin troncales)'}
          </pre>
          <small style={{ fontSize: 11, color: '#666' }}>
            Solo lectura. Lo reescribe el motor en cada cambio.
          </small>
        </>
      )}
    </div>
  );
}
