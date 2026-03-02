#!/usr/bin/env bash
set -euo pipefail

# Build a QEMU qcow2 disk image for the Rockpool Root VM -- fully rootless.
#
# Uses mmdebstrap (user namespace) + mke2fs -d (no mount) + qemu-img convert.
# Produces a raw ext4 image (no partition table) and extracts kernel+initrd
# for QEMU direct kernel boot (no GRUB).
#
# See doc/EDD/024_Rootless_VM_Image_Build.md
#
# Usage: images/root-vm/build-root-vm.sh [output-dir]
#
# Produces:
#   <output-dir>/rockpool-root.qcow2   (compressed disk image)
#   <output-dir>/vmlinuz                (kernel for -kernel flag)
#   <output-dir>/initrd.img             (initramfs for -initrd flag)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
OUTPUT_DIR="${1:-${ROOT_DIR}/.qemu}"
SETUP_SCRIPT="${SCRIPT_DIR}/setup-root-vm.sh"

TARBALL="${OUTPUT_DIR}/rootfs.tar"
RAW_IMAGE="${OUTPUT_DIR}/rootfs.raw"
QCOW2_IMAGE="${OUTPUT_DIR}/rockpool-root.qcow2"
VMLINUZ="${OUTPUT_DIR}/vmlinuz"
INITRD="${OUTPUT_DIR}/initrd.img"

IMAGE_SIZE="60G"

for cmd in mmdebstrap mke2fs qemu-img fakeroot; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: ${cmd} is not installed."
    echo "Install with: sudo apt install mmdebstrap e2fsprogs qemu-utils fakeroot"
    exit 1
  fi
done

if [ ! -f "$SETUP_SCRIPT" ]; then
  echo "ERROR: Setup script not found at $SETUP_SCRIPT"
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

ROOTFS_DIR=""
cleanup() {
  rm -f "$TARBALL" "$RAW_IMAGE"
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
  --customize-hook="copy-in $SETUP_SCRIPT /tmp" \
  --customize-hook='chroot "$1" bash /tmp/setup-root-vm.sh' \
  --customize-hook='echo "/dev/vda  /  ext4  errors=remount-ro  0 1" > "$1/etc/fstab"' \
  --customize-hook='echo "rockpool /mnt/rockpool virtiofs defaults,nofail 0 0" >> "$1/etc/fstab"' \
  --customize-hook='chroot "$1" apt-get clean' \
  --customize-hook='rm -rf "$1/var/lib/apt/lists"/*' \
  --customize-hook='rm "$1/tmp/setup-root-vm.sh"' \
  bookworm "$TARBALL"

echo ""
echo "Extracting kernel and initramfs from tarball..."
KERNEL_PATH=$(tar tf "$TARBALL" | grep -E '^(\./)?boot/vmlinuz-' | head -1)
INITRD_PATH=$(tar tf "$TARBALL" | grep -E '^(\./)?boot/initrd\.img-' | head -1)

if [ -z "$KERNEL_PATH" ] || [ -z "$INITRD_PATH" ]; then
  echo "ERROR: Could not find kernel or initrd in the tarball."
  echo "  Kernel: ${KERNEL_PATH:-not found}"
  echo "  Initrd: ${INITRD_PATH:-not found}"
  exit 1
fi

tar xf "$TARBALL" -C "$OUTPUT_DIR" "$KERNEL_PATH" "$INITRD_PATH"
mv "${OUTPUT_DIR}/${KERNEL_PATH}" "$VMLINUZ"
mv "${OUTPUT_DIR}/${INITRD_PATH}" "$INITRD"
rm -rf "${OUTPUT_DIR}/boot" "${OUTPUT_DIR}/./boot" 2>/dev/null || true

echo "  Kernel: ${VMLINUZ}"
echo "  Initrd: ${INITRD}"

echo ""
echo "Creating ext4 disk image (${IMAGE_SIZE}, no mount needed)..."
# mke2fs -d only accepts directories (not tarballs) on stock Ubuntu/Debian
# because e2fsprogs is compiled without libarchive. Use fakeroot to extract
# the tarball with correct ownership faking, then mke2fs -d reads the faked UIDs.
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

echo ""
echo "Root VM image built successfully (no sudo required)."
echo "  Image:   ${QCOW2_IMAGE} ($(du -h "$QCOW2_IMAGE" | cut -f1))"
echo "  Kernel:  ${VMLINUZ}"
echo "  Initrd:  ${INITRD}"
echo ""
echo "Start the VM with: npm run start:vm"
