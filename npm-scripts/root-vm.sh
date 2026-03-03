#!/usr/bin/env bash
set -euo pipefail

# Rockpool Root VM — single control script.
#
# Manages the full lifecycle of the Root VM: build, boot, deploy, and
# service control. Detects platform (Linux/QEMU or macOS/Tart) automatically.
#
# Usage: npm run vm -- <command> [args]
#
# Commands:
#   build              Build VM image (mmdebstrap on Linux, Tart on macOS)
#   start              Boot the VM, wait for SSH to become available
#   stop               Shut down the VM gracefully (SSH poweroff → SIGTERM → SIGKILL)
#   deploy             rsync codebase to /opt/rockpool/ on the VM, npm ci --production
#   configure <file>   scp the given env file to /opt/rockpool/runtime.env on the VM
#   up                 podman compose up -d inside the VM
#   down               podman compose down inside the VM
#   restart            podman compose restart inside the VM
#   logs [args]        podman compose logs -f (pass extra args after --)
#   ssh [args]         Interactive SSH shell (or run a remote command)
#
# Environment:
#   ROOT_VM_MEMORY       VM memory (default: 8G) [Linux only]
#   ROOT_VM_CPUS         VM CPU count (default: 4)
#   ROOT_VM_SSH_PORT     Host SSH port (default: 2222) [Linux only]
#   SSH_WAIT_TIMEOUT     Seconds to wait for SSH (default: 120)
#   TART_VM_NAME         Tart VM name (default: rockpool-root) [macOS only]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PLATFORM="$(uname -s)"
VM_DIR="${ROOT_DIR}/.vm"
SSH_KEY="${ROOT_DIR}/images/root-vm/keys/rockpool-root-vm_ed25519"

ROOT_VM_MEMORY="${ROOT_VM_MEMORY:-8G}"
ROOT_VM_CPUS="${ROOT_VM_CPUS:-4}"
ROOT_VM_SSH_PORT="${ROOT_VM_SSH_PORT:-2222}"
SSH_WAIT_TIMEOUT="${SSH_WAIT_TIMEOUT:-120}"
TART_VM_NAME="${TART_VM_NAME:-rockpool-root}"

IMAGE_SIZE="${ROOT_VM_IMAGE_SIZE:-60G}"
DATA_SIZE="${ROOT_VM_DATA_SIZE:-40G}"
DATA_SIZE_MB="${ROOT_VM_DATA_SIZE_MB:-40960}"
TART_OCI_IMAGE="ghcr.io/cirruslabs/debian:latest"

usage() {
  sed -n '/^# Usage:/,/^$/{ s/^# \?//; p }' "$0"
}

