import { NODE_TYPES, defaults } from '../../src/schema.ts';
import { coerce } from './graph.js';
import EndpointField from './EndpointField.jsx';
import SoundField from './SoundField.jsx';
import { TrunkPicker } from './Trunks.jsx';

const input = { width: '100%', padding: '4px 6px', fontSize: 12, boxSizing: 'border-box' };
const label = { fontSize: 11, color: '#666', marginTop: 6, display: 'block' };

/**
 * Los tipos que se pueden crear.
 *
 * `entry` no está: tiene que haber exactamente uno y ya existe, así que
 * ofrecerlo sería ofrecer un camino que `validate` rechaza después.
 */
export const CREATABLE = Object.entries(NODE_TYPES).filter(([type]) => type !== 'entry');

/**
 * Dos campos son el mismo si coinciden nombre, tipo **y unidad**.
 *
 * Lo de la unidad no es remilgo: `gather.timeout` cuenta en milisegundos y
 * `dial.timeout` en segundos, así que conservarlo por el nombre convertiría una
 * espera de 5 segundos en una llamada sonando 5000.
 */
const same = (a, b) => a.name === b.name && a.type === b.type && a.unit === b.unit;

/**
 * Selector de creación: se despliega bajo el botón y crea al pinchar un tipo.
 *
 * @param onPick Recibe el tipo elegido.
 */
export function TypePicker({ onPick, onCancel }) {
  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 4, padding: 6, marginTop: 4 }}>
      {CREATABLE.map(([type, spec]) => (
        <button
          key={type}
          onClick={() => onPick(type)}
          style={{
            display: 'block', width: '100%', textAlign: 'left', font: 'inherit',
            fontSize: 12, padding: '5px 6px', marginBottom: 2, cursor: 'pointer',
            border: 0, borderRadius: 3, background: '#f6f8fa',
          }}
        >
          <strong>{spec.label}</strong>
          <span style={{ color: '#888' }}>
            {spec.fields.length ? ` · ${spec.fields.map((f) => f.name).join(', ')}` : ''}
          </span>
        </button>
      ))}
      <button onClick={onCancel} style={{ fontSize: 11, marginTop: 2 }}>cancelar</button>
    </div>
  );
}

/**
 * El formulario de un nodo: su nombre, su tipo y un control por campo.
 *
 * Sustituye al editor de JSON. El id no aparece: se genera solo y no dice nada.
 *
 * @param node El nodo de React Flow, con `data.type`, `data.name` y `data.config`.
 * @param onChange Recibe el parche a aplicar (`{name}`, `{type, config}` o `{config}`).
 * @param onNotice Texto para la línea de estado. Se usa al descartar campos.
 */
export default function NodeForm({ node, onChange, onNotice }) {
  const type = node.data.type;
  const spec = NODE_TYPES[type];
  const config = node.data.config ?? {};

  const setField = (field, raw) => {
    const value = coerce(field, raw);
    const next = { ...config };
    if (value === undefined) delete next[field.name];
    else next[field.name] = value;
    onChange({ config: next });
  };

  // Se conserva lo que es el mismo campo y se descarta el resto, diciéndolo:
  // tirar configuración en silencio es perder trabajo sin enterarte.
  const changeType = (next) => {
    if (next === type || !NODE_TYPES[next]) return;
    const kept = {};
    const dropped = [];
    for (const [key, value] of Object.entries(config)) {
      const mine = spec?.fields.find((f) => f.name === key);
      const theirs = NODE_TYPES[next].fields.find((f) => f.name === key);
      if (mine && theirs && same(mine, theirs)) kept[key] = value;
      else dropped.push(key);
    }
    onChange({ type: next, config: { ...defaults(next), ...kept } });
    onNotice?.(
      dropped.length
        ? `ahora es "${NODE_TYPES[next].label}": se descartan ${dropped.join(', ')}`
        : `ahora es "${NODE_TYPES[next].label}"`,
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <label style={label} htmlFor="node-name">Nombre</label>
      <input
        id="node-name"
        style={input}
        value={node.data.name ?? ''}
        placeholder={spec?.label ?? type}
        onChange={(e) => onChange({ name: e.target.value || undefined })}
      />

      {type === 'entry' ? (
        <small style={{ ...label, marginTop: 8 }}>
          Entrada · es el arranque del flujo y no se puede convertir en otra cosa
        </small>
      ) : (
        <>
          <label style={label} htmlFor="node-type">Qué hace</label>
          <select
            id="node-type"
            style={input}
            value={type}
            onChange={(e) => changeType(e.target.value)}
          >
            {CREATABLE.map(([id, s]) => (
              <option key={id} value={id}>{s.label}</option>
            ))}
            {!NODE_TYPES[type] && <option value={type}>{type} (el motor no lo conoce)</option>}
          </select>
        </>
      )}

      {spec?.fields.map((field) => (
        <FieldInput
          // El id del nodo va en la key para que al cambiar de nodo el campo se
          // vuelva a montar: los controles con estado propio —el modo del
          // destino— tienen que resembrarse, no arrastrarse de un nodo a otro.
          key={`${node.id}:${field.name}`}
          field={field}
          value={config[field.name]}
          onChange={(raw) => setField(field, raw)}
        />
      ))}

      {!spec && (
        <small style={{ fontSize: 11, color: '#cf222e', marginTop: 6 }}>
          El motor no conoce el tipo "{type}", así que no se sabe qué campos lleva.
        </small>
      )}
    </div>
  );
}

/**
 * Un campo, con su etiqueta y su unidad al lado.
 *
 * Un campo que el esquema declara con `control` propio no se pinta con un input
 * de texto: sus valores no los sabe el esquema. Quién lo decide es la
 * declaración, no un `if` por nombre de campo escondido aquí.
 */
function FieldInput({ field, value, onChange }) {
  return (
    <>
      {field.control !== 'trunk' && (
        <label style={label} htmlFor={`campo-${field.name}`}>
          {field.label}
          {field.unit && <span style={{ color: '#999' }}> ({field.unit})</span>}
          {field.required && <span style={{ color: '#cf222e' }}> *</span>}
        </label>
      )}
      {field.control === 'sound' ? (
        <SoundField value={value} placeholder={field.placeholder} onChange={onChange} />
      ) : field.control === 'endpoint' ? (
        <EndpointField value={value} placeholder={field.placeholder} onChange={onChange} />
      ) : field.control === 'trunk' ? (
        <TrunkPicker value={value} onChange={onChange} label={field.label} />
      ) : (
        <input
          id={`campo-${field.name}`}
          style={input}
          type={field.type === 'number' ? 'number' : 'text'}
          value={value ?? ''}
          placeholder={field.placeholder ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </>
  );
}
