## Context

Probado desde la máquina del dueño, con un `OPTIONS` de SIP construido a mano:

```
sip.rtc.elevenlabs.io -> 136.112.48.140
NAPTR:  50 SIPS+D2T (5061)  ·  70 SIP+D2T (5060)  ·  90 SIP+D2U (5060)
UDP 5060 : SIN RESPUESTA en 6s
TCP 5060 : CONTESTA -> SIP/2.0 200 OK
```

El SRV anuncia UDP y el servidor no lo atiende. Asterisk manda por UDP porque
`asterisk-config/etc/pjsip.conf` solo define `[transport-udp]` y `pjsip.ts` no emite ninguna línea
`transport=`, así que todo usa el de por defecto.

El síntoma en el log es `No response received ... retrying in '60'`, que no distingue entre "no hay
ruta", "el firewall lo come", "las credenciales están mal" y "no atienden este protocolo".

## Goals / Non-Goals

**Goals:**

- Que una troncal pueda hablar por TCP sin editar ficheros a mano.
- Que las troncales ya dadas de alta no cambien de comportamiento.
- Que un transporte inválido se rechace en la API y no genere configuración rota.

**Non-Goals:**

- TLS. Va después, con su verificación de certificado.
- WebSockets, IPv6, puertos locales configurables.
- Cambiar el transporte por defecto.

## Decisions

### 1. Los transportes se commitean, no se generan

`[transport-tcp]` entra en `asterisk-config/etc/pjsip.conf`, al lado del `[transport-udp]` que ya
estaba. Son dos secciones constantes: no dependen de qué troncales haya, y generarlas en cada
arranque no compra nada.

Es la misma regla que ya sigue el `#include pjsip_janus.conf` y el contexto `[janus]` de
`extensions.conf`: el motor escribe **solo** `pjsip_janus.conf`, y lo que es constante vive
versionado donde se puede leer.

Los dos escuchan en el 5060: son protocolos distintos, así que no chocan.

### 2. Sin transporte declarado no se emite nada

Una troncal sin `transport` genera exactamente el mismo texto que antes de este cambio. Así las que
ya están dadas de alta siguen funcionando igual y el fichero generado no cambia ni un byte, que es
lo que promete el escenario de "los ficheros generados son desechables".

Declarar `udp` explícitamente sí emite la línea. Es la diferencia entre "no lo he pensado" y "lo he
elegido", y no cuesta nada distinguirlas.

### 3. Se dice por los dos sitios: la línea `transport=` y el parámetro de la URI

```
[eleven]
type=endpoint
transport=transport-tcp          ← qué transporte LOCAL usa para salir

[eleven]
type=aor
contact=sip:host:5060\;transport=tcp   ← qué protocolo pide la URI de destino
```

Los dos dicen cosas distintas y los dos hacen falta: el primero elige el socket de salida, el
segundo es lo que manda al resolver la URI según el RFC 3263. Ponerlo solo en uno funciona a veces,
según cómo resuelva el destino, y "a veces" es lo que no queremos en la pieza que acaba de costar
una tarde de diagnóstico.

### 4. El punto y coma va escapado, y esto es una trampa de Asterisk

En un fichero de configuración de Asterisk **el `;` abre un comentario**. Un
`contact=sip:host;transport=tcp` sin escapar se lee como `contact=sip:host` y el resto se tira en
silencio: la configuración carga sin quejarse y el transporte no se aplica.

Se escribe `\;`. Es exactamente la clase de fallo que este proyecto no admite —cargar bien y hacer
otra cosa— así que lo cubre un test sobre el texto generado.

### 5. La columna se migra con `PRAGMA table_info`, como la de `calls`

`ALTER TABLE trunks ADD COLUMN transport TEXT`, preguntando antes por las columnas. No un
`try/catch` alrededor del ALTER: ese catch se traga también una base corrupta o sin permisos y deja
el motor escribiendo contra una tabla que no es la que cree. Es la misma decisión que ya se tomó
para `calls.flow_version`, y ahora hay dos sitios que la necesitan, así que sale a un helper.

### 6. El transporte y el modo de autenticación son ejes independientes

`register`/`identify` dice **cómo te autenticas**; `udp`/`tcp` dice **por dónde hablas**. Las cuatro
combinaciones son legítimas: registrarte por TCP, o que te reconozcan por IP sobre UDP. Por eso son
dos campos y no un solo desplegable con cuatro opciones.

## Risks / Trade-offs

**[Un proveedor que se atragante con el parámetro de la URI]** → Existe, y por eso queda escrito
dónde está el knob: la decisión 3 dice qué hace cada mitad, así que quitar una es un cambio de una
línea con el porqué delante.

**[TLS sigue sin poderse pedir]** → Es lo que su NAPTR prefiere, así que va a hacer falta. Queda
fuera a propósito porque necesita CA y verificación, y TCP es lo que está probado que contesta.

**[Las troncales existentes se quedan sin transporte]** → Es la verdad: se dieron de alta cuando
solo había UDP. No se les inventa uno, igual que no se les inventó una versión a las llamadas
anteriores a `flow-versions`.

## Migration Plan

**Fase 1 — la configuración de Asterisk.** `[transport-tcp]` en `pjsip.conf`.

**Fase 2 — el motor.** El campo, el generador, la columna con su migración, y la validación.

**Fase 3 — el editor.** El selector.

**Rollback:** el fichero generado vuelve a no llevar `transport=` y Asterisk vuelve a UDP. La
columna se queda en la base sin que nadie la lea, que es lo mismo que hacía antes de existir.

## Open Questions

Ninguna que bloquee.

- `ponytail:` TLS es el siguiente, y crece en el mismo campo: un valor más y una sección más en
  `pjsip.conf`, con la ruta de las CA.
