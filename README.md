# Janus fesf

Capa de control de flujo condicional sobre SIP, para que configurar el enrutado
de llamadas no exija meterse dentro de Asterisk.

Asterisk como motor de medios, un intérprete de grafos por encima, y los flujos
definidos en datos en vez de en dialplan.

---

## El problema

Montar enrutado condicional serio sobre SIP hoy significa bajar al dialplan de
Asterisk. Eso lo deja fuera del alcance de cualquiera que no sea ingeniero de
telefonía, y convierte cada cambio de horario o cada nueva regla en un
despliegue.

El caso concreto que lo motiva: agentes de voz IA. El agente se conecta como
endpoint SIP, así que meterlo en una llamada es trivial — un `Dial` y ya. Pero
un `Dial` es un **handoff**, no una orquestación. En cuanto entregas la llamada
al agente, sales del bucle y pierdes tres cosas:

1. **Devolución de control.** El agente cualifica y luego hay que enrutar:
   comercial a una cola, cabreado a un supervisor, quiere cita a la agenda. Con
   un `Dial` esa decisión la toma el agente por dentro, así que la lógica de
   enrutado se muda dentro del agente. El problema no se resuelve, se cambia de
   sitio — y sigue sin poder tocarlo nadie que no programe.
2. **Datos.** `Dial` pasa caller ID y poco más. Ni variables estructuradas hacia
   dentro ni resultado estructurado hacia fuera.
3. **Control durante la llamada.** Timeout con fallback, transferencia con
   whisper, grabación condicional: invisibles detrás de un `Dial`.

El valor no está en "el agente como nodo" — eso ya lo hace cualquier
constructor de flujos. Está en **handback y estado compartido**.

---

## Qué existe ya, y qué no

Conviene tenerlo claro para no reinventar:

| Qué | Estado |
|---|---|
| 3CX Call Flow Designer | Drag & drop real, pero cerrado y atado a 3CX. |
| FreePBX "Call Flow Control" | Es un toggle día/noche, no un diseñador. |
| Twilio Studio / Vonage | El modelo correcto, pero cloud, por minuto, y su SIP. |
| Node-RED + ARI | Existe y funciona. Su usuario es técnico, no el nuestro. |
| jambonz | OSS y pensado para agentes de voz sobre SIP. Dirigido por webhooks, **no visual**. |
| LiveKit Agents / Pipecat | Excelentes en medios y latencia de agente. No son capa de enrutado. |

**El patrón:** la parte de *agente* en OSS está bien cubierta. La capa visual de
flujo condicional por encima, no.

---

## La solución

Un intérprete de grafos que vive fuera de Asterisk y controla las llamadas vía
ARI. El flujo es un dato, no configuración compilada.

### Dónde se ejecuta la lógica

Tres caminos posibles, y sólo uno aguanta:

| Opción | Veredicto |
|---|---|
| Generar `extensions.conf` desde BBDD y recargar | No. Reload con llamadas vivas, debug imposible, condicionales pobres. |
| `func_odbc` — dialplan leyendo BBDD | Sigues en el dialplan, que es de lo que huimos. |
| **ARI + Stasis** | Sí. |

Con ARI, el dialplan entero se queda en esto:

```
[from-trunk]
exten => _X.,1,Stasis(janus,${EXTEN})
 same => n,Hangup()
```

Todo lo demás es un proceso normal hablando WebSocket + REST con Asterisk. El
intérprete es código corriente: testeable, desplegable, con logs y con stack
traces. Asterisk pasa a ser un motor de medios tonto, que es exactamente lo que
queremos.

Bonus: ARI trae `externalMedia` y `snoop`, así que si algún día el agente deja
de ser un endpoint SIP y hay que streamear audio, el camino ya está abierto.

### Arquitectura

```
troncal SIP
    |
    v
Asterisk  --- dialplan de 3 líneas --->  Stasis(janus)
    ^                                        |
    |                ARI (WebSocket + REST)  |
    |                                        v
    +------------- bridge / dial ------  Motor Janus
                                             |
                                       +-----+-----+
                                       |           |
                                   Postgres    agente IA
                                  (flujos +   (endpoint SIP)
                                    trazas)
```

