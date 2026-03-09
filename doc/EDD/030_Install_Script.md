# EDD: Install Script

| Field        | Value                                                          |
| ------------ | -------------------------------------------------------------- |
| Author       | mvhenten                                                       |
| Status       | Draft                                                          |
| Created      | 2026-03-09                                                     |
| Updated      | 2026-03-09                                                     |
| Related ADRs | [ADR-014](../ADR/014-build-tooling-conventions.md)             |
| Related EDDs | [EDD-029](029_CLI.md)                                         |

## Summary

Provide a single curl-able bash script (`install.sh`) that installs Rockpool from GitHub into `~/.rockpool/`, makes the `rockpool` CLI globally available, and optionally runs `rockpool init` with user-supplied flags. The script is idempotent: re-running it updates an existing installation.

## Motivation

New users currently need to clone the repo, install dependencies, and figure out how to get the `rockpool` command on their PATH. This multi-step process is a friction point. A one-liner install command reduces the barrier to entry:

```bash
curl -fsSL https://raw.githubusercontent.com/kattebak/rockpool/main/install.sh | bash
```

## Prerequisites

- [EDD-029: CLI](029_CLI.md) -- the `rockpool` CLI that this script installs
- Node.js >= 22, npm, and podman must be available on the host

## Install Flow

### Step 1: Prerequisite Checks

The script verifies three tools are available and at the required version:

| Tool    | Check                                              | Required version |
| ------- | -------------------------------------------------- | ---------------- |
| node    | `node --version` parses major >= 22                | >= 22            |
| npm     | `command -v npm`                                   | any              |
| podman  | `command -v podman`                                | any              |

Each check fails fast with a clear error message and a link to installation instructions.

### Step 2: Clone or Update

If `~/.rockpool/` does not exist, clone the repository:

```bash
git clone https://github.com/kattebak/rockpool.git ~/.rockpool
```

If it already exists, pull the latest changes:

```bash
git -C ~/.rockpool pull --ff-only
```

Using `--ff-only` prevents the pull from creating merge commits or entering conflict resolution. If the local checkout has diverged, the script fails with instructions to resolve manually.

### Step 3: Install Dependencies

```bash
npm install --prefix ~/.rockpool
```

The `preinstall` script in `package.json` runs `make ci` which builds the generated packages. This is the same flow as a normal development setup.

### Step 4: Global CLI Link

```bash
npm link -w packages/cli --prefix ~/.rockpool
```

This creates a symlink in npm's global bin directory that points to `packages/cli/src/bin.ts`. Since the bin entry uses Node 22's native TypeScript support via the shebang `#!/usr/bin/env -S node --experimental-strip-types --no-warnings`, no build step is needed.

After linking, the `rockpool` command is available globally.

### Step 5: Optional Init

If the user passed flags via `bash -s --`, forward them to `rockpool init`:

```bash
curl -fsSL ... | bash -s -- --auth-mode basic --auth-username admin --auth-password admin
```

When flags are present, the script runs `rockpool init <flags>` after installation. When no flags are given, it prints a message telling the user they can run `rockpool init` manually.

### Step 6: Post-Install Message

Print instructions:

```
Rockpool installed successfully.

Run 'rockpool init' to create a configuration file, then 'rockpool run' to start.
```

## CLI Path Resolution

The CLI must work both from within the repo (development) and when invoked globally after `npm link` (installed). The key insight: the repo root is always the directory three levels above `packages/cli/src/bin.ts`, regardless of where the user invokes the command.

### Config File Resolution

The config file path is resolved relative to the user's current working directory (`process.cwd()`), not the repo root. This lets users keep config files in their home directory or project directory.

### Repo Assets

Compose generation needs paths to repo assets (images, Caddyfile, elasticmq.conf). These are resolved relative to the repo root, which is derived from `import.meta.dirname`. This works for both development and global install because `npm link` creates a symlink to the actual source file, preserving the directory structure.

### Init Output

The `init` command writes the config file relative to `process.cwd()` (or to an absolute path if `-o` specifies one). The `$schema` reference becomes a URL pointing to the GitHub-hosted schema when running from outside the repo, ensuring IDE validation works regardless of install location.

## Idempotency

The script is safe to re-run:

1. **Clone vs pull**: checks for `~/.rockpool/` existence
2. **npm install**: safe to re-run, updates dependencies
3. **npm link**: safe to re-run, updates the symlink
4. **No data loss**: the script never deletes user data or config files

## Security Considerations

Piping curl output to bash is a common pattern but has inherent risks. The script is hosted in the same repository it installs, so users can audit it before running. The script does not require sudo and installs everything into the user's home directory.

## Testing Strategy

The install script is a bash script that orchestrates well-tested components. Verification:

1. **Shellcheck**: run `shellcheck install.sh` to catch common bash pitfalls
2. **Manual test**: run the full install flow on a clean environment
3. **Idempotent test**: run the script twice and verify the second run succeeds
4. **Flag pass-through test**: run with `--auth-mode basic --auth-username admin --auth-password admin` and verify config file is created

## Rollout Plan

1. Add `install.sh` to the repo root
2. Fix CLI path resolution for global usage
3. Document the install command in the project README
