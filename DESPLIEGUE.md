# De un número de Twilio al agente de Eleven

Alguien marca tu número, Twilio te entrega la llamada, Janus decide qué hacer con
ella y la conecta con el agente. Cuando el agente cuelga, el control vuelve al flujo.

```
quien llama ──► Twilio ──► tu droplet ──► Janus ──► Eleven
   PSTN      Elastic SIP   Asterisk      el flujo   SIP · TCP
              Trunking       :5060
```

Son **dos troncales distintas**, no una. Twilio te trae la llamada; Eleven es a
quien llamas tú.

---

## 1 · El script · *en el droplet*

Un Ubuntu limpio y un comando.

```bash
ssh root@TU_IP
git clone https://github.com/JVillotaMa/Janus.git janus && cd janus
sudo ./install.sh
```

Al terminar imprime la URL, el usuario y la contraseña, y los deja en
`/root/janus-acceso.txt`.

> **Clona en `janus`, con el nombre que dice el comando.** El repositorio en
> GitHub se llama `Janus` y un `git clone` sin destino crea `/root/Janus`. Si
> acabas con los dos directorios, el servicio corre en uno y tú miras el otro:
> `pnpm calls` te dirá que no hay llamadas mientras la interfaz te las enseña.

> **El droplet clona lo que esté publicado.** Si `install.sh` o cualquier cambio
> siguen sin commitear, ahí no llegan.

Deja hecho:

| | detalle que importa |
|---|---|
| Swap de 2 GB | sin él, `pnpm install` muere por memoria |
| El motor | `--prod`: tres paquetes, sin compilador |
| El editor construido | **aquí**, contra este mismo `src/` |
| Asterisk | `--restart unless-stopped`: vuelve al reiniciar |
| El motor como servicio | `Restart=always`, que es el reintento que no tiene |
| Cortafuegos | 22, 80, 443 y el RTP. El 3000 nunca |
| HTTPS con contraseña | certificado real, sin registrar dominio |

**Protegido por defecto, y es literal.** No existe la secuencia que deja la caja
funcionando y abierta: la contraseña la genera el script y sin ella no escribe la
configuración de Caddy. Antes de darse por terminado comprueba que la API no
responde sin credenciales; si respondiera, falla en rojo.

La contraseña cubre el sitio entero, `/api` incluida: el navegador la reenvía
sola en cada petición del mismo origen, así que la interfaz funciona sin hacer
nada y un `curl` pelado se queda en un `401` sin llegar a Janus.

**La URL sale de tu propia IP.** `67.205.154.32` → `https://67-205-154-32.sslip.io`.
Ese dominio resuelve cualquier IP escrita con guiones, así que hay certificado de
Let's Encrypt sin comprar nada. Janus sigue escuchando solo en `127.0.0.1`: quien
sale a internet es Caddy. Reserva la IP en DigitalOcean — si la pierdes, cambia el
nombre entero, porque el nombre *es* la IP.

---

## 2 · El número y el trunk · *en Twilio*

El producto es **Elastic SIP Trunking**, no Programmable Voice. Con Programmable
Voice, Twilio te pide un TwiML y decide él; con Elastic SIP Trunking te entrega la
llamada por SIP y decide Janus.

1. Compra un número con capacidad de voz.
2. Crea un trunk en Elastic SIP Trunking.
3. En **Origination**, añade la URI de tu droplet: `sip:TU_IP:5060`
4. En **Numbers**, asocia el número a ese trunk.
5. Anota los rangos de IP de **señalización** de tu región. Para **US1**:

```
54.172.60.0/30    North America Virginia — el tuyo
54.244.51.0/30    North America Oregon — su failover
```

> Si cambias de droplet, **actualiza la Origination URI**. Apuntando a la IP
> vieja, las llamadas se quedan en «calling» para siempre.

---

## 3 · Abrir el 5060 a Twilio · *en el droplet*

El script deja el 5060 cerrado si no le dices desde dónde abrirlo.

```bash
sudo ./install.sh 54.172.60.0/30,54.244.51.0/30    # relanzarlo, conserva la contraseña

# o solo la regla:
ufw allow from 54.172.60.0/30 to any port 5060
ufw allow from 54.244.51.0/30 to any port 5060
```

> **Los dos rangos, no solo el tuyo.** El tráfico real puede entrar por Oregon
> aunque tu región sea Virginia. Con solo uno funciona hasta que Twilio conmuta, y
> entonces pierdes llamadas **de forma intermitente**, que es el fallo más caro de
> diagnosticar que existe.

> Relanzar el script **reescribe las reglas del cortafuegos**: si lo haces sin
> pasarle los rangos, el 5060 se cierra y las llamadas dejan de entrar.

---

## 4 · Las dos troncales · *en el editor*

Desde el nodo de entrada o desde un nodo de llamada: **+ nueva troncal**.

### Twilio — la que te trae la llamada

| campo | valor |
|---|---|
| Nombre de la troncal | `twilio` |
| Host del proveedor | `<tu-trunk>.pstn.twilio.com` — **solo el nombre**, sin `;transport=` |
| Por qué protocolo habla | UDP |
| Cómo te autentica | **Por IP de origen** |
| IP del proveedor | `54.172.60.0/30,54.244.51.0/30` |