El agente se bridgea y se deshace el bridge cuando devuelve resultado. La
llamada **nunca sale de Stasis**, así que el control vuelve solo. Eso es el
handback, y con ARI sale gratis.

---

## Cómo se ejecuta

Nada de esto necesita build. Node 24 ejecuta TypeScript directamente.

### Primera vez

```bash
pnpm install
cd ui && npm install && cd ..
```

Sí, dos gestores distintos: pnpm en la raíz y npm en `ui/`. No es descuido —
pnpm bloquea el script de build de esbuild y Vite no arranca.

Hace falta **ffmpeg** en la máquina, pero solo para subir audios desde el editor:
sin él el motor arranca y atiende llamadas igual, y la subida falla diciéndolo.

```bash
sudo apt install ffmpeg     # o lo que use tu distro
```

La configuración de Asterisk viene en el repo, en `asterisk-config/etc/`. Lo
único que hay que bajar son los audios, que pesan y se regeneran:

```bash
mkdir -p asterisk-config/sounds/en
curl -fsSL https://downloads.asterisk.org/pub/telephony/sounds/asterisk-core-sounds-en-gsm-current.tar.gz \
  | tar -xz -C asterisk-config/sounds/en
```

Las contraseñas del laboratorio están en `pjsip.conf` y `ari.conf`: son de un
contenedor en localhost, cámbialas antes de exponer nada. El fichero que genera
el motor con las credenciales de las troncales, `pjsip_janus.conf`, sí está
fuera de git.

### El día a día

Cada uno en su terminal:

```bash
# 1 · Asterisk
docker run -d --rm --name asterisk --network host \
  -v $PWD/asterisk-config/etc:/etc/asterisk \
  -v $PWD/asterisk-config/sounds:/var/lib/asterisk/sounds \
  andrius/asterisk

# 2 · el motor  (ARI + API del flujo en :3000)
pnpm start

# 3 · el editor  (:5173)
cd ui && npm run dev
```

`--network host` no es opcional: el RTP usa un rango UDP ancho y mapearlo en
modo bridge da audio unidireccional.

Y marcas `100` desde un softphone registrado como `jaime`.

### Todos los comandos

| Comando | Qué hace |
|---|---|
| `pnpm start` | El motor: conecta con ARI, configura las troncales y sirve la API en :3000 |
| `pnpm test` | Los 304 tests: 244 puros con `node --test` y 60 de la UI con jsdom. No necesitan Asterisk ni red |
| `pnpm typecheck` | `tsc --noEmit`. No compila, solo comprueba |
| `pnpm calls` | Las últimas llamadas con su traza. `pnpm calls 50` para más |
| `cd ui && npm run dev` | El editor de flujos en :5173 |

Para el motor, `node --watch src/main.ts` recarga al guardar. Ojo: **el código
no se recarga solo, el flujo sí** — un `PUT /api/flow` desde el editor cambia el
grafo en caliente, pero tocar `src/` obliga a reiniciar.

### Mirar por dentro

```bash
docker exec -it asterisk asterisk -rvvv     # la consola de Asterisk
```

Y dentro de ella:

```
pjsip show endpoints     ¿existe y en qué estado está?
pjsip show contacts      dónde está registrado ahora mismo
pjsip show transports    ¿hay algo escuchando en el 5060?
pjsip set logger on      volcar el SIP entero, para ver por qué falla un REGISTER
dialplan show jaime      qué hay en ese contexto
```

Desde fuera:

```bash
curl -u janus:janus http://localhost:8088/ari/asterisk/info   # ¿ARI vivo?
curl http://localhost:3000/api/flow                            # el flujo actual
curl http://localhost:3000/api/flows                           # las versiones publicadas
curl 'http://localhost:3000/api/flows?version=2'               # el grafo de la v2
curl http://localhost:3000/api/trunks                          # las troncales y su estado
curl http://localhost:3000/api/sounds                          # los audios subidos
curl -X PUT --data-binary @saludo.mp3 \
     http://localhost:3000/api/sounds/saludo.mp3               # subir uno
```

