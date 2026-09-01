import { useState } from 'react';
import { OPERATORS, asGroup, coerce, emptyGroup, fromWhen, isGroup, toWhen, varsAt } from './graph.js';

const input = { padding: '3px 5px', fontSize: 12, boxSizing: 'border-box' };
const label = { fontSize: 11, color: '#666', marginTop: 6, display: 'block' };
const mini = { fontSize: 11, padding: '1px 5px', cursor: 'pointer' };

/**
 * El constructor de condiciones de una arista.
 *
 * La condición es un árbol: un grupo con su unión —Y u O—, que puede estar
 * negado, y del que cuelgan comparaciones y otros grupos. Mezclar Y y O es meter
 * un grupo dentro de otro, lo que además quita la ambigüedad de precedencia.
 *
 * Si la condición guardada no cabe en el constructor, se enseña tal cual en solo
 * lectura: reabrirla como algo parecido pero distinto cambiaría por dónde va una
 * llamada real sin que nadie lo avise.
 *
 * @param flow El grafo, para saber de qué nodo sale la arista.
 * @param edge La arista de React Flow.
 * @param onChange Recibe el `when` nuevo, o `undefined` si deja de haber condición.
 */
export default function WhenForm({ flow, edge, onChange }) {
  const when = edge.data?.when ?? null;
  const variables = varsAt(flow, { from: edge.source, to: edge.target });
  const stored = asGroup(fromWhen(when));

  // El árbol que se está editando vive aquí y no se vuelve a leer del `when` en
  // cada render. Un grupo con un solo hijo se guarda pelado —la normalización
  // que hace que el JSON no engorde—, así que releerlo desharía el grupo recién
  // creado justo antes de poder meterle la segunda condición. El JSON es cómo
  // se guarda, no cómo se edita.
  const [tree, setTree] = useState(stored);
  const [shown, setShown] = useState(edge.id);
  if (shown !== edge.id) {
    setShown(edge.id);
    setTree(stored);
  }

  if (tree === null) {
    return (
      <>
        <small style={{ fontSize: 11, color: '#9a6700' }}>
          Esta condición no cabe en el formulario, así que se enseña tal cual y no se toca.
        </small>
        <pre style={{
          margin: '6px 0 0', padding: 8, background: '#f6f8fa', border: '1px solid #ddd',
          borderRadius: 4, fontSize: 11, overflow: 'auto',
        }}>
          {JSON.stringify(when, null, 2)}
        </pre>
      </>
    );
  }

  const hasCondition = tree.children.length > 0;
  const replace = (next) => {
    setTree(next);
    onChange(toWhen(next));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={label}>Cuándo se toma esta arista</label>
      <label style={{ fontSize: 12 }}>
        <input
          type="radio"
          name="tiene-condicion"
          checked={!hasCondition}
          onChange={() => replace(emptyGroup())}
        />{' '}
        siempre
      </label>
      <label style={{ fontSize: 12 }}>
        <input
          type="radio"
          name="tiene-condicion"
          checked={hasCondition}
          onChange={() => replace({
            ...tree,
            children: [newClause(variables)],
          })}
        />{' '}
        solo si…
      </label>

      {hasCondition && (
        <Group
          group={tree}
          variables={variables}
          onChange={replace}
          root
        />
      )}
    </div>
  );
}

/** Una comparación nueva, sobre la primera variable que haya. */
const newClause = (variables) => ({
  var: variables[0]?.name ?? 'caller',
  op: '==',
  value: variables[0]?.values?.[0]?.value ?? '',
});