Twilio no se registra contra ti ni se autentica: te manda el `INVITE` y punto.
Reconocerlo por su IP **es** su autenticación.

### Eleven — a quien llamas

| campo | valor |
|---|---|
| Nombre de la troncal | `elevenlabs` |
| Host del proveedor | `sip.rtc.elevenlabs.io:5060` |
| Por qué protocolo habla | **TCP** — por UDP no contestan |
| Cómo te autentica | Con usuario y contraseña (registro) |

Eliges «registro» aunque Eleven rechace el registro con un `405`: es lo único que
genera el `outbound_auth` que resuelve el `407` de su `INVITE`, que es lo que de
verdad hace falta. El precio es ese `405` en el log cada minuto.

---

## 5 · El flujo · *en el editor*

```
Entrada          troncal: twilio
   ↓
Reproducir       tu audio de bienvenida
   ↓
Llamar           por una troncal → elevenlabs → <id del agente>
   ↓ (si no)
Colgar
```

El destino se elige con el formulario: **por una troncal**, el identificador del
agente a la izquierda y `elevenlabs` en el desplegable.

La arista que sale del nodo de llamada es donde ocurre el handback: cuando el
agente cuelga, el flujo **sigue**. Puedes ramificar por `dial = answered`.

**El número marcado llega al flujo** como `did`, así que con dos números
apuntando al mismo trunk ramificas nada más entrar y cada uno va a un agente
distinto, sin tocar nada de Asterisk.

---

## 6 · La prueba · *en el droplet*

```bash
docker exec asterisk asterisk -rx "pjsip show endpoints"    # ¿están las dos?
docker exec asterisk asterisk -rx "pjsip show identifies"   # ¿reconoce a Twilio?
docker exec asterisk asterisk -rx "pjsip set logger on"

# llama al número desde tu móvil
docker logs -f asterisk | grep -E "Called|^INVITE|^SIP/2\.0 [0-9]{3}"

cd /root/janus && pnpm calls 5      # qué decidió el flujo
```

### Qué significa lo que salga mal

| síntoma | qué es | dónde se arregla |
|---|---|---|
| No llega ningún `INVITE` | Twilio no te alcanza | La Origination URI, o el 5060 |
| Llegan y **Asterisk no responde nada** | los tira el cortafuegos | falta un rango — mira de qué IP vienen |
| `404 Not Found` | ninguna extensión casa con el número | el patrón del dialplan |
| `401` / `403` al entrar | no reconoce a Twilio, lo trata como anónimo | los rangos del `identify` |
| `488` | no hay códec en común | no debería pasar: se ofrecen alaw y ulaw |
| Entra y cuelga al instante | el flujo no encuentra por dónde seguir | `pnpm calls` — busca `!dead-end` |
| Conecta y no se oye nada | el RTP no llega | el rango `10000:20000/udp` |
| Se oye en un solo sentido | el otro extremo pone el audio en otra IP | `rtp_symmetric=yes`, que Janus no genera |
| `200 OK` y hablas con el agente | — | ya está |

### Si algo no cuadra con lo que ves

```bash
docker exec asterisk asterisk -rx "ari show apps"     # ¿sale `janus`?
docker exec asterisk asterisk -rx "pjsip show transports"
systemctl status janus
```

- **`ari show apps` sin `janus`**: el motor no está conectado. Cada llamada
  contesta y se muere al instante, y en Eleven no hay ni rastro.
- **`pjsip show transports` vacío**: la configuración de PJSIP no ha cargado. Mira
  `docker logs asterisk | grep -i pjsip`.
- **Cambiaste algo en `src/`**: `systemctl restart janus`. El dialplan se recarga
  con `dialplan reload`, pero el motor no relee su código solo.

---

## 7 · Lo que la contraseña no cubre

El script deja la puerta bien puesta: HTTPS, contraseña sobre todo el sitio, el
3000 cerrado, el 5060 solo para Twilio. Eso decide **quién entra**.

No decide **qué puede hacer** quien ya está dentro — y lo que puede hacer es
republicar el flujo, es decir, redirigir las llamadas a cualquier número. Con
Termination activada, eso se factura.

**El repositorio es público y lleva contraseñas dentro.** Las extensiones del
laboratorio están commiteadas con la suya: `jaime`, `ana` y el `janus/janus` de
ARI. Hoy no son alcanzables —el 5060 solo acepta a Twilio y ARI escucha en
`127.0.0.1`— y aunque alguien las usara, el contexto de `jaime` solo permite
marcar la extensión `100`. Aun así, en el droplet no hay ningún softphone que
registrar: borra esas dos secciones de `asterisk-config/etc/pjsip.conf`.

Dos cosas más que cuestan poco:

- **Una contraseña por caja.** El script ya la genera distinta en cada una.
- **Reserva la IP** en DigitalOcean. La URL *es* la IP.

Y queda anotado: una lista de prefijos permitidos y un tope de llamadas, en el
motor, es lo único que convierte una contraseña robada en un susto en vez de una
factura.

---

Los rangos de IP de Twilio y el direccionamiento de los agentes de Eleven
cámbialos por lo que digan sus documentaciones: son suyos y se mueven.
