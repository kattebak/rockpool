#!/usr/bin/env sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  SUDO="sudo"
else
  SUDO=""
fi

$SUDO apk update
$SUDO apk add --no-cache \
  bash \
  curl \
  wget \
  jq \
  git \
  openssh \
  make \
  build-base \
  python3 \
  py3-pip \
  nodejs \
  npm \
  ca-certificates \
  openssl \
  shadow \
  openrc

$SUDO rc-update add sshd default
$SUDO rc-service sshd start || true

if ! id -u tidepool >/dev/null 2>&1; then
  $SUDO useradd -m -s /bin/bash tidepool
fi

$SUDO mkdir -p /home/tidepool/workspace
$SUDO chown -R tidepool:tidepool /home/tidepool

if ! command -v code-server >/dev/null 2>&1; then
  curl -fsSL https://code-server.dev/install.sh | $SUDO sh
fi

$SUDO mkdir -p /etc/conf.d /etc/init.d

$SUDO tee /etc/conf.d/code-server >/dev/null <<'EOF'
CODE_SERVER_USER="tidepool"
CODE_SERVER_BIND="0.0.0.0:8080"
CODE_SERVER_AUTH="none"
CODE_SERVER_BASE_PATH="/workspace/${TIDEPOOL_WORKSPACE_NAME:-test}"
CODE_SERVER_ARGS="--disable-telemetry"
EOF

$SUDO tee /etc/init.d/code-server >/dev/null <<'EOF'
#!/sbin/openrc-run

name="code-server"
description="code-server IDE"

command="/usr/bin/code-server"
command_args="--bind-addr ${CODE_SERVER_BIND} --auth ${CODE_SERVER_AUTH} --abs-proxy-base-path ${CODE_SERVER_BASE_PATH} ${CODE_SERVER_ARGS}"
command_user="${CODE_SERVER_USER}"
command_background="yes"
pidfile="/var/run/${RC_SVCNAME}.pid"

output_log="/var/log/code-server.log"
error_log="/var/log/code-server.err"

start_pre() {
  checkpath -f -m 0644 -o root:root "$output_log" "$error_log"
}

depend() {
  need net
}
EOF

$SUDO chmod +x /etc/init.d/code-server
$SUDO rc-update add code-server default
$SUDO rc-service code-server start || true
