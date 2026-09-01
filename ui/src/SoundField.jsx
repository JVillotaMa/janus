import { useCallback, useEffect, useState } from 'react';

const input = { width: '100%', padding: '4px 6px', fontSize: 12, boxSizing: 'border-box' };
const nota = { fontSize: 11, color: '#666', marginTop: 2 };

/**
 * El campo de audio de un nodo.
 *
 * El texto sigue siendo el valor de verdad: los cien y pico audios que trae
 * Asterisk funcionan hoy y son la mitad del flujo del repo, así que se siguen
 * pudiendo escribir. Debajo, lo que este cambio añade: elegir un fichero del
 * sistema, y elegir uno ya subido.
 *
 * El nombre saneado lo decide el motor, así que se escribe en el campo lo que
 * responda la subida y no lo que adivine el navegador.
 */
export default function SoundField({ value, onChange, placeholder }) {
  const [sounds, setSounds] = useState([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch('/api/sounds')
      .then((res) => res.json())
      .then(setSounds)
      .catch(() => setSounds([]));
  }, []);

  useEffect(load, [load]);

  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    setStatus(`subiendo ${file.name}…`);
    try {
      const res = await fetch(`/api/sounds/${encodeURIComponent(file.name)}`, {
        method: 'PUT',
        body: file,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(body.issues?.[0]?.message ?? 'no se ha podido subir');
        return;
      }
      onChange(body.media);
      setStatus(`${body.name} · ${body.seconds}s`);
      load();
    } catch (err) {
      setStatus(`error: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <input
        id="campo-media"
        style={input}
        value={value ?? ''}
        placeholder={placeholder ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />

      <input
        type="file"
        accept="audio/*"
        aria-label="subir un audio"
        disabled={busy}
        style={{ ...input, padding: 0, marginTop: 4, border: 0 }}
        onChange={(e) => upload(e.target.files?.[0])}
      />

      {sounds.length > 0 && (
        <select
          aria-label="audios subidos"
          style={{ ...input, marginTop: 4 }}
          value={sounds.some((s) => s.media === value) ? value : ''}
          onChange={(e) => e.target.value && onChange(e.target.value)}
        >
          <option value="">— o elige uno ya subido —</option>
          {sounds.map((sound) => (
            <option key={sound.name} value={sound.media}>
              {sound.name} · {sound.seconds}s
            </option>
          ))}
        </select>
      )}

      {status && <small style={nota}>{status}</small>}
    </>
  );
}
