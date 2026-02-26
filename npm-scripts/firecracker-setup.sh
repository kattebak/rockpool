#!/usr/bin/env bash
set -euo pipefail

ARCH=$(uname -m)
FC_VERSION="v1.10.1"
KERNEL_URL="https://github.com/firecracker-microvm/firecracker/releases/download/${FC_VERSION}/firecracker-${FC_VERSION}-${ARCH}.tgz"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
FC_DIR="$PROJECT_ROOT/.firecracker"

mkdir -p "$FC_DIR/kernel"
mkdir -p "$FC_DIR/base"

cd "$FC_DIR/kernel"

if [ ! -f vmlinux ]; then
    echo "Downloading Firecracker kernel..."
    curl -fsSL "$KERNEL_URL" | tar xz --strip-components=1 "release-${FC_VERSION}-${ARCH}/vmlinux-*"
    mv vmlinux-* vmlinux 2>/dev/null || true
fi

# Check for firecracker binary
if ! command -v firecracker &> /dev/null; then
    echo "Firecracker binary not found in PATH"
    echo "Please install Firecracker or add it to your PATH"
    echo "Download from: https://github.com/firecracker-microvm/firecracker/releases"
    exit 1
fi

echo "Firecracker setup complete"
echo "Kernel: $FC_DIR/kernel/vmlinux"
echo "Binary: $(which firecracker)"