function Group({ group, variables, onChange, root = false }) {
  const set = (patch) => onChange({ ...group, ...patch });
  const setChild = (i, child) =>
    onChange({ ...group, children: group.children.map((c, j) => (j === i ? child : c)) });
  const remove = (i) =>
    onChange({ ...group, children: group.children.filter((_, j) => j !== i) });

  return (
    <div style={{
      border: '1px solid #ddd', borderLeft: '3px solid #c8c8c8', borderRadius: 4,
      padding: 6, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 11 }}>
        <label>
          <input
            type="checkbox"
            checked={group.negated}
            onChange={(e) => set({ negated: e.target.checked })}
          />{' '}
          no
        </label>
        <span style={{ color: '#666' }}>se cumplen</span>
        <select
          aria-label="unión"
          style={input}
          value={group.join}
          onChange={(e) => set({ join: e.target.value })}
        >
          <option value="and">todas</option>
          <option value="or">alguna</option>
        </select>
      </div>

      {group.children.map((child, i) => (
        <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {isGroup(child) ? (
              <Group group={child} variables={variables} onChange={(next) => setChild(i, next)} />
            ) : (
              <Clause
                clause={child}
                variables={variables}
                onChange={(next) => setChild(i, next)}
              />
            )}
          </div>
          <button onClick={() => remove(i)} style={mini} aria-label="quitar">×</button>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 4 }}>
        <button
          style={mini}
          onClick={() => onChange({ ...group, children: [...group.children, newClause(variables)] })}
        >
          + condición
        </button>
        <button
          style={mini}
          onClick={() => onChange({
            ...group,
            children: [...group.children, { ...emptyGroup(), join: group.join === 'and' ? 'or' : 'and', children: [newClause(variables)] }],
          })}
        >
          + grupo
        </button>
      </div>

      {root && group.children.length === 0 && (
        <small style={{ fontSize: 11, color: '#666' }}>sin condiciones: la arista pasa siempre</small>
      )}
    </div>
  );
}

/** Una comparación: variable, operador y valor. */
function Clause({ clause, variables, onChange }) {
  const spec = variables.find((v) => v.name === clause.var);
  const isIn = clause.op === 'in';

  // Cambiar de variable puede dejar el valor sin sentido (de `digit` a `hhmm`),
  // así que se siembra con el primer valor de la nueva si los tiene cerrados.
  const changeVar = (name) => {
    const next = variables.find((v) => v.name === name);
    onChange({ ...clause, var: name, value: next?.values?.[0]?.value ?? '' });
  };

  return (
    <div style={{ display: 'flex', gap: 3 }}>
      <select
        aria-label="variable"
        style={{ ...input, flex: 2, minWidth: 0 }}
        value={clause.var}
        onChange={(e) => changeVar(e.target.value)}
      >
        {variables.map((v) => (
          <option key={v.name} value={v.name}>{v.name}</option>
        ))}
      </select>

      <select
        aria-label="operador"
        style={{ ...input, flex: 1, minWidth: 0 }}
        value={clause.op}
        onChange={(e) => onChange({ ...clause, op: e.target.value, value: e.target.value === 'in' ? [] : '' })}
      >
        {OPERATORS.map(({ op, label: texto }) => (
          <option key={op} value={op}>{texto}</option>
        ))}
      </select>

      {isIn ? (
        <input
          aria-label="valor"
          style={{ ...input, flex: 2, minWidth: 0 }}
          value={(clause.value ?? []).join(', ')}
          placeholder="uno, otro"
          onChange={(e) => onChange({
            ...clause,
            value: e.target.value.split(',').map((part) => coerce(spec, part.trim())).filter((v) => v !== undefined),
          })}
        />
      ) : spec?.values ? (
        <select
          aria-label="valor"
          style={{ ...input, flex: 2, minWidth: 0 }}
          value={String(clause.value)}
          onChange={(e) => {
            const choice = spec.values.find((c) => String(c.value) === e.target.value);
            onChange({ ...clause, value: choice ? choice.value : e.target.value });
          }}
        >
          {spec.values.map((choice) => (
            <option key={String(choice.value)} value={String(choice.value)}>{choice.label}</option>
          ))}
        </select>
      ) : (
        <input
          aria-label="valor"
          style={{ ...input, flex: 2, minWidth: 0 }}
          value={clause.value ?? ''}
          onChange={(e) => onChange({ ...clause, value: coerce(spec, e.target.value) ?? '' })}
        />
      )}
    </div>
  );
}