if [ $# -lt 1 ]; then
  usage
  exit 1
fi

COMMAND="$1"
shift

# ---------------------------------------------------------------------------
# SSH helpers
# ---------------------------------------------------------------------------

require_ssh_key() {
  if [ ! -f "$SSH_KEY" ]; then
    echo "ERROR: SSH key not found at ${SSH_KEY}"
    echo "Generate with: ssh-keygen -t ed25519 -f images/root-vm/keys/rockpool-root-vm_ed25519 -N '' -C 'rockpool-root-vm'"
    exit 1
  fi
}

get_ssh_target() {
  if [ "$PLATFORM" = "Darwin" ]; then
    local vm_ip
    vm_ip=$(tart ip "$TART_VM_NAME" 2>/dev/null || true)
    if [ -z "$vm_ip" ]; then
      echo "ERROR: Could not get IP for VM '${TART_VM_NAME}'." >&2
      echo "Is the VM running? Start it with: npm run vm -- start" >&2
      exit 1
    fi
    echo "admin@${vm_ip}" "22"
  else
    echo "admin@localhost" "$ROOT_VM_SSH_PORT"
  fi
}

ssh_opts() {
  echo -q \
    -i "$SSH_KEY" \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o LogLevel=ERROR
}

run_ssh() {
  require_ssh_key
  local target
  target=$(get_ssh_target)
  local user_host="${target%% *}"
  local port="${target##* }"

  ssh -q \
    -i "$SSH_KEY" \
    -p "$port" \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o LogLevel=ERROR \
    "$user_host" \
    "$@"
}

run_ssh_interactive() {
  require_ssh_key
  local target
  target=$(get_ssh_target)
  local user_host="${target%% *}"
  local port="${target##* }"

  exec ssh \
    -i "$SSH_KEY" \
    -p "$port" \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o LogLevel=ERROR \
    "$user_host" \
    "$@"
}

run_scp() {
  require_ssh_key
  local target
  target=$(get_ssh_target)
  local user_host="${target%% *}"
  local port="${target##* }"

  scp -q \
    -i "$SSH_KEY" \
    -P "$port" \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o LogLevel=ERROR \
    "$@" "${user_host}:/opt/rockpool/runtime.env"
}

run_rsync() {
  require_ssh_key
  local target
  target=$(get_ssh_target)
  local user_host="${target%% *}"
  local port="${target##* }"

  rsync -az --delete \
    -e "ssh -i ${SSH_KEY} -p ${port} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR" \
    --exclude='.git/' \
    --exclude='node_modules/' \
    --exclude='.vm/' \
    --exclude='*.env' \
    --exclude='.stamps/' \
    --exclude='build/' \
    --exclude='tsp-output/' \
    --exclude='test-results/' \
    --exclude='.claude/' \
    "${ROOT_DIR}/" "${user_host}:/opt/rockpool/"
}

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
# Setup script (written to temp file, runs inside VM during build)
# ---------------------------------------------------------------------------

write_setup_script() {
  local dest="$1"
  cat > "$dest" <<'SETUP_EOF'
#!/usr/bin/env bash
set -euo pipefail

VM_USER="admin"
NODE_MAJOR="22"

apt-get update -qq
apt-get install -y -qq \
  curl \
  wget \
  jq \
  git \
  rsync \
  openssh-server \
  make \
  ca-certificates \
  openssl \
  htop \
  less \
  file \
  tree \
  net-tools \
  iputils-ping \
  sudo \
  podman \
  podman-compose \
  uidmap \
  slirp4netns \
  cloud-guest-utils \
  unzip

echo "Configuring admin user..."
if ! id "$VM_USER" &>/dev/null; then
  useradd -m -s /bin/bash -G sudo "$VM_USER"
  echo "${VM_USER}:${VM_USER}" | chpasswd
fi
echo "${VM_USER} ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/${VM_USER}"
chmod 440 "/etc/sudoers.d/${VM_USER}"

echo "Installing Node.js ${NODE_MAJOR} via fnm..."
FNM_DIR="/home/${VM_USER}/.local/share/fnm"
export SHELL=/bin/bash
su - "$VM_USER" -c "
  curl -fsSL https://fnm.vercel.app/install | bash -s -- --install-dir '${FNM_DIR}' --skip-shell
  export PATH=\"${FNM_DIR}:\$PATH\"
  eval \"\$(fnm env --shell bash)\"
  fnm install ${NODE_MAJOR}
  fnm default ${NODE_MAJOR}
"
cat >> "/home/${VM_USER}/.bashrc" <<'FNMRC'
export FNM_DIR="$HOME/.local/share/fnm"
export PATH="$FNM_DIR:$PATH"
eval "$(fnm env --shell bash)"
FNMRC

echo "Configuring SSH server..."
mkdir -p /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/rockpool.conf <<'SSHCONF'
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
SSHCONF

SSH_DIR="/home/${VM_USER}/.ssh"
mkdir -p "${SSH_DIR}"
cat > "${SSH_DIR}/authorized_keys" <<'AUTHKEYS'
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOCpmxFuT1c0KTSp4law/4HaqhCa0N9kTu6l/2JuPSdQ rockpool-root-vm
AUTHKEYS
chmod 700 "${SSH_DIR}"
chmod 600 "${SSH_DIR}/authorized_keys"
chown -R "${VM_USER}:${VM_USER}" "${SSH_DIR}"

systemctl enable ssh 2>/dev/null || ln -sf /lib/systemd/system/ssh.service /etc/systemd/system/multi-user.target.wants/ssh.service

echo "Setting up mount points..."
mkdir -p /mnt/rockpool
mkdir -p /data

echo "Setting up application directory..."
mkdir -p /opt/rockpool
chown "${VM_USER}:${VM_USER}" /opt/rockpool

echo "Configuring hostname..."
echo "rockpool-root" > /etc/hostname

echo "Enabling serial console..."
ARCH=$(uname -m 2>/dev/null || echo "x86_64")
if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
  SERIAL_TTY="ttyAMA0"
else
  SERIAL_TTY="ttyS0"
fi
ln -sf /lib/systemd/system/serial-getty@.service \
  "/etc/systemd/system/getty.target.wants/serial-getty@${SERIAL_TTY}.service" 2>/dev/null || true

echo "Configuring networking (DHCP on all ethernet interfaces)..."
mkdir -p /etc/systemd/network
cat > /etc/systemd/network/80-dhcp.network <<'NETCONF'
[Match]
Name=en* eth*

[Network]
DHCP=yes
NETCONF

systemctl enable systemd-networkd 2>/dev/null || \
  ln -sf /lib/systemd/system/systemd-networkd.service /etc/systemd/system/multi-user.target.wants/systemd-networkd.service
systemctl enable systemd-resolved 2>/dev/null || \
  ln -sf /lib/systemd/system/systemd-resolved.service /etc/systemd/system/multi-user.target.wants/systemd-resolved.service

echo "Cleaning up apt cache..."
apt-get clean
rm -rf /var/lib/apt/lists/*

echo "Root VM provisioning complete."
SETUP_EOF
  chmod +x "$dest"
}

# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------

cmd_build() {
  require_ssh_key
  mkdir -p "$VM_DIR"

  if [ "$PLATFORM" = "Darwin" ]; then
    build_tart
  else
    build_linux
  fi
}

build_linux() {
  local TARBALL="${VM_DIR}/rootfs.tar"
  local RAW_IMAGE="${VM_DIR}/rootfs.raw"
  local QCOW2_IMAGE="${VM_DIR}/rockpool-root.qcow2"
  local VMLINUZ="${VM_DIR}/vmlinuz"
  local INITRD="${VM_DIR}/initrd.img"
  local DATA_IMAGE="${VM_DIR}/data.qcow2"
  local SETUP_FILE
  SETUP_FILE=$(mktemp "${VM_DIR}/setup-XXXXXX.sh")

  for cmd in mmdebstrap mke2fs qemu-img fakeroot; do
    if ! command -v "$cmd" &>/dev/null; then
      echo "ERROR: ${cmd} is not installed."
      echo "Install with: sudo apt install mmdebstrap e2fsprogs qemu-utils fakeroot"
      exit 1
    fi
  done

  write_setup_script "$SETUP_FILE"

  local ROOTFS_DIR=""
  cleanup() {
    rm -f "$TARBALL" "$RAW_IMAGE" "$SETUP_FILE"
    [ -n "$ROOTFS_DIR" ] && rm -rf "$ROOTFS_DIR" || true
  }
  trap cleanup EXIT

  echo "=== Building Rockpool Root VM (rootless) ==="
  echo ""

  echo "Installing Debian Bookworm via mmdebstrap (user namespace)..."
  mmdebstrap \
    --mode=unshare \
    --variant=important \
    --include=systemd,systemd-sysv,dbus,linux-image-amd64,apt,ca-certificates \
    --customize-hook="copy-in ${SETUP_FILE} /tmp" \
    --customize-hook="chroot \"\$1\" bash /tmp/$(basename "$SETUP_FILE")" \
    --customize-hook='echo "/dev/vda  /  ext4  errors=remount-ro  0 1" > "$1/etc/fstab"' \
    --customize-hook='echo "/dev/vdb  /data  ext4  defaults,nofail  0 2" >> "$1/etc/fstab"' \
    --customize-hook='echo "rockpool /mnt/rockpool virtiofs defaults,nofail 0 0" >> "$1/etc/fstab"' \
    --customize-hook='chroot "$1" apt-get clean' \
    --customize-hook='rm -rf "$1/var/lib/apt/lists"/*' \
    --customize-hook="rm \"\$1/tmp/$(basename "$SETUP_FILE")"\" \
    bookworm "$TARBALL"

  echo ""
  echo "Extracting kernel and initramfs from tarball..."
  local KERNEL_PATH INITRD_PATH
  KERNEL_PATH=$(tar tf "$TARBALL" | grep -E '^(\./)?boot/vmlinuz-' | head -1)
  INITRD_PATH=$(tar tf "$TARBALL" | grep -E '^(\./)?boot/initrd\.img-' | head -1)

  if [ -z "$KERNEL_PATH" ] || [ -z "$INITRD_PATH" ]; then
    echo "ERROR: Could not find kernel or initrd in the tarball."
    exit 1
  fi

  tar xf "$TARBALL" -C "$VM_DIR" "$KERNEL_PATH" "$INITRD_PATH"
  mv "${VM_DIR}/${KERNEL_PATH}" "$VMLINUZ"
  mv "${VM_DIR}/${INITRD_PATH}" "$INITRD"
  rm -rf "${VM_DIR}/boot" "${VM_DIR}/./boot" 2>/dev/null || true

  echo "  Kernel: ${VMLINUZ}"
  echo "  Initrd: ${INITRD}"

  echo ""
  echo "Creating ext4 disk image (${IMAGE_SIZE}, no mount needed)..."
  ROOTFS_DIR=$(mktemp -d)
  export TARBALL ROOTFS_DIR RAW_IMAGE IMAGE_SIZE
  fakeroot bash -c '
    tar xpf "$TARBALL" -C "$ROOTFS_DIR"
    mke2fs -t ext4 -d "$ROOTFS_DIR" "$RAW_IMAGE" "$IMAGE_SIZE"
  '
  rm -rf "$ROOTFS_DIR"
  ROOTFS_DIR=""

  echo ""
  echo "Converting raw image to compressed qcow2..."
  qemu-img convert -f raw -O qcow2 -c "$RAW_IMAGE" "$QCOW2_IMAGE"
  rm -f "$TARBALL" "$RAW_IMAGE"

  if [ ! -f "$DATA_IMAGE" ]; then
    echo ""
    echo "Creating data disk (${DATA_SIZE})..."
    qemu-img create -f qcow2 "$DATA_IMAGE" "$DATA_SIZE"
    echo "  (will be formatted on first boot)"
  else
    echo ""
    echo "Data disk already exists, keeping: ${DATA_IMAGE}"
  fi

  echo ""
  echo "Root VM image built successfully (no sudo required)."
  echo "  Image:   ${QCOW2_IMAGE} ($(du -h "$QCOW2_IMAGE" | cut -f1))"
  echo "  Kernel:  ${VMLINUZ}"
  echo "  Initrd:  ${INITRD}"
  echo "  Data:    ${DATA_IMAGE}"
  echo ""
  echo "Start the VM with: npm run vm -- start"
}

build_tart() {
  local SSH_PUBKEY="${ROOT_DIR}/images/root-vm/keys/rockpool-root-vm_ed25519.pub"
  local EXEC_WAIT_TIMEOUT="${EXEC_WAIT_TIMEOUT:-180}"
  local VM_DISK_SIZE_GB="${ROOT_VM_DISK_SIZE:-60}"
  local VM_MEMORY_MB="${ROOT_VM_MEMORY_MB:-8192}"
  local DATA_IMAGE="${VM_DIR}/data.img"
  local VIRTIOFS_MOUNT="/mnt/rockpool"
  local SETUP_FILE

  if [ "$PLATFORM" != "Darwin" ]; then
    echo "ERROR: Tart build is for macOS only."
    exit 1
  fi

  if ! command -v tart &>/dev/null; then
    echo "ERROR: tart is not installed."
    echo "Install with: brew install cirruslabs/cli/tart"
    exit 1
  fi

  if [ ! -f "$SSH_PUBKEY" ]; then
    echo "ERROR: SSH public key not found at $SSH_PUBKEY"
    echo "Generate with: ssh-keygen -t ed25519 -f images/root-vm/keys/rockpool-root-vm_ed25519 -N '' -C 'rockpool-root-vm'"
    exit 1
  fi

  if tart list 2>/dev/null | awk 'NR>1 {print $2}' | grep -qx "$TART_VM_NAME"; then
    echo "WARNING: VM '${TART_VM_NAME}' already exists."
    echo "Delete it first with: tart delete ${TART_VM_NAME}"
    exit 1
  fi

  SETUP_FILE="${ROOT_DIR}/.vm-setup-$$.sh"
  write_setup_script "$SETUP_FILE"

  cleanup() {
    rm -f "$SETUP_FILE"
    tart stop "$TART_VM_NAME" 2>/dev/null || true
  }
  trap cleanup EXIT

  echo "=== Building Rockpool Root VM (Tart/macOS) ==="
  echo ""

  echo "Cloning ${TART_OCI_IMAGE} to ${TART_VM_NAME}..."
  tart clone "$TART_OCI_IMAGE" "$TART_VM_NAME"

  echo "Configuring VM: ${ROOT_VM_CPUS} CPUs, ${VM_MEMORY_MB}MB RAM, ${VM_DISK_SIZE_GB}GB disk..."
  tart set "$TART_VM_NAME" --cpu "$ROOT_VM_CPUS" --memory "$VM_MEMORY_MB" --disk-size "$VM_DISK_SIZE_GB"

  echo "Starting VM with project directory mounted for provisioning..."
  tart run "$TART_VM_NAME" --no-graphics --dir="rockpool:${ROOT_DIR}:tag=rockpool" &
  local TART_PID=$!

  echo "Waiting for guest agent..."
  local elapsed=0
  while [ "$elapsed" -lt "$EXEC_WAIT_TIMEOUT" ]; do
    if tart exec "$TART_VM_NAME" -- true 2>/dev/null; then
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
  tart exec "$TART_VM_NAME" -- sudo mkdir -p "$VIRTIOFS_MOUNT"
  tart exec "$TART_VM_NAME" -- sudo mount -t virtiofs rockpool "$VIRTIOFS_MOUNT"

  echo ""
  echo "=== Running provisioning script ==="
  tart exec "$TART_VM_NAME" -- sudo bash "${VIRTIOFS_MOUNT}/.vm-setup-$$.sh"

  echo ""
  echo "=== Resizing root partition to fill disk ==="
  # shellcheck disable=SC2016
  tart exec "$TART_VM_NAME" -- sudo bash -c \
    'ROOT_DEV=$(findmnt -n -o SOURCE /) && DISK_DEV=$(lsblk -ndo PKNAME "$ROOT_DEV" | head -1) && growpart "/dev/$DISK_DEV" 1 && resize2fs "$ROOT_DEV"' \
    || echo "WARNING: Partition resize skipped (growpart may not be available)."

  echo ""
  echo "=== Configuring fstab entries ==="
  tart exec "$TART_VM_NAME" -- sudo bash -c \
    'grep -q /mnt/rockpool /etc/fstab || echo "rockpool /mnt/rockpool virtiofs defaults,nofail 0 0" >> /etc/fstab'
  tart exec "$TART_VM_NAME" -- sudo bash -c \
    'grep -q /data /etc/fstab || echo "/dev/vdb  /data  ext4  defaults,nofail  0 2" >> /etc/fstab'

  echo ""
  echo "=== Unmounting project directory ==="
  tart exec "$TART_VM_NAME" -- sudo umount "$VIRTIOFS_MOUNT" || true

  echo ""
  echo "=== Final cleanup ==="
  tart exec "$TART_VM_NAME" -- sudo apt-get -qq clean

  echo ""
  echo "=== Stopping VM ==="
  trap - EXIT
  rm -f "$SETUP_FILE"
  tart stop "$TART_VM_NAME"
  wait "$TART_PID" 2>/dev/null || true

  if [ ! -f "$DATA_IMAGE" ]; then
    echo ""
    echo "Creating data disk (${DATA_SIZE_MB}MB)..."
    dd if=/dev/zero of="$DATA_IMAGE" bs=1M count=0 seek="$DATA_SIZE_MB" 2>/dev/null
    echo "  (will be formatted on first boot)"
  else
    echo ""
    echo "Data disk already exists, keeping: ${DATA_IMAGE}"
  fi

  echo ""
  echo "Root VM image built successfully."
  echo "  VM name: ${TART_VM_NAME}"
  echo "  CPUs:    ${ROOT_VM_CPUS}"
  echo "  Memory:  ${VM_MEMORY_MB}MB"
  echo "  Disk:    ${VM_DISK_SIZE_GB}GB"
  echo "  Data:    ${DATA_IMAGE}"
  echo ""
  echo "Start the VM with: npm run vm -- start"
}

# ---------------------------------------------------------------------------
# start
# ---------------------------------------------------------------------------

cmd_start() {
  require_ssh_key

  if [ "$PLATFORM" = "Darwin" ]; then
    start_tart
  else
    start_qemu
  fi
}

start_tart() {
  if ! command -v tart &>/dev/null; then
    echo "ERROR: tart is not installed."
    echo "Install with: brew install cirruslabs/cli/tart"
    exit 1
  fi

  if ! tart list 2>/dev/null | awk 'NR>1 {print $2}' | grep -qx "$TART_VM_NAME"; then
    echo "ERROR: Tart VM '${TART_VM_NAME}' not found."
    echo "Build it with: npm run vm -- build"
    exit 1
  fi

  local vm_state
  vm_state=$(tart list 2>/dev/null | awk -v name="$TART_VM_NAME" '$2 == name {print $NF}')

  if [ "$vm_state" = "running" ]; then
    local vm_ip
    vm_ip=$(tart ip "$TART_VM_NAME" 2>/dev/null || true)
    echo "Root VM is already running."
    echo "  IP:  ${vm_ip:-unknown}"
    echo "  SSH: npm run vm -- ssh"
    exit 0
  fi

  local TART_ARGS=(
    --no-graphics
    --net-softnet
  )

  local DATA_IMAGE="${VM_DIR}/data.img"
  if [ -f "$DATA_IMAGE" ]; then
    TART_ARGS+=(--disk "$DATA_IMAGE")
  fi

  echo "Starting Root VM via Tart (${TART_VM_NAME})..."
  tart run "$TART_VM_NAME" "${TART_ARGS[@]}" &

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
    echo ""
    echo "Root VM is ready."
    echo "  IP:   ${vm_ip}"
    echo "  SSH:  npm run vm -- ssh"
    echo "  Logs: npm run vm -- logs"
    echo "  Stop: npm run vm -- stop"
    exit 0
  fi

  echo "ERROR: SSH did not become available within ${SSH_WAIT_TIMEOUT} seconds."
  exit 1
}

start_qemu() {
  local QCOW2_IMAGE="${VM_DIR}/rockpool-root.qcow2"
  local PID_FILE="${VM_DIR}/rockpool-root.pid"
  local VMLINUZ="${VM_DIR}/vmlinuz"
  local INITRD="${VM_DIR}/initrd.img"
  local DATA_IMAGE="${VM_DIR}/data.qcow2"
  local SERIAL_LOG="${VM_DIR}/serial.log"

  if ! command -v qemu-system-x86_64 &>/dev/null; then
    echo "ERROR: qemu-system-x86_64 is not installed."
    echo "Install with: sudo apt install qemu-system-x86"
    exit 1
  fi

  if [ ! -r /dev/kvm ] || [ ! -w /dev/kvm ]; then
    echo "ERROR: /dev/kvm is not accessible."
    echo "Ensure KVM is available and your user has access:"
    echo "  sudo usermod -aG kvm \$USER"
    exit 1
  fi

  if [ ! -f "$QCOW2_IMAGE" ]; then
    echo "ERROR: Root VM image not found at ${QCOW2_IMAGE}"
    echo "Build it with: npm run vm -- build"
    exit 1
  fi

  if [ ! -f "$VMLINUZ" ] || [ ! -f "$INITRD" ]; then
    echo "ERROR: Kernel or initrd not found."
    echo "Rebuild with: npm run vm -- build"
    exit 1
  fi

  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "Root VM is already running (PID $(cat "$PID_FILE"))."
    echo "  SSH: npm run vm -- ssh"
    exit 0
  fi

  mkdir -p "$VM_DIR"

  local DRIVE_ARGS=(
    -drive "file=${QCOW2_IMAGE},format=qcow2,if=virtio"
  )

  if [ -f "$DATA_IMAGE" ]; then
    DRIVE_ARGS+=(-drive "file=${DATA_IMAGE},format=qcow2,if=virtio")
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
    "${DRIVE_ARGS[@]}" \
    -device virtio-net-pci,netdev=net0 \
    -netdev "user,id=net0,hostfwd=tcp::${ROOT_VM_SSH_PORT}-:22,hostfwd=tcp::8080-:8080,hostfwd=tcp::8081-:8081,hostfwd=tcp::8082-:8082" \
    -serial "file:${SERIAL_LOG}" \
    -monitor "unix:${VM_DIR}/qemu-monitor.sock,server,nowait" \
    -display none \
    -daemonize \
    -pidfile "$PID_FILE"

  if [ ! -f "$PID_FILE" ]; then
    echo "ERROR: QEMU failed to start (no PID file created)."
    echo "Check serial log: ${SERIAL_LOG}"
    exit 1
  fi

  echo "QEMU started (PID $(cat "$PID_FILE"))."

  if wait_for_ssh "localhost" "$ROOT_VM_SSH_PORT" "$SSH_WAIT_TIMEOUT"; then
    format_data_disk_if_needed
    echo ""
    echo "Root VM is ready."
    echo "  SSH:  npm run vm -- ssh"
    echo "  Logs: npm run vm -- logs"
    echo "  Stop: npm run vm -- stop"
    echo ""
    echo "  Forwarded ports:"
    echo "    8080 -> VM:8080"
    echo "    8081 -> VM:8081"
    echo "    8082 -> VM:8082"
    echo "    ${ROOT_VM_SSH_PORT} -> VM:22 (SSH)"
    echo ""
    echo "  Serial log: ${SERIAL_LOG}"
    exit 0
  fi

  echo "ERROR: SSH did not become available within ${SSH_WAIT_TIMEOUT} seconds."
  echo "Check serial log: tail -f ${SERIAL_LOG}"
  exit 1
}

format_data_disk_if_needed() {
  local has_data_fs
  has_data_fs=$(run_ssh "lsblk -no FSTYPE /dev/vdb 2>/dev/null || true")
  if [ -z "$has_data_fs" ]; then
    echo "Formatting data disk (/dev/vdb) as ext4..."
    run_ssh "sudo mkfs.ext4 -q /dev/vdb && sudo mount /data && sudo mkdir -p /data/containers /data/logs && sudo chown -R admin:admin /data"
    echo "Data disk formatted and mounted."
  fi
}

# ---------------------------------------------------------------------------
# stop
# ---------------------------------------------------------------------------

cmd_stop() {
  if [ "$PLATFORM" = "Darwin" ]; then
    stop_tart
  else
    stop_qemu
  fi
}

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

  echo "Stopping Root VM (${TART_VM_NAME})..."
  run_ssh "sudo poweroff" 2>/dev/null || true
  sleep 2

  vm_state=$(tart list 2>/dev/null | awk -v name="$TART_VM_NAME" '$2 == name {print $NF}')
  if [ "$vm_state" = "running" ]; then
    tart stop "$TART_VM_NAME" --timeout 30
  fi

  echo "Root VM stopped."
}

stop_qemu() {
  local PID_FILE="${VM_DIR}/rockpool-root.pid"

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

  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "Attempting graceful shutdown via SSH..."
    if run_ssh "sudo poweroff" 2>/dev/null; then
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

  rm -f "${VM_DIR}/qemu-monitor.sock" 2>/dev/null || true
  echo "Root VM environment cleaned up."
}

# ---------------------------------------------------------------------------
# deploy
# ---------------------------------------------------------------------------

cmd_deploy() {
  echo "Syncing codebase to VM:/opt/rockpool/..."
  run_rsync
  echo "Sync complete."

  echo ""
  echo "Running npm ci --production on VM..."
  run_ssh "cd /opt/rockpool && npm ci --production"
  echo "Deploy complete."
}

# ---------------------------------------------------------------------------
# configure
# ---------------------------------------------------------------------------

cmd_configure() {
  if [ $# -lt 1 ]; then
    echo "Usage: npm run vm -- configure <env-file>"
    echo ""
    echo "Copies the given env file to /opt/rockpool/runtime.env on the VM."
    exit 1
  fi

  local env_file="$1"

  if [ ! -f "$env_file" ]; then
    echo "ERROR: File not found: ${env_file}"
    exit 1
  fi

  echo "Copying ${env_file} to VM:/opt/rockpool/runtime.env..."
  run_scp "$env_file"
  echo "Configuration pushed."
}

# ---------------------------------------------------------------------------
# compose commands (up, down, restart, logs)
# ---------------------------------------------------------------------------

cmd_up() {
  echo "Starting services on VM..."
  run_ssh "cd /opt/rockpool && podman compose up -d"
}

cmd_down() {
  echo "Stopping services on VM..."
  run_ssh "cd /opt/rockpool && podman compose down" || true
}

cmd_restart() {
  echo "Restarting services on VM..."
  run_ssh "cd /opt/rockpool && podman compose restart"
}

cmd_logs() {
  local args="${*:---follow}"
  run_ssh_interactive "cd /opt/rockpool && podman compose logs ${args}"
}

# ---------------------------------------------------------------------------
# ssh
# ---------------------------------------------------------------------------

cmd_ssh() {
  run_ssh_interactive "$@"
}

# ---------------------------------------------------------------------------
# dispatch
# ---------------------------------------------------------------------------

case "$COMMAND" in
  build)     cmd_build "$@" ;;
  start)     cmd_start "$@" ;;
  stop)      cmd_stop "$@" ;;
  deploy)    cmd_deploy "$@" ;;
  configure) cmd_configure "$@" ;;
  up)        cmd_up "$@" ;;
  down)      cmd_down "$@" ;;
  restart)   cmd_restart "$@" ;;
  logs)      cmd_logs "$@" ;;
  ssh)       cmd_ssh "$@" ;;
  -h|--help) usage; exit 0 ;;
  *)
    echo "ERROR: Unknown command '${COMMAND}'"
    echo ""
    usage
    exit 1
    ;;
esac
