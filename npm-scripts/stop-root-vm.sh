#!/usr/bin/env bash
set -euo pipefail

# Gracefully stop the Rockpool Root VM.
# Detects the platform and uses Tart (macOS) or QEMU/KVM PID-based shutdown (Linux).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PLATFORM="$(uname -s)"
TART_VM_NAME="${TART_VM_NAME:-rockpool-root}"

# ---------------------------------------------------------------------------
# macOS / Tart
# ---------------------------------------------------------------------------
stop_tart() {
  if ! command -v tart &>/dev/null; then
    echo "tart is not installed; nothing to stop."
    exit 0
  fi

  local vm_state
  vm_state=$(tart list 2>/dev/null | awk -v name="$TART_VM_NAME" '$2 == name {print $NF}')

  if [ "$vm_state" != "running" ]; then
    echo "Root VM is not running."
    exit 0
  fi

  echo "Stopping Root VM (${TART_VM_NAME}) via Tart..."
  tart stop "$TART_VM_NAME" --timeout 30

  echo "Root VM stopped."
}

# ---------------------------------------------------------------------------
# Linux / QEMU-KVM
# ---------------------------------------------------------------------------
stop_qemu() {
  local QEMU_DIR="${ROOT_DIR}/.qemu"
  local PID_FILE="${QEMU_DIR}/rockpool-root.pid"
  local VIRTIOFSD_PID_FILE="${QEMU_DIR}/virtiofsd.pid"
  local SSH_KEY="${ROOT_DIR}/images/root-vm/keys/rockpool-root-vm_ed25519"
  local SSH_PORT="${ROOT_VM_SSH_PORT:-2222}"

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
      local elapsed=0
      local pid
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
}

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------
case "$PLATFORM" in
  Darwin)
    stop_tart
    ;;
  Linux)
    stop_qemu
    ;;
  *)
    echo "ERROR: Unsupported platform: ${PLATFORM}"
    exit 1
    ;;
esac
