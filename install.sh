#!/usr/bin/env bash
#
# Deja una caja lista para atender llamadas: Asterisk, el motor, el editor
# servido por HTTPS con contraseña, y el cortafuegos cerrado.
#
#   sudo ./install.sh                      sin troncal de operador todavía
#   sudo ./install.sh 54.172.60.0/30,...   con los rangos SIP del operador
#
# Es un solo camino a propósito: no hay forma de acabar con la caja funcionando
# y sin contraseña, porque la contraseña se genera aquí y sin ella no se escribe
# la configuración de Caddy.
#
# Se puede volver a ejecutar. No toca `janus.db` ni los audios subidos, pero
# REESCRIBE las reglas del cortafuegos: si lo relanzas sin pasarle los rangos del
# operador, el 5060 se queda cerrado y las llamadas dejan de entrar.

set -euo pipefail

TRUNK_IPS="${1:-}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SECRETO="/root/janus-acceso.txt"

paso() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '   \033[32m✓\033[0m %s\n' "$*"; }
aviso(){ printf '   \033[33m!\033[0m %s\n' "$*"; }
morir(){ printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || morir "Ejecuta esto como root: sudo ./install.sh"
[ -f "$REPO/package.json" ] || morir "No parece el repositorio de Janus: falta package.json"

# ── swap ─────────────────────────────────────────────────────────────────────
# Sin swap, `pnpm install` mata la máquina en un droplet pequeño. Ya pasó.
paso "Swap"
if [ "$(swapon --show --noheadings | wc -l)" -gt 0 ]; then
  ok "ya hay swap"
else
  fallocate -l 2G /swapfile && chmod 600 /swapfile
  mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ok "2 GB de swap"
fi

# ── paquetes ─────────────────────────────────────────────────────────────────
paso "Paquetes del sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq docker.io curl ufw ffmpeg debian-keyring debian-archive-keyring \
  apt-transport-https gnupg >/dev/null
ok "docker, ffmpeg, ufw"

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs >/dev/null
fi
command -v pnpm >/dev/null || npm i -g pnpm >/dev/null 2>&1
ok "node $(node -v), pnpm $(pnpm --version)"

if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi
ok "caddy $(caddy version | head -1)"

# ── el motor ─────────────────────────────────────────────────────────────────
# --prod: el motor solo usa tres paquetes y ejecuta el TypeScript por borrado de
# tipos, así que el compilador de 27 MB no pinta nada aquí.
paso "El motor"
cd "$REPO"
pnpm install --prod
ok "3 dependencias, sin compilador"

# ── el editor ────────────────────────────────────────────────────────────────
# Se construye AQUÍ y no en otra máquina: importa `src/schema.ts` del árbol donde
# se compila, así que construirlo fuera haría que el formulario ofreciera un
# vocabulario distinto del que el motor valida.
paso "El editor"
npm --prefix ui install --silent
npm --prefix ui run build >/dev/null
[ -f "$REPO/ui/dist/index.html" ] || morir "El editor no se construyó: falta ui/dist/index.html"
ok "construido contra este mismo código"

# ── audios de Asterisk ───────────────────────────────────────────────────────
paso "Audios de Asterisk"
if [ -f "$REPO/asterisk-config/sounds/en/hello-world.gsm" ]; then
  ok "ya estaban"
else
  mkdir -p "$REPO/asterisk-config/sounds/en"
  curl -fsSL https://downloads.asterisk.org/pub/telephony/sounds/asterisk-core-sounds-en-gsm-current.tar.gz \
    | tar -xz -C "$REPO/asterisk-config/sounds/en"
  ok "descargados"
fi

# ── Asterisk ─────────────────────────────────────────────────────────────────
# `--restart unless-stopped` y no `--rm`: con --rm, un reinicio de la máquina te
# deja sin Asterisk y sin que nadie lo levante.
paso "Asterisk"
docker rm -f asterisk >/dev/null 2>&1 || true
docker run -d --restart unless-stopped --name asterisk --network host \
  -v "$REPO/asterisk-config/etc:/etc/asterisk" \
  -v "$REPO/asterisk-config/sounds:/var/lib/asterisk/sounds" \
  andrius/asterisk >/dev/null
ok "levantado, y se levanta solo al reiniciar"

# El motor corre como root y Asterisk, dentro del contenedor, NO. Un fichero
# `root:root 0600` no lo puede leer, y Asterisk reporta un fichero ilegible
# EXACTAMENTE igual que uno que no existe —«listed as a #include but it does not
# exist»— asi que el sintoma no apunta a los permisos por ninguna parte.
#
# Se crea aqui con el dueno correcto: Node solo aplica el modo al CREAR, asi que
# el motor lo reescribe en cada cambio de troncal y la propiedad sobrevive.
GENERADO="$REPO/asterisk-config/etc/pjsip_janus.conf"
for _ in $(seq 15); do docker exec asterisk true 2>/dev/null && break; sleep 1; done
UID_AST="$(docker exec asterisk id -u asterisk 2>/dev/null || echo 0)"
[ -f "$GENERADO" ] || printf '; generado por Janus\n' > "$GENERADO"
chown "$UID_AST" "$GENERADO"
chmod 600 "$GENERADO"
ok "pjsip_janus.conf legible por Asterisk (uid $UID_AST)"

# El motor corre como root y Asterisk, dentro del contenedor, NO. Un fichero
# `root:root 0600` no lo puede leer — y Asterisk reporta un fichero ilegible
# EXACTAMENTE igual que uno que no existe («listed as a #include but it does not
# exist»), asi que el sintoma no apunta a los permisos por ningun lado.
#
# Se crea aqui con el dueno correcto. `writeFileSync` solo aplica el modo al
# crear, asi que el motor lo reescribe mil veces y la propiedad sobrevive.
GENERADO="$REPO/asterisk-config/etc/pjsip_janus.conf"
for i in $(seq 15); do docker exec asterisk true 2>/dev/null && break; sleep 1; done
UID_AST="$(docker exec asterisk id -u asterisk 2>/dev/null || echo 0)"
[ -f "$GENERADO" ] || printf '; generado por Janus\n' > "$GENERADO"
chown "$UID_AST" "$GENERADO" && chmod 600 "$GENERADO"
ok "pjsip_janus.conf legible por Asterisk (uid $UID_AST)"

# ── el motor como servicio ───────────────────────────────────────────────────
# `Restart=always` ES el reintento que el motor no tiene: hace `await ari.connect`
# al arrancar sin red de seguridad, así que si Asterisk aún no está, muere y
# systemd lo vuelve a levantar hasta que responda.
paso "El motor como servicio"
cat > /etc/systemd/system/janus.service <<UNIT
[Unit]
Description=Janus
After=docker.service network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=$REPO
ExecStart=$(command -v node) src/main.ts
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now janus >/dev/null 2>&1
ok "janus.service"

# ── cortafuegos ──────────────────────────────────────────────────────────────
# El 22 se permite ANTES de activar nada, o te quedas fuera de tu propia máquina.
paso "Cortafuegos"
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null                 # solo para que Let's Encrypt valide
ufw allow 443/tcp >/dev/null
ufw allow 10000:20000/udp >/dev/null        # el RTP, segun rtp.conf
if [ -n "$TRUNK_IPS" ]; then
  IFS=',' read -ra RANGOS <<< "$TRUNK_IPS"
  for r in "${RANGOS[@]}"; do ufw allow from "$r" to any port 5060 >/dev/null; done
  ok "SIP abierto solo desde: $TRUNK_IPS"
else
  aviso "SIP (5060) CERRADO: pásale los rangos del operador para abrirlo"
  aviso "   sudo ./install.sh 54.172.60.0/30,54.244.51.0/30"
fi
ufw --force enable >/dev/null
ok "22, 80, 443 y el RTP. El 3000 nunca se abre"

# ── HTTPS con contraseña ─────────────────────────────────────────────────────
# El nombre sale de la propia IP: sslip.io resuelve cualquier IP escrita con
# guiones, así que hay certificado de Let's Encrypt sin registrar ningún dominio.
paso "HTTPS con contraseña"
IP="$(curl -fsS --max-time 10 https://ifconfig.me)" || morir "No se pudo averiguar la IP pública"
HOST="${IP//./-}.sslip.io"

if [ -f "$SECRETO" ]; then
  PASS="$(grep -oP '^contrasena: \K.*' "$SECRETO")"
  aviso "reutilizando la contraseña de $SECRETO"
else
  PASS="$(openssl rand -base64 18)"
fi

HASH="$(caddy hash-password --plaintext "$PASS")"
case "$HASH" in
  \$2a\$*|\$2b\$*|\$2y\$*) ;;
  *) morir "caddy hash-password no devolvió un hash válido: '$HASH'" ;;
