#!/usr/bin/env bash
set -euo pipefail

# Start the Rockpool Root VM.
# Detects the platform and uses Tart (macOS) or QEMU/KVM (Linux).
# Waits for SSH to become available before returning.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SSH_KEY="${ROOT_DIR}/images/root-vm/keys/rockpool-root-vm_ed25519"
PLATFORM="$(uname -s)"

ROOT_VM_MEMORY="${ROOT_VM_MEMORY:-8G}"
ROOT_VM_CPUS="${ROOT_VM_CPUS:-4}"
ROOT_VM_SSH_PORT="${ROOT_VM_SSH_PORT:-2222}"
SSH_WAIT_TIMEOUT="${SSH_WAIT_TIMEOUT:-120}"
TART_VM_NAME="${TART_VM_NAME:-rockpool-root}"

usage() {
  echo "Usage: $0"
  echo ""
  echo "Starts the Rockpool Root VM (Tart on macOS, QEMU/KVM on Linux)."
  echo ""
  echo "Environment variables:"
  echo "  ROOT_VM_MEMORY    VM memory (default: 8G) [Linux only]"
  echo "  ROOT_VM_CPUS      VM CPU count (default: 4) [Linux only]"
  echo "  ROOT_VM_SSH_PORT  Host port for SSH forwarding (default: 2222) [Linux only]"
  echo "  SSH_WAIT_TIMEOUT  Seconds to wait for SSH (default: 120)"
  echo "  TART_VM_NAME      Tart VM name (default: rockpool-root) [macOS only]"
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

if [ ! -f "$SSH_KEY" ]; then
  echo "ERROR: SSH key not found at ${SSH_KEY}"
  echo "Generate with: ssh-keygen -t ed25519 -f images/root-vm/keys/rockpool-root-vm_ed25519 -N '' -C 'rockpool-root-vm'"
  exit 1
fi

wait_for_ssh() {
  local host="$1"
  local port="$2"
  local timeout="$3"

  echo "Waiting for SSH to become available..."
  local elapsed=0
  while [ "$elapsed" -lt "$timeout" ]; do
    if ssh -q \
      -i "$SSH_KEY" \
      -p "$port" \
      -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null \
      -o ConnectTimeout=2 \
      -o LogLevel=ERROR \
      "admin@${host}" \
      'true' 2>/dev/null; then
      echo ""
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
    printf "."
  done

  echo ""
  return 1
}

# ---------------------------------------------------------------------------
# macOS / Tart
# ---------------------------------------------------------------------------
start_tart() {
  if ! command -v tart &>/dev/null; then
    echo "ERROR: tart is not installed."
    echo "Install with: brew install cirruslabs/cli/tart"
    exit 1
  fi

  if ! tart list 2>/dev/null | awk 'NR>1 {print $2}' | grep -qx "$TART_VM_NAME"; then
    echo "ERROR: Tart VM '${TART_VM_NAME}' not found."
    echo ""
    echo "Build it with:"
    echo "  images/root-vm/build-root-vm-tart.sh"
    exit 1
  fi

  local vm_state
  vm_state=$(tart list 2>/dev/null | awk -v name="$TART_VM_NAME" '$2 == name {print $NF}')

  if [ "$vm_state" = "running" ]; then
    local vm_ip
    vm_ip=$(tart ip "$TART_VM_NAME" 2>/dev/null || true)
    echo "Root VM is already running."
    echo "  IP:  ${vm_ip:-unknown}"
    echo "  SSH: ssh -i ${SSH_KEY} admin@${vm_ip:-<vm-ip>}"
    exit 0
  fi

  echo "Starting Root VM via Tart (${TART_VM_NAME})..."
  tart run "$TART_VM_NAME" \
    --no-graphics \
    --dir="rockpool:${ROOT_DIR}:tag=rockpool" &

  echo "Waiting for VM IP address..."
  local vm_ip=""
  local elapsed=0
  while [ "$elapsed" -lt "$SSH_WAIT_TIMEOUT" ]; do
    vm_ip=$(tart ip "$TART_VM_NAME" 2>/dev/null || true)
    if [ -n "$vm_ip" ]; then
      break
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done

  if [ -z "$vm_ip" ]; then
    echo "ERROR: Could not get VM IP within ${SSH_WAIT_TIMEOUT} seconds."
    exit 1
  fi

  echo "VM IP: ${vm_ip}"

  if wait_for_ssh "$vm_ip" 22 "$SSH_WAIT_TIMEOUT"; then
    echo "=== Mounting project directory ==="
    ssh -q \
      -i "$SSH_KEY" \
      -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null \
      -o LogLevel=ERROR \
      "admin@${vm_ip}" \
      'mountpoint -q /mnt/rockpool 2>/dev/null || sudo mount -t virtiofs rockpool /mnt/rockpool' 2>/dev/null || true

    echo ""
    echo "Root VM is ready."
    echo ""
    echo "  VM IP:  ${vm_ip}"
    echo "  SSH:    ssh -i ${SSH_KEY} admin@${vm_ip}"
    echo "  Short:  npm run ssh:vm"
    echo "  Logs:   npm run vm:logs"
    echo "  Stop:   npm run stop:vm"
    echo ""
    echo "  Services (on VM IP):"
    echo "    http://${vm_ip}:8080  (dev srv0)"
    echo "    http://${vm_ip}:8081  (dev srv1)"
    echo "    http://${vm_ip}:8082  (dev srv2)"
    echo "    http://${vm_ip}:9080  (test srv0)"
    echo "    http://${vm_ip}:9081  (test srv1)"
    echo "    http://${vm_ip}:9082  (test srv2)"
    echo ""
    exit 0
  fi

  echo "ERROR: SSH did not become available within ${SSH_WAIT_TIMEOUT} seconds."
  echo ""
  echo "Try SSH manually:"
  echo "  ssh -i ${SSH_KEY} -o StrictHostKeyChecking=no admin@${vm_ip}"
  exit 1
}

# ---------------------------------------------------------------------------
# Linux / QEMU-KVM
# ---------------------------------------------------------------------------
start_qemu() {
  local QEMU_DIR="${ROOT_DIR}/.qemu"
  local QCOW2_IMAGE="${QEMU_DIR}/rockpool-root.qcow2"
  local PID_FILE="${QEMU_DIR}/rockpool-root.pid"
  local VIRTIOFSD_PID_FILE="${QEMU_DIR}/virtiofsd.pid"
  local VIRTIOFSD_SOCK="${QEMU_DIR}/virtiofsd.sock"
  local SERIAL_LOG="${QEMU_DIR}/serial.log"

  if ! command -v qemu-system-x86_64 &>/dev/null; then
    echo "ERROR: qemu-system-x86_64 is not installed."
    echo "Install with: sudo apt install qemu-system-x86"
    exit 1
  fi

  if [ ! -r /dev/kvm ] || [ ! -w /dev/kvm ]; then
    echo "ERROR: /dev/kvm is not accessible."
    echo "Ensure KVM is available and your user has access:"
    echo "  sudo usermod -aG kvm \$USER"
    echo "  (log out and back in)"
    exit 1
  fi

  local VMLINUZ="${QEMU_DIR}/vmlinuz"
  local INITRD="${QEMU_DIR}/initrd.img"

  if [ ! -f "$QCOW2_IMAGE" ]; then
    echo "ERROR: Root VM image not found at ${QCOW2_IMAGE}"
    echo ""
    echo "Build it with:"
    echo "  make .stamps/rockpool-root-vm"
    exit 1
  fi

  if [ ! -f "$VMLINUZ" ] || [ ! -f "$INITRD" ]; then
    echo "ERROR: Kernel or initrd not found."
    echo "  Expected: ${VMLINUZ}"
    echo "  Expected: ${INITRD}"
    echo ""
    echo "Rebuild with: make .stamps/rockpool-root-vm"
    exit 1
  fi

  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "Root VM is already running (PID $(cat "$PID_FILE"))."
    echo "SSH:  ssh -i ${SSH_KEY} -p ${ROOT_VM_SSH_PORT} admin@localhost"
    exit 0
  fi

  mkdir -p "$QEMU_DIR"
  rm -f "$VIRTIOFSD_SOCK"

  local VIRTIOFSD_BIN
  if command -v virtiofsd &>/dev/null; then
    VIRTIOFSD_BIN="virtiofsd"
  elif [ -f /usr/libexec/virtiofsd ]; then
    VIRTIOFSD_BIN="/usr/libexec/virtiofsd"
  elif [ -f /usr/lib/qemu/virtiofsd ]; then
    VIRTIOFSD_BIN="/usr/lib/qemu/virtiofsd"
  else
    echo "ERROR: virtiofsd is not installed."
    echo "Install with: sudo apt install virtiofsd"
    exit 1
  fi

  echo "Starting virtiofsd for ${ROOT_DIR}..."
  $VIRTIOFSD_BIN \
    --socket-path="$VIRTIOFSD_SOCK" \
    --shared-dir="$ROOT_DIR" \
    --cache=auto \
    --announce-submounts \
    --sandbox=namespace &
  local VIRTIOFSD_PID=$!
  echo "$VIRTIOFSD_PID" > "$VIRTIOFSD_PID_FILE"

  for _ in $(seq 1 20); do
    [ -S "$VIRTIOFSD_SOCK" ] && break
    sleep 0.25
  done

  if [ ! -S "$VIRTIOFSD_SOCK" ]; then
    echo "ERROR: virtiofsd socket not created after 5 seconds."
    kill "$VIRTIOFSD_PID" 2>/dev/null || true
    rm -f "$VIRTIOFSD_PID_FILE"
    exit 1
  fi

  echo "Starting QEMU/KVM (${ROOT_VM_CPUS} CPUs, ${ROOT_VM_MEMORY} RAM)..."
  qemu-system-x86_64 \
    -enable-kvm \
    -cpu host \
    -m "$ROOT_VM_MEMORY" \
    -smp "$ROOT_VM_CPUS" \
    -kernel "$VMLINUZ" \
    -initrd "$INITRD" \
    -append "root=/dev/vda rw console=ttyS0,115200n8 rootwait" \
    -drive file="$QCOW2_IMAGE",format=qcow2,if=virtio \
    -object memory-backend-memfd,id=mem,size="$ROOT_VM_MEMORY",share=on \
    -numa node,memdev=mem \
    -chardev socket,id=char-virtiofs,path="$VIRTIOFSD_SOCK" \
    -device vhost-user-fs-pci,chardev=char-virtiofs,tag=rockpool \
    -device virtio-net-pci,netdev=net0 \
    -netdev "user,id=net0,hostfwd=tcp::${ROOT_VM_SSH_PORT}-:22,hostfwd=tcp::8080-:8080,hostfwd=tcp::8081-:8081,hostfwd=tcp::8082-:8082,hostfwd=tcp::9080-:9080,hostfwd=tcp::9081-:9081,hostfwd=tcp::9082-:9082,hostfwd=tcp::9324-:9324,hostfwd=tcp::9424-:9424" \
    -serial file:"$SERIAL_LOG" \
    -monitor unix:"${QEMU_DIR}/qemu-monitor.sock",server,nowait \
    -display none \
    -daemonize \
    -pidfile "$PID_FILE"

  if [ ! -f "$PID_FILE" ]; then
    echo "ERROR: QEMU failed to start (no PID file created)."
    echo "Check serial log: ${SERIAL_LOG}"
    kill "$VIRTIOFSD_PID" 2>/dev/null || true
    rm -f "$VIRTIOFSD_PID_FILE"
    exit 1
  fi

  echo "QEMU started (PID $(cat "$PID_FILE"))."

  if wait_for_ssh "localhost" "$ROOT_VM_SSH_PORT" "$SSH_WAIT_TIMEOUT"; then
    echo "Root VM is ready."
    echo ""
    echo "  SSH:    ssh -i ${SSH_KEY} -p ${ROOT_VM_SSH_PORT} admin@localhost"
    echo "  Short:  npm run ssh:vm"
    echo "  Logs:   npm run vm:logs"
    echo "  Stop:   npm run stop:vm"
    echo ""
    echo "  Forwarded ports:"
    echo "    8080 -> VM:8080 (dev srv0)"
    echo "    8081 -> VM:8081 (dev srv1)"
    echo "    8082 -> VM:8082 (dev srv2)"
    echo "    9080 -> VM:9080 (test srv0)"
    echo "    9081 -> VM:9081 (test srv1)"
    echo "    9082 -> VM:9082 (test srv2)"
    echo "    ${ROOT_VM_SSH_PORT} -> VM:22 (SSH)"
    echo ""
    echo "  Serial log: ${SERIAL_LOG}"
    exit 0
  fi

  echo "ERROR: SSH did not become available within ${SSH_WAIT_TIMEOUT} seconds."
  echo "The VM may still be booting. Check the serial log:"
  echo "  tail -f ${SERIAL_LOG}"
  echo ""
  echo "Try SSH manually:"
  echo "  ssh -i ${SSH_KEY} -p ${ROOT_VM_SSH_PORT} -o StrictHostKeyChecking=no admin@localhost"
  exit 1
}

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------
case "$PLATFORM" in
  Darwin)
    start_tart
    ;;
  Linux)
    start_qemu
    ;;
  *)
    echo "ERROR: Unsupported platform: ${PLATFORM}"
    echo "Rockpool Root VM supports macOS (Tart) and Linux (QEMU/KVM)."
    exit 1
    ;;
esac