### Dónde está cada cosa

```
src/            el motor (TypeScript, sin build)
flow.json       la semilla de una base vacía. El grafo vive en la BBDD
janus.db        flujos, troncales y trazas (SQLite). Fuera del repo
tests/          244 tests deterministas del motor
ui/             el editor (React Flow + Vite), con 49 tests puros y 60 con jsdom
asterisk-config/etc     config de Asterisk, montada en el contenedor. En el repo
asterisk-config/sounds  los audios. Fuera del repo: pesan y se regeneran
```

---

## Modelo de datos

Sin normalizar nodos y aristas en tablas: siempre se lee el flujo entero.

```sql
flows(id, tenant_id, name, version, graph jsonb, published_at)
calls(id, tenant_id, flow_id, flow_version, channel_id, started_at, ended_at, outcome)
call_steps(call_id, seq, node_id, entered_at, vars jsonb)   -- el trace
```

`graph` = `{nodes: [{id, name, type, config}], edges: [{from, to, when}]}`

El `id` lo genera el editor y es opaco: lo referencian las aristas y `call_steps`, así que no se
puede cambiar. El `name` es el rótulo, se cambia cuando quieras, y el motor lo ignora. La traza se
lee resolviendo cada id contra el grafo de la versión que recorrió esa llamada, así que renombrar
un nodo no reescribe el pasado.

**Versionado inmutable.** Publicar crea versión nueva, y cada llamada se ancla a
la versión con la que entró — capturada al entrar, no al colgar. Despliegues
seguros gratis, y la traza se pinta sobre el grafo que esa llamada recorrió de
verdad y no sobre el que haya ahora.

Volver a una versión anterior es cargarla en el editor y publicarla otra vez:
sale una versión nueva y las viejas siguen intactas. El invariante no hay que
defenderlo, se cumple solo.

