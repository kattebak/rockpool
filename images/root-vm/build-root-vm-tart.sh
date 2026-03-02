#!/usr/bin/env bash
set -euo pipefail

# Build a Rockpool Root VM using Tart on macOS (Apple Silicon).
# Clones the Cirrus Labs Debian OCI image, boots it with the project directory
# mounted via Virtiofs, provisions via tart exec, and produces a ready-to-use
# "rockpool-root" Tart VM.
#
# Usage: images/root-vm/build-root-vm-tart.sh
#
# Prerequisites:
#   - Tart installed (brew install cirruslabs/cli/tart)
#   - macOS 13.0+ on Apple Silicon

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SETUP_SCRIPT="${SCRIPT_DIR}/setup-root-vm.sh"
SSH_PUBKEY="${SCRIPT_DIR}/keys/rockpool-root-vm_ed25519.pub"

VM_NAME="rockpool-root"
OCI_IMAGE="ghcr.io/cirruslabs/debian:latest"
VM_DISK_SIZE_GB="${ROOT_VM_DISK_SIZE:-60}"
VM_MEMORY_MB="${ROOT_VM_MEMORY_MB:-8192}"
VM_CPUS="${ROOT_VM_CPUS:-4}"
EXEC_WAIT_TIMEOUT="${EXEC_WAIT_TIMEOUT:-180}"
VIRTIOFS_MOUNT="/mnt/rockpool"

