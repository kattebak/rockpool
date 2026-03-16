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
    if ! command -v node &>/dev/null; then
        error "Node.js is not installed."
        error "Install from https://nodejs.org/ or use a version manager like nvm."
        exit 1
    fi

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

check_build_tools() {
    local missing=()

    if ! command -v python3 &>/dev/null; then
        missing+=("python3")
    fi

    if ! command -v make &>/dev/null; then
        missing+=("make")
    fi

    if ! command -v g++ &>/dev/null && ! command -v gcc &>/dev/null; then
        missing+=("g++ (or gcc)")
    fi

    if [ ${#missing[@]} -gt 0 ]; then
        error "Missing build tools required to compile native modules: ${missing[*]}"
        error "On Debian/Ubuntu:  sudo apt install python3 make g++"
        error "On Fedora/RHEL:    sudo dnf install python3 make gcc-c++"
        error "On macOS:          xcode-select --install"
        exit 1
    fi
}

info "Checking prerequisites..."
check_node_version
check_command "npm" "npm should come with Node.js. Reinstall Node from https://nodejs.org/"
check_command "podman" "Install from https://podman.io/docs/installation"
check_command "git" "Install git from https://git-scm.com/downloads"
check_build_tools
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