**Condiciones:** nada de DSL propio. [jsonlogic](https://jsonlogic.com) — ya existe, ya tiene
evaluador en JS y en el back, y se serializa solo. En el editor se construyen como un árbol de
grupos: cada grupo con su unión —Y u O— y su casilla de negado, y dentro comparaciones y otros
grupos. Mezclar Y con O es anidar, que además quita la ambigüedad de precedencia.

Lo que no cabe en el constructor —un operador que no ofrece— se enseña tal cual, en solo lectura.
Reabrir una condición como algo parecido pero distinto cambiaría por dónde va una llamada real sin
que nadie lo avise.

**El vocabulario está declarado**, no repartido: `src/schema.ts` dice qué campos tiene cada tipo de
nodo, en qué unidad, con qué valor por defecto y qué variables deja disponibles al salir. Lo leen
el motor para validar y para ejecutar, y el editor para pintar los formularios y saber qué ofrecer
en cada arista.

---

## Nodos

Cinco implementados, y ni uno más hasta que falte alguno de verdad:

`entry` · `say` (TTS/audio) · `gather` (DTMF/voz) · `dial` (endpoint/cola) ·
`hangup`. Falta `ai_agent`.

`branch`, `http` y `answer` se descartaron: las condiciones viven en las aristas,
así que ramificar no necesita nodo; y contestar lo hace el dialplan.

El horario tampoco es un nodo. `callVars` siembra `hhmm`, `weekday` y `date` al
entrar la llamada, y las aristas que salen de `entry` los comparan con jsonlogic.

---

## Lo que va a doler

Por orden de probabilidad de morder:

1. **Estado en redespliegue.** Una llamada es un objeto vivo de minutos. Si
   reinicias el motor, el WebSocket de ARI cae y los canales se quedan en el
   limbo de Stasis. Hay que decidirlo a propósito — estado externo y reconexión,
   o desplegar con drenaje — no descubrirlo en producción.
2. **El motor es punto único de fallo.** Un WebSocket contra Asterisk. Si cae,
   todas las llamadas en Stasis quedan huérfanas. Existe hoy, con una sola caja,
   y no tiene nada que ver con escalar. Lo de varios clientes ARI sobre la misma
   app Stasis: tratarlo como **no resuelto** hasta verificarlo.
3. **Debuggabilidad.** Un flujo que falla sin traza es magia negra para el
   usuario. `call_steps` pintado sobre el mismo grafo: "entró aquí, saltó allí,
   colgó". Barato, y es lo que evita acabar de soporte técnico de cada cliente.
   Ojo con el detalle que lo arruina: pintarlo sobre el grafo **actual** en vez
   de sobre el que corrió la llamada. Por eso cada llamada guarda su versión.
4. **Simulador.** Recorrer el grafo con inputs falsos sin llamar. Cuesta poco y
   multiplica la usabilidad.

### Escalado (no es problema hoy)

Una caja aguanta entre 300 y 1000 concurrentes según codecs — transcodificar es
lo que desploma la cifra. Para calibrar: 500 concurrentes son unas 10.000
llamadas/hora.

El límite real de Asterisk no es CPU, es que **no tiene clustering**: dos cajas
no se conocen y si una cae se lleva sus llamadas. El arreglo es estándar y está
trilladísimo — Kamailio delante como proxy SIP repartiendo a un pool de
Asterisks — pero es un proyecto en sí mismo y hoy no hace falta.

El cuello de botella real llegará antes por el agente IA (concurrencia de
LLM/TTS, rate limits, coste por minuto) que por Asterisk.

**Regla de diseño que sí se paga hoy:** el estado de la llamada vive en el motor
y en la BBDD, nunca dentro de Asterisk. Si Asterisk es desechable, añadir cajas
luego es configuración. Si el estado se acumula en variables de canal, es una
reescritura.

---

## Alcance

### Finde 1 — el bucle completo en miniatura

Meta: llamar desde un softphone, oír el TTS, marcar 1, y que te lleve a otro
sitio. Ahí ya está el sistema entero funcionando.

- [ ] Asterisk en Docker
- [ ] Dialplan de 3 líneas a `Stasis()`
- [ ] Motor ARI, ~100 líneas, leyendo un grafo desde un JSON escrito a mano
- [ ] Softphone (Linphone / Zoiper) como origen
- [ ] Tres nodos: `say`, `gather`, `dial`

Sin BBDD, sin UI, sin auth, sin números reales, sin troncal.

### Después

- [ ] Editor con React Flow escribiendo ese mismo JSON — **no construir un
      editor de grafos desde cero**
- [ ] Postgres y versionado
- [ ] Los ocho nodos
- [ ] Trace de llamada sobre el grafo
- [ ] Handback estructurado del agente
- [ ] Simulador

---

## Decisiones y descartes

| Descartado | Motivo |
|---|---|
| Generar dialplan desde BBDD | Reload con llamadas vivas, debug imposible. |
| jambonz / LiveKit como base | El agente ya es endpoint SIP, así que la capa de medios — la parte dura que aportan — no hace falta. Y Asterisk ya lo conozco. |
| Node-RED como producto | Su usuario es técnico; el nuestro no. Sirve como banco de pruebas interno del motor, no como entrega. |
| DSL propio de condiciones | jsonlogic ya existe. |
| Tablas de nodos y aristas | Siempre se lee el grafo entero. JSONB y listo. |
| Multi-tenancy y Kamailio | Ninguno de los dos hace falta con una caja. El camino queda abierto. |

---

## Lo único que no se salta

**Toll fraud.** El día que esto toque internet con credenciales SIP reales, una
credencial filtrada son miles de euros en una noche, no un susto. Mientras sea
softphone en local no existe el problema. En el momento en que se enchufe una
troncal: **límite de gasto y allowlist de destinos antes que ninguna otra cosa.**

---

## Nota

El nombre viene de Jano, el dios de las puertas y los pasos: dos caras, una
mirando a quien entra y otra a dónde va. Para un enrutador de llamadas, encaja.
