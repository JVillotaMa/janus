import { useState } from 'react';
import { formatEndpoint, parseEndpoint } from '../../src/endpoint.ts';
import { TrunkPicker } from './Trunks.jsx';

const input = { width: '100%', padding: '4px 6px', fontSize: 12, boxSizing: 'border-box' };
const label = { fontSize: 11, color: '#666', marginTop: 6, display: 'block' };

/**
 * El destino de un nodo que llama.
 *
 * La sintaxis de Asterisk esconde una trampa: lo que va después de la arroba es
 * el nombre de un endpoint de `pjsip.conf`, no la dirección de un servidor.
 * Poner ahí un dominio da `endpoint '<dominio>' was not found`, y el campo de
 * texto no daba ninguna pista. Aquí se eligen las dos partes por separado y el
 * `PJSIP/` no lo teclea nadie.
 *
 * @param value La cadena guardada en el config del nodo.
 * @param onChange Recibe la cadena compuesta.
 */
export default function EndpointField({ value, onChange, placeholder }) {
  const destino = parseEndpoint(value);

  // El modo es estado del formulario y no una lectura del valor: mientras eliges
  // "por una troncal" y todavía no has elegido cuál, lo guardado es `PJSIP/x`,
  // que releído sería una extensión interna y te devolvería el botón a su sitio
  // antes de poder terminar. Se resiembra al cambiar de nodo, porque `NodeForm`
  // vuelve a montar el campo.
  const [porTroncal, setPorTroncal] = useState(Boolean(destino?.trunk));

  if (destino === null) {
    return (
      <>
        <input
          id="campo-endpoint"
          style={input}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
        <small style={{ fontSize: 11, color: '#9a6700' }}>
          Este destino no encaja en el formulario, así que se escribe a mano.
          Lo normal es <code>PJSIP/algo</code> o <code>PJSIP/algo@troncal</code>.
        </small>
      </>
    );
  }

  const set = (resource, trunk) => onChange(formatEndpoint({ resource, trunk }));
  const cambiarModo = (nuevo) => {
    setPorTroncal(nuevo);
    if (!nuevo) set(destino.resource, null);
  };

  return (
    <>
      <label style={{ fontSize: 12 }}>
        <input
          type="radio"
          name="modo-destino"
          checked={!porTroncal}
          onChange={() => cambiarModo(false)}
        />{' '}
        una extensión interna
      </label>
      <label style={{ fontSize: 12 }}>
        <input
          type="radio"
          name="modo-destino"
          checked={porTroncal}
          onChange={() => cambiarModo(true)}
        />{' '}
        por una troncal
      </label>

      <input
        id="campo-endpoint"
        aria-label={porTroncal ? 'a qué número' : 'qué extensión'}
        style={{ ...input, marginTop: 4 }}
        value={destino.resource}
        placeholder={porTroncal ? '+1000000000' : (placeholder ?? 'ana')}
        onChange={(e) => set(e.target.value, porTroncal ? destino.trunk : null)}
      />

      {porTroncal && (
        <TrunkPicker
          value={destino.trunk}
          onChange={(trunk) => set(destino.resource, trunk)}
          label="Por la troncal"
        />
      )}
    </>
  );
}
