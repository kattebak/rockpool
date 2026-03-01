#!/usr/bin/env bash
set -euo pipefail

# Gracefully stop the Rockpool Root VM and virtiofsd daemon.
# Sends ACPI shutdown via SSH, falls back to SIGTERM/SIGKILL.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
QEMU_DIR="${ROOT_DIR}/.qemu"
PID_FILE="${QEMU_DIR}/rockpool-root.pid"
VIRTIOFSD_PID_FILE="${QEMU_DIR}/virtiofsd.pid"
SSH_KEY="${ROOT_DIR}/images/root-vm/keys/rockpool-root-vm_ed25519"
SSH_PORT="${ROOT_VM_SSH_PORT:-2222}"

stop_process() {
  local pid_file="$1"
  local name="$2"
  local timeout="${3:-30}"

  if [ ! -f "$pid_file" ]; then
    echo "${name} is not running (no PID file)."
    return 0
  fi

  local pid
  pid=$(cat "$pid_file")

  if ! kill -0 "$pid" 2>/dev/null; then
    echo "${name} is not running (stale PID file)."
    rm -f "$pid_file"
    return 0
  fi

  echo "Stopping ${name} (PID ${pid})..."
  kill "$pid" 2>/dev/null || true

  local elapsed=0
  while kill -0 "$pid" 2>/dev/null && [ "$elapsed" -lt "$timeout" ]; do
    sleep 1
    elapsed=$((elapsed + 1))
  done

  if kill -0 "$pid" 2>/dev/null; then
    echo "${name} did not stop after ${timeout}s, sending SIGKILL..."
    kill -9 "$pid" 2>/dev/null || true
    sleep 2
  fi

  rm -f "$pid_file"
  echo "${name} stopped."
}

try_graceful_shutdown() {
  if [ ! -f "$SSH_KEY" ]; then
    return 1
  fi

  ssh -q \
    -i "$SSH_KEY" \
    -p "$SSH_PORT" \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o ConnectTimeout=3 \
    -o LogLevel=ERROR \
    admin@localhost \
    'sudo poweroff' 2>/dev/null || return 1
}

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "Attempting graceful shutdown via SSH..."
  if try_graceful_shutdown; then
    echo "Shutdown command sent, waiting for VM to power off..."
    elapsed=0
    pid=$(cat "$PID_FILE")
    while kill -0 "$pid" 2>/dev/null && [ "$elapsed" -lt 30 ]; do
      sleep 1
      elapsed=$((elapsed + 1))
    done

    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$PID_FILE"
      echo "Root VM shut down gracefully."
    else
      echo "Graceful shutdown timed out, forcing stop..."
      stop_process "$PID_FILE" "Root VM" 5
    fi
  else
    echo "SSH shutdown failed, sending SIGTERM..."
    stop_process "$PID_FILE" "Root VM" 10
  fi
else
  echo "Root VM is not running."
  rm -f "$PID_FILE" 2>/dev/null || true
fi

stop_process "$VIRTIOFSD_PID_FILE" "virtiofsd" 5

rm -f "${QEMU_DIR}/virtiofsd.sock" "${QEMU_DIR}/qemu-monitor.sock" 2>/dev/null || true

echo "Root VM environment cleaned up."