esac

cat > /etc/caddy/Caddyfile <<CADDY
# Generado por install.sh. La contraseña cubre TODO el sitio, y eso incluye
# /api: el navegador reenvía las credenciales solo en cada peticion del mismo
# origen, asi que la UI funciona sin hacer nada y un curl sin credenciales se
# queda en un 401 sin llegar a Janus.
#
# Janus sigue escuchando solo en 127.0.0.1. Quien sale a internet es Caddy.
$HOST {
    basic_auth {
        janus $HASH
    }
    reverse_proxy 127.0.0.1:3000
}
CADDY
caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1 \
  || morir "El Caddyfile generado no es válido. Con Caddy anterior a 2.8 la directiva se llama 'basicauth' y no 'basic_auth'"
systemctl reload caddy 2>/dev/null || systemctl restart caddy
umask 077; printf 'url: https://%s\nusuario: janus\ncontrasena: %s\n' "$HOST" "$PASS" > "$SECRETO"
ok "$HOST"

# ── comprobar ────────────────────────────────────────────────────────────────
paso "Comprobando"
for i in $(seq 30); do
  curl -fsS --max-time 2 http://127.0.0.1:3000/api/flow >/dev/null 2>&1 && break
  [ "$i" -eq 30 ] && morir "El motor no responde. Mira: journalctl -u janus -n 50"
  sleep 2
