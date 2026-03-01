#!/usr/bin/env bash
set -euo pipefail

# Start the Rockpool Root VM using QEMU/KVM with virtiofs filesystem sharing.
# Forwards development ports (8080-8082) and test ports (9080-9082) to the host.
# Waits for SSH to become available before returning.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
QEMU_DIR="${ROOT_DIR}/.qemu"
QCOW2_IMAGE="${QEMU_DIR}/rockpool-root.qcow2"
PID_FILE="${QEMU_DIR}/rockpool-root.pid"
VIRTIOFSD_PID_FILE="${QEMU_DIR}/virtiofsd.pid"
VIRTIOFSD_SOCK="${QEMU_DIR}/virtiofsd.sock"
SERIAL_LOG="${QEMU_DIR}/serial.log"
SSH_KEY="${ROOT_DIR}/images/root-vm/keys/rockpool-root-vm_ed25519"

ROOT_VM_MEMORY="${ROOT_VM_MEMORY:-8G}"
ROOT_VM_CPUS="${ROOT_VM_CPUS:-4}"
ROOT_VM_SSH_PORT="${ROOT_VM_SSH_PORT:-2222}"
SSH_WAIT_TIMEOUT="${SSH_WAIT_TIMEOUT:-120}"

usage() {
  echo "Usage: $0"
  echo ""
  echo "Environment variables:"
  echo "  ROOT_VM_MEMORY    VM memory (default: 8G)"
  echo "  ROOT_VM_CPUS      VM CPU count (default: 4)"
  echo "  ROOT_VM_SSH_PORT  Host port for SSH forwarding (default: 2222)"
  echo "  SSH_WAIT_TIMEOUT  Seconds to wait for SSH (default: 120)"
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

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

if [ ! -f "$QCOW2_IMAGE" ]; then
  echo "ERROR: Root VM image not found at ${QCOW2_IMAGE}"
  echo ""
  echo "Build it with:"
  echo "  make .stamps/rockpool-root-vm"
  exit 1
fi

if [ ! -f "$SSH_KEY" ]; then
  echo "ERROR: SSH key not found at ${SSH_KEY}"
  exit 1
fi

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "Root VM is already running (PID $(cat "$PID_FILE"))."
  echo "SSH:  ssh -i ${SSH_KEY} -p ${ROOT_VM_SSH_PORT} admin@localhost"
  exit 0
fi

mkdir -p "$QEMU_DIR"

rm -f "$VIRTIOFSD_SOCK"

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
VIRTIOFSD_PID=$!
echo "$VIRTIOFSD_PID" > "$VIRTIOFSD_PID_FILE"

for i in $(seq 1 20); do
  [ -S "$VIRTIOFSD_SOCK" ] && break
  sleep 0.25
done

if [ ! -S "$VIRTIOFSD_SOCK" ]; then
  echo "ERROR: virtiofsd socket not created after 5 seconds."
  kill "$VIRTIOFSD_PID" 2>/dev/null || true
  rm -f "$VIRTIOFSD_PID_FILE"
  exit 1
fi

MEMORY_NUM="${ROOT_VM_MEMORY//[^0-9]/}"
MEMORY_UNIT="${ROOT_VM_MEMORY//[0-9]/}"
MEMORY_UNIT="${MEMORY_UNIT:-G}"

echo "Starting QEMU/KVM (${ROOT_VM_CPUS} CPUs, ${ROOT_VM_MEMORY} RAM)..."
qemu-system-x86_64 \
  -enable-kvm \
  -cpu host \
  -m "$ROOT_VM_MEMORY" \
  -smp "$ROOT_VM_CPUS" \
  -drive file="$QCOW2_IMAGE",format=qcow2,if=virtio \
  -object memory-backend-memfd,id=mem,size="$ROOT_VM_MEMORY",share=on \
  -numa node,memdev=mem \
  -chardev socket,id=char-virtiofs,path="$VIRTIOFSD_SOCK" \
  -device vhost-user-fs-pci,chardev=char-virtiofs,tag=rockpool \
  -device virtio-net-pci,netdev=net0 \
  -netdev user,id=net0,hostfwd=tcp::${ROOT_VM_SSH_PORT}-:22,hostfwd=tcp::8080-:8080,hostfwd=tcp::8081-:8081,hostfwd=tcp::8082-:8082,hostfwd=tcp::9080-:9080,hostfwd=tcp::9081-:9081,hostfwd=tcp::9082-:9082,hostfwd=tcp::9324-:9324,hostfwd=tcp::9424-:9424 \
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
echo "Waiting for SSH to become available..."

elapsed=0
while [ "$elapsed" -lt "$SSH_WAIT_TIMEOUT" ]; do
  if ssh -q \
    -i "$SSH_KEY" \
    -p "$ROOT_VM_SSH_PORT" \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o ConnectTimeout=2 \
    -o LogLevel=ERROR \
    admin@localhost \
    'true' 2>/dev/null; then
    echo ""
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
  sleep 2
  elapsed=$((elapsed + 2))
  printf "."
done

echo ""
echo "ERROR: SSH did not become available within ${SSH_WAIT_TIMEOUT} seconds."
echo "The VM may still be booting. Check the serial log:"
echo "  tail -f ${SERIAL_LOG}"
echo ""
echo "Try SSH manually:"
echo "  ssh -i ${SSH_KEY} -p ${ROOT_VM_SSH_PORT} -o StrictHostKeyChecking=no admin@localhost"
exit 1
