#!/usr/bin/env bash
set -euo pipefail

# Tart-specific user setup — runs as admin via packer SSH
# Installs fnm and Node.js LTS into admin's home directory.

curl -fsSL https://fnm.vercel.app/install | bash
# shellcheck disable=SC2016
export PATH="$HOME/.local/share/fnm:$PATH" && eval "$(fnm env)" && fnm install --lts