usage() {
  echo "Usage: $0"
  echo ""
  echo "Builds the Rockpool Root VM for macOS/Tart."
  echo "Clones ${OCI_IMAGE}, provisions with setup-root-vm.sh."
  echo ""
  echo "Environment variables:"
  echo "  ROOT_VM_DISK_SIZE    Disk size in GB (default: 60)"
  echo "  ROOT_VM_MEMORY_MB    Memory in MB (default: 8192)"
  echo "  ROOT_VM_CPUS         CPU count (default: 4)"
  echo "  EXEC_WAIT_TIMEOUT    Seconds to wait for guest agent (default: 180)"
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

if [ "$(uname -s)" != "Darwin" ]; then
  echo "ERROR: This script is for macOS only."
  echo "On Linux, use: sudo images/root-vm/build-root-vm.sh"
  exit 1
fi

if ! command -v tart &>/dev/null; then
  echo "ERROR: tart is not installed."
  echo "Install with: brew install cirruslabs/cli/tart"
  exit 1
fi

if [ ! -f "$SETUP_SCRIPT" ]; then
  echo "ERROR: Setup script not found at $SETUP_SCRIPT"
  exit 1
fi

if [ ! -f "$SSH_PUBKEY" ]; then
  echo "ERROR: SSH public key not found at $SSH_PUBKEY"
  echo "Generate with: ssh-keygen -t ed25519 -f images/root-vm/keys/rockpool-root-vm_ed25519 -N '' -C 'rockpool-root-vm'"
  exit 1
fi

if tart list 2>/dev/null | awk 'NR>1 {print $2}' | grep -qx "$VM_NAME"; then
  echo "WARNING: VM '${VM_NAME}' already exists."
  echo "Delete it first with: tart delete ${VM_NAME}"
  exit 1
fi

cleanup() {
  echo "Stopping VM..."
  tart stop "$VM_NAME" 2>/dev/null || true
  rm -f "${ROOT_DIR}/.tart-build-fnm-block.sh"
}

echo "=== Building Rockpool Root VM (Tart/macOS) ==="
echo ""

echo "Cloning ${OCI_IMAGE} to ${VM_NAME}..."
tart clone "$OCI_IMAGE" "$VM_NAME"

echo "Configuring VM: ${VM_CPUS} CPUs, ${VM_MEMORY_MB}MB RAM, ${VM_DISK_SIZE_GB}GB disk..."
tart set "$VM_NAME" --cpu "$VM_CPUS" --memory "$VM_MEMORY_MB" --disk-size "$VM_DISK_SIZE_GB"

trap cleanup EXIT

echo "Starting VM with project directory mounted for provisioning..."
tart run "$VM_NAME" --no-graphics --dir="rockpool:${ROOT_DIR}:tag=rockpool" &
TART_PID=$!

echo "Waiting for guest agent..."
elapsed=0
while [ "$elapsed" -lt "$EXEC_WAIT_TIMEOUT" ]; do
  if tart exec "$VM_NAME" -- true 2>/dev/null; then
    echo "Guest agent is ready."
    break
  fi
  sleep 3
  elapsed=$((elapsed + 3))
done

if [ "$elapsed" -ge "$EXEC_WAIT_TIMEOUT" ]; then
  echo "ERROR: Guest agent did not become available within ${EXEC_WAIT_TIMEOUT} seconds."
  exit 1
fi

echo ""
echo "=== Mounting project directory inside VM ==="
tart exec "$VM_NAME" -- sudo mkdir -p "$VIRTIOFS_MOUNT"
tart exec "$VM_NAME" -- sudo mount -t virtiofs rockpool "$VIRTIOFS_MOUNT"

echo ""
echo "=== Running provisioning script ==="
tart exec "$VM_NAME" -- sudo bash "${VIRTIOFS_MOUNT}/images/root-vm/setup-root-vm.sh"

echo ""
echo "=== Resizing root partition to fill disk ==="
# shellcheck disable=SC2016
tart exec "$VM_NAME" -- sudo bash -c \
  'ROOT_DEV=$(findmnt -n -o SOURCE /) && DISK_DEV=$(lsblk -ndo PKNAME "$ROOT_DEV" | head -1) && growpart "/dev/$DISK_DEV" 1 && resize2fs "$ROOT_DEV"' \
  || echo "WARNING: Partition resize skipped (growpart may not be available)."

echo ""
echo "=== Installing fnm and Node.js ==="
tart exec "$VM_NAME" -- bash -c 'curl -fsSL https://fnm.vercel.app/install | bash'
# shellcheck disable=SC2016
tart exec "$VM_NAME" -- bash -c \
  'export PATH="$HOME/.local/share/fnm:$PATH" && eval "$(fnm env)" && fnm install --lts && npm install -g pm2'

echo ""
echo "=== Configuring fnm PATH for non-interactive sessions ==="
cat > "${ROOT_DIR}/.tart-build-fnm-block.sh" << 'FNMBLOCK'

# fnm -- must be before interactive guard so SSH commands find node/npm/pm2
FNM_PATH="$HOME/.local/share/fnm"
if [ -d "$FNM_PATH" ]; then
  export PATH="$FNM_PATH:$PATH"
  eval "$(fnm env)"
fi
FNMBLOCK
tart exec "$VM_NAME" -- bash -c \
  "cat '${VIRTIOFS_MOUNT}/.tart-build-fnm-block.sh' >> ~/.bashrc"
rm -f "${ROOT_DIR}/.tart-build-fnm-block.sh"

echo ""
echo "=== Configuring Virtiofs fstab entry ==="
tart exec "$VM_NAME" -- sudo bash -c \
  'grep -q /mnt/rockpool /etc/fstab || echo "rockpool /mnt/rockpool virtiofs defaults,nofail 0 0" >> /etc/fstab'

echo ""
echo "=== Setting up persistent state directory ==="
tart exec "$VM_NAME" -- sudo mkdir -p /opt/rockpool

echo ""
echo "=== Unmounting project directory ==="
tart exec "$VM_NAME" -- sudo umount "$VIRTIOFS_MOUNT" || true

echo ""
echo "=== Final cleanup ==="
tart exec "$VM_NAME" -- sudo apt-get -qq clean

echo ""
echo "=== Stopping VM ==="
trap - EXIT
tart stop "$VM_NAME"

wait "$TART_PID" 2>/dev/null || true

echo ""
echo "Root VM image built successfully."
echo "  VM name: ${VM_NAME}"
echo "  CPUs:    ${VM_CPUS}"
echo "  Memory:  ${VM_MEMORY_MB}MB"
echo "  Disk:    ${VM_DISK_SIZE_GB}GB"
echo ""
echo "Start the VM with: npm run start:vm"