done
ok "el motor responde"

# Esto es lo que habria cazado el fallo de los permisos: el motor puede responder
# perfectamente mientras Asterisk no ha cargado ni un objeto de su configuracion.
TRANSPORTES="$(docker exec asterisk asterisk -rx 'pjsip show transports' 2>/dev/null || true)"
case "$TRANSPORTES" in
  *"No objects found"*|"")
    morir "Asterisk no ha cargado su configuracion PJSIP. Mira: docker logs asterisk | grep -i pjsip" ;;
esac
ok "Asterisk ha cargado la configuracion PJSIP"

# Esto es lo que habria cazado el fallo de los permisos: el motor puede responder
# perfectamente mientras Asterisk no ha cargado ni un objeto de su configuracion.
TRANSPORTES="$(docker exec asterisk asterisk -rx 'pjsip show transports' 2>/dev/null || true)"
case "$TRANSPORTES" in
  *"No objects found"*|"") morir "Asterisk no ha cargado su configuracion PJSIP. Mira: docker logs asterisk | grep -i pjsip" ;;
esac
ok "Asterisk ha cargado la configuracion PJSIP"

curl -fsS --max-time 5 -o /dev/null "https://$HOST/" -u "janus:$PASS" \
  && ok "el editor responde por HTTPS con la contraseña" \
  || aviso "HTTPS aún no responde; el certificado puede tardar un minuto"

if curl -fsS --max-time 5 -o /dev/null "https://$HOST/api/flow" 2>/dev/null; then
  morir "LA API RESPONDE SIN CONTRASEÑA. Revisa /etc/caddy/Caddyfile antes de usar esto"
fi
ok "sin contraseña no se pasa, ni a la API"

# ── avisos ───────────────────────────────────────────────────────────────────
# Las extensiones del laboratorio llevan su contraseña commiteada, y el
# repositorio es publico. Hoy no son alcanzables —el 5060 solo acepta a Twilio—
# pero en una caja de produccion no hay ningun softphone que registrar.
if grep -q '^password=jaimeguapo' "$REPO/asterisk-config/etc/pjsip.conf" 2>/dev/null; then
  printf '\n'
  aviso "Las extensiones de laboratorio (jaime, ana) siguen con su contrasena"
  aviso "   commiteada en un repositorio publico. Aqui no hay softphone que"
  aviso "   registrar: borra esas dos secciones de asterisk-config/etc/pjsip.conf"
fi
if grep -q '^password=janus' "$REPO/asterisk-config/etc/ari.conf" 2>/dev/null; then
  aviso "ARI sigue con la contrasena de laboratorio. Solo escucha en 127.0.0.1,"
  aviso "   pero cambiala en asterisk-config/etc/ari.conf y en src/main.ts"
fi

printf '\n\033[1mListo.\033[0m\n\n'
printf '  https://%s\n  usuario: janus\n  contrasena: %s\n\n' "$HOST" "$PASS"
printf '  Guardado en %s\n' "$SECRETO"
printf '  Logs:  journalctl -u janus -f\n\n'
