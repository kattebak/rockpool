#!/usr/bin/env bash
set -euo pipefail

# Download Firecracker binary and kernel to .firecracker/
# Usage: firecracker-setup.sh [base-path]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
BASE_PATH="${1:-${ROOT_DIR}/.firecracker}"

ARCH=$(uname -m)
FC_VERSION="v1.10.1"
FC_TAR_URL="https://github.com/firecracker-microvm/firecracker/releases/download/${FC_VERSION}/firecracker-${FC_VERSION}-${ARCH}.tgz"

KERNEL_DIR="${BASE_PATH}/kernel"
BIN_DIR="${BASE_PATH}/bin"

mkdir -p "$KERNEL_DIR" "$BIN_DIR"

if [ -f "${BIN_DIR}/firecracker" ]; then
  echo "Firecracker binary already exists at ${BIN_DIR}/firecracker"
else
  echo "Downloading Firecracker ${FC_VERSION} for ${ARCH}..."
  TEMP_DIR=$(mktemp -d)
  curl -fsSL "$FC_TAR_URL" | tar xz -C "$TEMP_DIR"

  RELEASE_DIR="${TEMP_DIR}/release-${FC_VERSION}-${ARCH}"
  cp "${RELEASE_DIR}/firecracker-${FC_VERSION}-${ARCH}" "${BIN_DIR}/firecracker"
  chmod +x "${BIN_DIR}/firecracker"

  rm -rf "$TEMP_DIR"
  echo "Firecracker binary installed at ${BIN_DIR}/firecracker"
fi

if [ -f "${KERNEL_DIR}/vmlinux" ]; then
  echo "Kernel already exists at ${KERNEL_DIR}/vmlinux"
else
  # S3 bucket uses major.minor (v1.10), not the full patch version (v1.10.1)
  S3_VERSION=$(echo "$FC_VERSION" | grep -oP 'v[0-9]+\.[0-9]+')
  KERNEL_KEY=$(curl -s "http://spec.ccfc.min.s3.amazonaws.com/?prefix=firecracker-ci/${S3_VERSION}/${ARCH}/vmlinux-&list-type=2" \
    | grep -oP "(?<=<Key>)(firecracker-ci/${S3_VERSION}/${ARCH}/vmlinux-[0-9]+\.[0-9]+\.[0-9]{1,3})(?=</Key>)" \
    | sort -V | tail -1)

  if [ -z "$KERNEL_KEY" ]; then
    echo "ERROR: Could not find kernel for Firecracker ${FC_VERSION} / ${ARCH} on S3."
    exit 1
  fi

  echo "Downloading kernel: ${KERNEL_KEY}..."
  curl -fsSL "https://s3.amazonaws.com/spec.ccfc.min/${KERNEL_KEY}" -o "${KERNEL_DIR}/vmlinux"
  echo "Kernel installed at ${KERNEL_DIR}/vmlinux"
fi

echo ""
echo "Firecracker setup complete."
echo "  Binary: ${BIN_DIR}/firecracker"
echo "  Kernel: ${KERNEL_DIR}/vmlinux"
echo ""
echo "Next steps:"
echo "  1. Build the rootfs: sudo images/scripts/build-firecracker-rootfs.sh"
echo "  2. Set up networking: sudo npm-scripts/firecracker-bridge-setup.sh"
echo "  3. Optional: install binary system-wide: sudo cp ${BIN_DIR}/firecracker /usr/local/bin/"
