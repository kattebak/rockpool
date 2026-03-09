#!/usr/bin/env bash
set -euo pipefail

ROCKPOOL_DIR="$HOME/.rockpool"
REPO_URL="https://github.com/kattebak/rockpool.git"

info() {
    printf '  %s\n' "$*"
}

error() {
    printf '  ERROR: %s\n' "$*" >&2
}

check_command() {
    if ! command -v "$1" &>/dev/null; then
        error "$1 is not installed."
        error "$2"
        exit 1
    fi
}

check_node_version() {
    local version
    version=$(node --version 2>/dev/null | sed 's/^v//')
    local major
    major=$(echo "$version" | cut -d. -f1)

    if [ -z "$major" ] || [ "$major" -lt 22 ]; then
        error "Node.js >= 22 is required (found: ${version:-none})."
        error "Install from https://nodejs.org/ or use a version manager like nvm."
        exit 1
    fi
}

info "Checking prerequisites..."
check_command "node" "Install from https://nodejs.org/ or use a version manager like nvm."
check_node_version
check_command "npm" "npm should come with Node.js. Reinstall Node from https://nodejs.org/"
check_command "podman" "Install from https://podman.io/docs/installation"
check_command "git" "Install git from https://git-scm.com/downloads"
info "All prerequisites met."

if [ -d "$ROCKPOOL_DIR" ]; then
    info "Updating existing installation..."
    git -C "$ROCKPOOL_DIR" pull --ff-only
else
    info "Cloning rockpool into $ROCKPOOL_DIR..."
    git clone "$REPO_URL" "$ROCKPOOL_DIR"
fi

info "Installing dependencies (this may take a minute)..."
(cd "$ROCKPOOL_DIR" && npm install)

info "Linking rockpool CLI globally..."
(cd "$ROCKPOOL_DIR" && npm link -w packages/cli)

if [ $# -gt 0 ]; then
    info "Running rockpool init with provided flags..."
    rockpool init "$@"
else
    printf '\n'
    info "Rockpool installed successfully."
    printf '\n'
    info "Get started:"
    info "  rockpool init    - create a configuration file"
    info "  rockpool run     - start the rockpool stack"
    printf '\n'
    info "For non-interactive setup:"
    info "  rockpool init --auth-mode basic --auth-username admin --auth-password admin"
    printf '\n'
fi
