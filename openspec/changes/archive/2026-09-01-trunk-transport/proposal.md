## Why

Una troncal solo puede hablar por UDP, y hay proveedores que no lo atienden. Probado a mano contra
el SIP de Eleven desde esta misma máquina:

```
UDP 5060 :  SIN RESPUESTA en 6s
TCP 5060 :  CONTESTA -> SIP/2.0 200 OK
```

El resultado es el peor posible de diagnosticar: los `REGISTER` salen y no vuelve nada, así que
Asterisk reintenta cada 60 s sin decir por qué, y la troncal se queda muerta pareciendo un problema
de red, de NAT o de credenciales. Se tardan horas en llegar a que lo único que pasa es que el
paquete va por el protocolo que no es.

`pjsip.ts` no genera ninguna línea `transport=`, así que todo sale por el único transporte que
existe en la configuración: `[transport-udp]`. No hay forma de pedir otra cosa desde la UI.

## What Changes

**La configuración de Asterisk**

- `pjsip.conf` gana `[transport-tcp]` junto al `[transport-udp]` que ya había. Son constantes
  versionadas, como el `#include` y el contexto `[janus]`: el motor no las genera.

**El motor**

- `Trunk` gana `transport`: `udp` o `tcp`. Sin él, se comporta exactamente como hasta ahora.
- `pjsip.ts` emite `transport=` en el endpoint y en la registración, y el parámetro `transport` en
  las URIs. En un fichero de Asterisk el `;` abre un comentario, así que va escapado (`\;`).
- La tabla `trunks` gana la columna, con migración por `PRAGMA table_info` como la de `calls`.
- La API rechaza un transporte que no sea uno de los dos.

**El editor**

- Un selector más en el alta de troncal, al lado del modo de autenticación.

**Fuera de alcance** (deliberado, no olvidado)

- **TLS.** Su NAPTR lo prefiere y el 5061 está abierto, pero necesita configurar las CA del sistema
  y verificación de certificado, y eso son sus propias vueltas. TCP es lo que está probado que
  contesta y es lo que desbloquea hoy.
- WebSockets, IPv6, y elegir el puerto local de cada transporte.
- Un transporte por defecto distinto de UDP: cambiarlo reinterpretaría en silencio las troncales
  que ya están dadas de alta.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `trunk-provisioning`: una troncal pasa a declarar por qué protocolo habla, además de cómo se
  autentica. Son dos ejes independientes: se puede registrar por TCP o autenticar por IP sobre UDP.

## Impact

**Código**

| Fichero | Qué le pasa |
|---|---|
| `asterisk-config/etc/pjsip.conf` | `[transport-tcp]`, commiteado |
| `src/types.ts` | `Trunk.transport` |
| `src/pjsip.ts` | la línea `transport=` y el parámetro en las URIs, escapado |
| `src/store.ts` | columna `transport` con su migración |
| `src/server.ts` | valida el transporte |
| `ui/src/Trunks.jsx` | el selector en el alta |

**Datos**

`janus.db` se migra en caliente con `ALTER TABLE`. Una troncal ya dada de alta se queda sin
transporte, que es la verdad: se creó cuando solo había UDP y se sigue comportando igual.

**Dependencias**

Ninguna.
