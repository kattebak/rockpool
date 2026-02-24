# EDD: Devcontainer Support for Workspaces

| Field        | Value                                                                                                                                                                                                                        |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Author       | mvhenten                                                                                                                                                                                                                     |
| Status       | Draft                                                                                                                                                                                                                        |
| Created      | 2026-02-24                                                                                                                                                                                                                   |
| Updated      | 2026-02-24                                                                                                                                                                                                                   |
| Related EDDs | [EDD-002](002_MicroVM_Runtime.md), [EDD-004](004_Web_IDE.md), [EDD-005](005_Workspace_Image_Pipeline.md), [EDD-011](011_Workspace_Service_Refactor.md), [EDD-003](003_Caddy_Reverse_Proxy.md), [EDD-001](001_Architecture_Overview.md) |

## Summary

Add per-workspace customization via the Dev Containers specification. When a repository contains a `.devcontainer/devcontainer.json`, Rockpool builds a Podman container from it and runs code-server inside that container instead of directly on the VM host. When no devcontainer config is present, behavior is unchanged -- code-server runs on the VM host as it does today. The VM becomes a thin shell (Podman + internal SSH + systemd) and the container becomes the user's development environment.

## Prerequisites

- [EDD-002](002_MicroVM_Runtime.md) -- Tart runtime, `configure()` hook via internal SSH
- [EDD-004](004_Web_IDE.md) -- code-server as the IDE, `--abs-proxy-base-path` for path-based routing
- [EDD-005](005_Workspace_Image_Pipeline.md) -- Packer base image, Debian minimal, no Docker (Podman/Buildah)
- [EDD-011](011_Workspace_Service_Refactor.md) -- workspace-service owns lifecycle, `provisionAndStart()` calls `configure()`
- [EDD-003](003_Caddy_Reverse_Proxy.md) -- Caddy routes workspace traffic to VM port 8080

## Problem

Today every Rockpool workspace runs the same base image: Debian minimal with a fixed set of tools (node, python, git, make, etc.). Users cannot customize the language runtime, system packages, or development tools for a specific project. Adding per-workspace customization requires a standard, portable, well-documented format that works with container tooling.

## Requirements

| Requirement                                | Priority | Notes                                                                     |
| ------------------------------------------ | -------- | ------------------------------------------------------------------------- |
| Detect `.devcontainer/devcontainer.json`   | Must     | Auto-detect during provisioning                                           |
| Build and run devcontainer with Podman     | Must     | No Docker -- Podman/Buildah per EDD-005                                   |
| Run code-server inside the container       | Must     | Avoids remote-in-remote chaining problem                                  |
| Fall back to current behavior when absent  | Must     | No devcontainer.json = code-server on VM host                             |
| Persistent workspace data across restarts  | Must     | Podman named volume survives container rebuilds                           |
| Port forwarding through Caddy              | Must     | Container ports exposed to VM host, then routed by Caddy                  |
| Support `features` in devcontainer.json    | Should   | Dev Container Features are the primary extension mechanism                |
| Support lifecycle hooks                    | Should   | `postCreateCommand`, `postStartCommand`                                   |
| Support `forwardPorts`                     | Later    | Auto-detection of ports inside the container                              |
| Support Docker Compose in devcontainer     | Later    | Multi-container setups (databases, caches) via `docker-compose.yml`       |
| Support custom Dockerfile                  | Should   | `"build": { "dockerfile": "Dockerfile" }` in devcontainer.json           |
| SSH exposed to users                       | No       | Internal SSH only, for the `configure()` hook                             |

## How Dev Containers Work

The [Development Container Specification](https://containers.dev/) defines a JSON format (`.devcontainer/devcontainer.json`) for configuring a container as a development environment. The key properties:

- **`image`** -- base container image (e.g. `mcr.microsoft.com/devcontainers/javascript-node:18`)
- **`build.dockerfile`** -- path to a custom Dockerfile
- **`features`** -- installable tool packages from the [Dev Container Features registry](https://containers.dev/features) (e.g. `ghcr.io/devcontainers/features/node:1`)
- **`forwardPorts`** -- ports to expose from the container
- **`postCreateCommand`** -- command to run after container creation (e.g. `npm install`)
- **`postStartCommand`** -- command to run on every container start
- **`mounts`** -- additional volume mounts
- **`remoteUser`** -- the user to run as inside the container
- **`containerEnv`** -- environment variables set inside the container
- **`customizations.vscode.extensions`** -- VS Code extensions to install (code-server compatible)

The `@devcontainers/cli` npm package provides a CLI tool (`devcontainer`) that builds, creates, and runs containers from a `devcontainer.json`. It supports `--docker-path podman` to use Podman instead of Docker.

### Key CLI commands

```bash
# Build and start the container
devcontainer up --workspace-folder /path/to/repo --docker-path podman

# Returns JSON: {"outcome":"success","containerId":"abc123","remoteUser":"vscode","remoteWorkspaceFolder":"/workspaces/repo"}

# Execute a command inside the running container
devcontainer exec --workspace-folder /path/to/repo --docker-path podman code-server --bind-addr 0.0.0.0:8080

# Build the container image without starting it
devcontainer build --workspace-folder /path/to/repo --docker-path podman
```

## Architecture

### Devcontainer Resolution

The devcontainer.json can come from three sources, checked in order:

```
resolveDevcontainer(workspaceFolder)
  |
  +-- 1. Repo contains .devcontainer/devcontainer.json?
  |      → Use it (user's own config)
  |
  +-- 2. No devcontainer.json, but project type is detectable?
  |      (package.json → Node, requirements.txt → Python, go.mod → Go, etc.)
  |      → Generate a default devcontainer.json for that stack
  |
  +-- 3. User selected a template at workspace creation?
  |      (e.g. "Node 22", "Python 3.12", "Go 1.23")
  |      → Use the Rockpool-provided template
  |
  +-- 4. None of the above
         → No devcontainer (current behavior, code-server on VM host)
```

All three devcontainer sources funnel into the same `configureWithDevcontainer()` path. The only difference is where the `devcontainer.json` comes from.

**Project type detection** is a simple file-existence check via SSH. A mapping of marker files to default devcontainer configs:

| Marker file          | Stack  | Default image                                            |
| -------------------- | ------ | -------------------------------------------------------- |
| `package.json`       | Node   | `mcr.microsoft.com/devcontainers/javascript-node:22`     |
| `requirements.txt`   | Python | `mcr.microsoft.com/devcontainers/python:3.12`            |
| `pyproject.toml`     | Python | `mcr.microsoft.com/devcontainers/python:3.12`            |
| `go.mod`             | Go     | `mcr.microsoft.com/devcontainers/go:1.23`                |
| `Cargo.toml`         | Rust   | `mcr.microsoft.com/devcontainers/rust:1`                 |
| `Gemfile`            | Ruby   | `mcr.microsoft.com/devcontainers/ruby:3.3`               |

The generated `devcontainer.json` is written to `.devcontainer/devcontainer.json` in the workspace so the user can see and customize it. This makes the auto-detection transparent -- users discover the devcontainer spec naturally and can modify it.

**Templates** are Rockpool-maintained devcontainer.json files stored on the host (e.g. in `~/.rockpool/templates/`). The workspace creation API could accept an optional `template` parameter. This is a future enhancement -- auto-detection covers most cases.

**Repo inspection before create** -- if the workspace creation API accepts a git URL (future), Rockpool could inspect the repo (shallow clone or GitHub API) before VM creation to determine whether a devcontainer.json exists and what project type it is. This enables showing the user what will happen ("This repo has a devcontainer.json with Node 20 + PostgreSQL") before committing to the build.

### Two-Path Model

The `configure()` hook in `TartRuntime` (called by `provisionAndStart()` after VM boot) resolves the devcontainer config and takes the appropriate path:

```
configure(name, env)
  |
  +-- resolveDevcontainer(workspaceFolder)
  |
  +-- Has devcontainer.json? (from repo, auto-detected, or template)
  |
  +-- YES: Devcontainer path
  |     1. devcontainer up --workspace-folder /home/admin/workspace --docker-path podman
  |     2. devcontainer exec ... code-server --bind-addr 0.0.0.0:8080 --abs-proxy-base-path /workspace/{name}
  |     3. code-server runs INSIDE the container, listening on container port 8080
  |     4. Podman publishes container:8080 -> VM:8080
  |
  +-- NO: Current path (unchanged)
        1. Write code-server config.yaml
        2. systemctl restart code-server@admin
        3. code-server runs on VM host, listening on port 8080
```

### Request Flow (Devcontainer Mode)

```
Browser --> Caddy (srv1) --> VM (port 8080) --> Podman container --> code-server
```

Caddy's configuration does not change. It still routes `/workspace/{name}/*` to `VM_IP:8080`. The difference is that port 8080 on the VM is now a Podman-published port forwarding to the container, rather than a process listening directly on the VM host.

### Request Flow (No Devcontainer, Unchanged)

```
Browser --> Caddy (srv1) --> VM (port 8080) --> code-server (on VM host)
```

### Port Forwarding (User-Registered Ports)

When a user runs a dev server on port 3000 inside the container and registers it via the API:

```
Browser --> Caddy (srv2) --> VM (port 3000) --> Podman container --> dev server
```

The `devcontainer up` command publishes ports listed in `forwardPorts` from the container to the VM host. For user-registered ports not in `forwardPorts`, additional `podman port` mapping is needed (or we run the container with `--network=host`).

The simplest approach for Phase 1: run the Podman container with `--network=host`. This means all ports the container listens on are directly accessible on the VM's IP. No explicit port mapping is required. This matches the current behavior where code-server and dev servers all listen on the VM's network directly.

## Implementation

### Phase 1: Base Image Changes

#### Install Podman and devcontainer CLI in the Base Image

Add to `images/scripts/setup.sh`:

```bash
# Podman (rootless container runtime)
$SUDO apt-get install -y -qq podman buildah slirp4netns fuse-overlayfs

# Node.js is already installed; install devcontainer CLI globally
$SUDO npm install -g @devcontainers/cli
```

Podman runs rootless as the `admin` user. No Docker daemon, no root privileges for container operations. `slirp4netns` provides rootless networking. `fuse-overlayfs` provides efficient storage for rootless containers.

The `devcontainer` CLI is an npm package (`@devcontainers/cli`) that requires Node.js, which is already in the base image.

#### Podman Storage Configuration

Rootless Podman needs storage configured for the `admin` user. Add to `setup.sh`:

```bash
$SUDO mkdir -p /home/${CS_USER}/.config/containers
$SUDO tee /home/${CS_USER}/.config/containers/storage.conf >/dev/null <<EOF
[storage]
driver = "overlay"

[storage.options.overlay]
mount_program = "/usr/bin/fuse-overlayfs"
EOF
$SUDO chown -R ${CS_USER}:${CS_USER} /home/${CS_USER}/.config/containers
```

#### Image Size Impact

Adding Podman, Buildah, slirp4netns, and fuse-overlayfs increases the base image by approximately 150-200 MB. The devcontainer CLI adds approximately 50 MB (Node.js modules). This is acceptable given the base image already includes Node.js, Python, and build tools.

### Phase 2: Changes to `configure()`

The current `configure()` method in `packages/runtime/src/tart-runtime.ts`:

```typescript
async configure(name: string, env: Record<string, string>): Promise<void> {
    const workspaceName = env.ROCKPOOL_WORKSPACE_NAME;
    if (!workspaceName) return;
    const vmIp = await getIpForVm(name);
    // ... write code-server config, restart service
}
```

The new `configure()` detects devcontainer.json and takes the appropriate path:

```typescript
async configure(name: string, env: Record<string, string>): Promise<void> {
    const workspaceName = env.ROCKPOOL_WORKSPACE_NAME;
    if (!workspaceName) return;

    const vmIp = await getIpForVm(name);
    const hasDevcontainer = await sshExec(vmIp,
        "test -f /home/admin/workspace/.devcontainer/devcontainer.json && echo yes || echo no"
    );

    if (hasDevcontainer.trim() === "yes") {
        await configureWithDevcontainer(vmIp, workspaceName);
    } else {
        await configureWithoutDevcontainer(vmIp, workspaceName);
    }
}
```

#### `configureWithoutDevcontainer` (Current Behavior)

Identical to today's code: write `config.yaml`, restart `code-server@admin`.

#### `configureWithDevcontainer`

```typescript
async function configureWithDevcontainer(vmIp: string, workspaceName: string): Promise<void> {
    // 1. Stop the host code-server (we'll run it inside the container instead)
    await sshExec(vmIp, "sudo systemctl stop code-server@admin");

    // 2. Build and start the devcontainer
    //    --docker-path podman: use Podman instead of Docker
    //    --workspace-folder: the cloned repo directory
    //    --mount: persistent volume for VS Code server data (extensions, settings)
    await sshExec(vmIp, [
        "devcontainer up",
        "--docker-path podman",
        "--workspace-folder /home/admin/workspace",
        '--mount "type=volume,source=vscode-server,target=/home/admin/.vscode-server"',
        '--remote-env "ROCKPOOL_WORKSPACE_NAME=' + workspaceName + '"',
    ].join(" "));

    // 3. Install code-server inside the container and start it
    await sshExec(vmIp, [
        "devcontainer exec",
        "--docker-path podman",
        "--workspace-folder /home/admin/workspace",
        'bash -c "curl -fsSL https://code-server.dev/install.sh | sh"',
    ].join(" "));

    // 4. Start code-server inside the container (background, nohup)
    await sshExec(vmIp, [
        "devcontainer exec",
        "--docker-path podman",
        "--workspace-folder /home/admin/workspace",
        'bash -c "nohup code-server',
        "--bind-addr 0.0.0.0:8080",
        "--auth none",
        "--disable-telemetry",
        "--abs-proxy-base-path /workspace/" + workspaceName,
        '> /tmp/code-server.log 2>&1 &"',
    ].join(" "));
}
```

The SSH timeout for `configure()` needs to increase significantly. Building a devcontainer image on first run can take minutes depending on the base image and features. Subsequent starts reuse the cached image and are fast.

### Phase 3: Container Networking

#### Phase 1 Approach: `--network=host`

For the initial implementation, the container runs with `--network=host` (added via `runArgs` in the generated devcontainer config or via `--additional-features`). This means:

- code-server on port 8080 inside the container is accessible at `VM_IP:8080`
- Dev servers on port 3000 inside the container are accessible at `VM_IP:3000`
- No port mapping configuration required
- Caddy routes work without any changes

To pass `--network=host` to Podman via the devcontainer CLI, we override the devcontainer configuration:

```bash
devcontainer up \
    --docker-path podman \
    --workspace-folder /home/admin/workspace \
    --override-config /home/admin/.rockpool/devcontainer-override.json
```

Where `/home/admin/.rockpool/devcontainer-override.json` contains:

```json
{
    "runArgs": ["--network=host"]
}
```

The `--override-config` flag merges this with the project's `devcontainer.json`, adding host networking without modifying the user's configuration.

#### Future: Bridge Networking with Port Mapping

If host networking causes issues (port conflicts, security concerns), switch to bridge networking with explicit port mapping. This requires:

1. Parsing `forwardPorts` from `devcontainer.json`
2. Adding `-p` flags to the container for each port
3. Dynamically mapping user-registered ports via `podman port add`

Deferred until needed.

### Phase 4: Persistence

#### Workspace Data

The user's code lives at `/home/admin/workspace` on the VM. This is bind-mounted into the container by `devcontainer up` (the `--workspace-folder` flag handles this automatically). Since the VM disk is persistent across stop/start cycles (per [EDD-005](005_Workspace_Image_Pipeline.md)), the workspace data survives VM restarts.

#### VS Code Extensions and Settings

code-server stores extensions and settings in `~/.local/share/code-server/`. Inside the container, this path may differ. Use a Podman named volume to persist this data across container rebuilds:

```bash
--mount "type=volume,source=code-server-data,target=/home/admin/.local/share/code-server"
```

Podman named volumes are stored on the VM disk and survive container rebuilds. When the user rebuilds their devcontainer (e.g. after changing `devcontainer.json`), their extensions and settings are preserved.

#### Container Image Cache

Podman stores built images in its local store (`~/.local/share/containers/`). Since the VM disk persists, built images survive VM stop/start cycles. The first `devcontainer up` after cloning is slow (image pull + build); subsequent starts reuse the cached image.

### Phase 5: code-server Inside the Container

#### Why Not Run code-server on the VM Host?

code-server on VS Code is architecturally a "remote" connection. The VS Code Remote Extensions protocol does not support chaining (connecting to a remote that itself connects to another remote). If code-server runs on the VM host and tries to use the Dev Containers extension to connect into the Podman container, it fails because the extension expects to be the first remote hop.

By running code-server inside the container from the start, there is no chaining. code-server sees the container's filesystem as its local filesystem. Extensions, terminal sessions, language servers -- everything runs inside the container. The devcontainer's `customizations.vscode.extensions` property installs extensions directly into this code-server instance.

#### Installing code-server in the Container

Two approaches:

**Option A: Install at runtime (Phase 1)**

After `devcontainer up`, use `devcontainer exec` to install code-server via the install script. Simple but adds 30-60 seconds to first boot.

```bash
devcontainer exec --docker-path podman --workspace-folder /home/admin/workspace \
    bash -c "curl -fsSL https://code-server.dev/install.sh | sh"
```

**Option B: Dev Container Feature (Later)**

Create a custom Dev Container Feature that installs code-server. Users add it to their `devcontainer.json`:

```json
{
    "features": {
        "ghcr.io/rockpool/features/code-server:1": {}
    }
}
```

Or Rockpool injects it automatically via `--override-config`. This bakes code-server into the container image during build, making subsequent starts instant.

### Supported devcontainer.json Properties (Phase 1)

| Property                             | Supported | Notes                                                  |
| ------------------------------------ | --------- | ------------------------------------------------------ |
| `image`                              | Yes       | Base container image                                   |
| `build.dockerfile`                   | Yes       | Custom Dockerfile                                      |
| `build.context`                      | Yes       | Build context directory                                |
| `features`                           | Yes       | Dev Container Features                                 |
| `postCreateCommand`                  | Yes       | Runs after container creation                          |
| `postStartCommand`                   | Yes       | Runs on every start                                    |
| `containerEnv`                       | Yes       | Environment variables                                  |
| `remoteUser`                         | Yes       | User inside container                                  |
| `mounts`                             | Yes       | Additional volume mounts                               |
| `customizations.vscode.extensions`   | Partial   | code-server supports Open VSX, not all extensions      |
| `customizations.vscode.settings`     | Partial   | Most settings work; some are VS Code Desktop-specific  |
| `forwardPorts`                       | No        | Deferred; host networking makes all ports accessible   |
| `portsAttributes`                    | No        | Deferred; depends on `forwardPorts`                    |
| `docker-compose.yml`                 | No        | Multi-container setups deferred                        |
| `initializeCommand`                  | No        | Runs on host before container creation; not applicable |
| `hostRequirements`                   | No        | VM resources are fixed at creation time                |

### Deferred: devcontainer.json Properties for Later Phases

- **`forwardPorts`** -- Automatic port detection and forwarding. With host networking, all ports are already accessible, so the declarative `forwardPorts` is informational only. In a future bridge networking mode, these would drive `-p` flags.
- **`docker-compose.yml`** -- Multi-container setups (app + database + cache). Requires `podman-compose` or `podman compose` in the base image. Significant additional complexity.
- **`initializeCommand`** -- Runs on the host machine before container creation. In Rockpool's model, the "host" is the VM, not the user's laptop. Semantics are unclear; defer.
- **`hostRequirements`** -- CPU, memory, GPU requirements. VMs have fixed resources at creation; dynamic resizing is not supported.

## Workspace Provisioning Flow (Updated)

The full provisioning flow with devcontainer support, building on the `provisionAndStart()` method from [EDD-011](011_Workspace_Service_Refactor.md):

```
provisionAndStart(id)
  1. Check VM status (runtime.status)
  2. Create VM if not found (runtime.create + runtime.start)
  3. Start VM if stopped (runtime.start)
  4. Get VM IP (runtime.getIp)
  5. Clone repo into /home/admin/workspace (if git URL provided) [future]
  6. Configure workspace (runtime.configure)
     a. SSH into VM
     b. Check for .devcontainer/devcontainer.json
     c. If present:
        - Stop host code-server
        - devcontainer up (build + start container)
        - Install code-server in container
        - Start code-server in container
     d. If absent:
        - Write code-server config
        - Restart host code-server
  7. Health check (curl VM_IP:8080)
  8. Add Caddy route
  9. Update DB status to running
```

Steps 1-4 and 7-9 are unchanged. Only step 6 (configure) gains the devcontainer branch.

## Timeout Adjustments

Building a devcontainer image on first run is significantly slower than the current configure step:

| Operation                    | Current timeout | New timeout | Rationale                                    |
| ---------------------------- | --------------- | ----------- | -------------------------------------------- |
| `configure()` SSH retry loop | 60s             | 60s         | Unchanged; SSH connection itself is fast      |
| `configure()` total          | ~60s            | 600s        | devcontainer build can pull large images      |
| Health check                 | 30s             | 30s         | Unchanged; code-server starts quickly         |
| SQS visibility timeout       | 120s            | 900s        | Must exceed total provisioning time           |

The worker's SQS visibility timeout (currently 120s per [EDD-014](014_ElasticMQ_Worker_Separation.md)) must be increased to accommodate devcontainer builds. A workspace with a complex Dockerfile and multiple Features can take 5-10 minutes on first build.

## Data Model Changes

No schema changes required. The workspace entity remains unchanged:

- `image` field continues to identify the base VM image (not the container image)
- Devcontainer configuration lives in the repository, not in the Rockpool database
- Whether a workspace uses devcontainers is determined at runtime from the repo contents

A future enhancement could add a `devcontainer` boolean or `containerStatus` field to the workspace entity for display in the UI, but this is not needed for Phase 1.

## Alternatives Considered

### Devfile (Red Hat)

[Devfile](https://devfile.io/) is Red Hat's format for defining development environments. It is Kubernetes-native and container-first.

**Why not:** Devfile assumes Kubernetes orchestration (pods, services, volumes). Its container component maps to Kubernetes pod spec, not to standalone container runtimes. Running a single Podman container from a Devfile requires translating Kubernetes concepts into Podman commands -- the abstraction is a poor fit. Devfile also has minimal adoption outside Red Hat's ecosystem (Eclipse Che, OpenShift Dev Spaces).

### Custom `rockpool.yaml`

A bespoke Rockpool configuration file defining system packages, language runtimes, and tools.

**Why not:** Inventing a custom format means writing a custom parser, custom executor, and documentation. The Dev Container spec already solves this problem with broad tooling support, a large feature registry, and thousands of existing configurations in the wild. Users can bring their existing devcontainer.json files from VS Code, GitHub Codespaces, or JetBrains.

### Exposing SSH to Users

Let users SSH into the VM and configure it themselves.

**Why not:** Exposing SSH breaks the isolation model. The VM's SSH is an internal provisioning mechanism (key-based, no password), not a user-facing service. Exposing it means managing SSH keys, firewall rules, and explaining the VM/container distinction to users. The devcontainer approach gives users a declarative configuration file instead of imperative SSH access.

### Docker Instead of Podman

Use Docker (dockerd) inside the VM.

**Why not:** [EDD-005](005_Workspace_Image_Pipeline.md) explicitly mandates Podman/Buildah over Docker. Docker requires a daemon running as root. Podman is daemonless and runs rootless. The devcontainer CLI supports `--docker-path podman` for Podman compatibility.

## Resolved Questions

- [x] How does code-server avoid the remote-in-remote chaining problem? **Run code-server inside the container from the start.** There is no remote chain -- code-server sees the container's filesystem as local. The VS Code Remote Extensions limitation (one remote at a time) does not apply because there is only one remote connection (browser to code-server).
- [x] How does Caddy route to a container? **It does not know about containers.** Caddy routes to `VM_IP:8080`. Whether that port is a host process or a Podman-published port is transparent to Caddy.
- [x] How does workspace data persist? **VM disk is persistent.** The workspace directory is bind-mounted into the container. Podman named volumes store container-specific state (extensions, settings). Both survive VM stop/start cycles.
- [x] Do we need Docker Compose? **Not for Phase 1.** Single-container devcontainers cover most use cases. Multi-container setups (app + DB) can be deferred.
- [x] How does the devcontainer CLI interact with Podman? **Via `--docker-path podman`.** The CLI invokes Podman's Docker-compatible interface. Podman 5+ provides full CLI compatibility.
- [x] Do we need to modify the Caddy routing layer? **No.** Host networking means container ports are VM ports. Caddy routes are unchanged.
- [x] What about rootless Podman and port binding? **Host networking sidesteps the issue.** With `--network=host`, the container shares the VM's network namespace. No rootless port-binding restrictions apply.

## Open Questions

- [ ] Should Rockpool auto-inject a code-server Feature into every devcontainer, or install it at runtime? Auto-injection via `--override-config` would be cleaner but requires building or hosting a custom Feature.
- [ ] What is the UX for "devcontainer build failed"? The error message from `devcontainer up` needs to be surfaced to the user, either in the loading page or in the workspace error state.
- [ ] Should the workspace creation API accept a git repository URL to clone before running devcontainer up? Currently, workspace creation only takes a name and image. Cloning a repo is a natural next step but orthogonal to devcontainer support.
- [ ] How should container rebuilds work? If a user changes their `devcontainer.json`, they need a way to trigger a rebuild. This could be a new API endpoint or a code-server extension.
- [ ] What is the disk space budget? Podman images, container layers, and the devcontainer CLI add to the base image size. Need to measure the actual impact on the 20 GB disk.

## Implementation Plan

### Phase 1: Base Image (Podman + devcontainer CLI)

1. Add Podman, Buildah, slirp4netns, fuse-overlayfs to `images/scripts/setup.sh`
2. Install `@devcontainers/cli` globally via npm in `setup.sh`
3. Configure rootless Podman storage for `admin` user
4. Rebuild base image with `packer build`
5. Verify: `ssh admin@VM podman info` works, `devcontainer --version` works

### Phase 2: Two-Path `configure()`

1. Add devcontainer detection to `configure()` in `packages/runtime/src/tart-runtime.ts`
2. Implement `configureWithDevcontainer()` using SSH + devcontainer CLI
3. Implement `configureWithoutDevcontainer()` (extract current code)
4. Increase SSH command timeouts for devcontainer builds
5. Increase SQS visibility timeout in `elasticmq.conf`
6. Verify: create workspace with a repo containing `.devcontainer/devcontainer.json`, code-server loads inside container

### Phase 3: Persistence and Polish

1. Add Podman named volume for code-server data (extensions, settings)
2. Add `--override-config` for host networking
3. Test stop/start cycle: container and code-server restart correctly
4. Test devcontainer rebuild: change `devcontainer.json`, reprovision
5. Surface devcontainer build errors in workspace error state

### Phase 4: code-server Feature (Optional)

1. Create a Dev Container Feature that installs code-server
2. Publish to a container registry (OCI artifact)
3. Auto-inject the feature via `--override-config` in `configureWithDevcontainer()`
4. Eliminate the runtime `curl | sh` install step

## Testing Strategy

### Manual Testing

- Create workspace with no devcontainer.json: verify current behavior unchanged
- Create workspace with simple devcontainer.json (`"image": "node:20"`): verify code-server runs inside container
- Create workspace with Dockerfile-based devcontainer: verify custom image builds
- Create workspace with Features (e.g. Python, Go): verify tools available in code-server terminal
- Stop and start workspace: verify container restarts, extensions preserved
- Register a port inside the container: verify Caddy routes traffic correctly

### Unit Tests

- `configure()` detection logic: mock SSH to return yes/no for devcontainer check
- `configureWithDevcontainer()`: mock SSH commands, verify correct devcontainer CLI invocations
- `configureWithoutDevcontainer()`: verify identical to current behavior

### Integration Tests (E2E)

- Full provisioning flow with a test repo containing `.devcontainer/devcontainer.json`
- Health check passes after devcontainer build
- code-server accessible via Caddy route
- Terminal session inside code-server shows container filesystem

## Appendix: Global User Settings (Future)

This appendix captures ideas for per-user IDE settings that persist across workspaces. This is out of scope for the devcontainer work but builds on the same infrastructure.

### Problem

Users want their IDE preferences (theme, keybindings, font size, default extensions) to follow them across workspaces. The devcontainer spec handles per-project customization (`customizations.vscode.settings`), but not per-user preferences.

### VS Code Settings Sync Is Not Viable

code-server does not support VS Code's native Settings Sync ([open since 2020, still backlog](https://github.com/coder/code-server/issues/2195)). The sync protocol is internal to Microsoft and has no public service provider API. Gitpod solved this by [forking OpenVSCode Server](https://github.com/gitpod-io/openvscode-server/pull/337) and patching the sync service URL -- significant maintenance burden.

### Proposed Approach: Shared Host Directory via Tart `--dir`

Tart supports `--dir` to mount a host directory into the VM via virtiofs. Mount a per-user settings directory from the host into every workspace VM:

```
Host:  ~/.rockpool/users/{userId}/vscode-settings/
  ├── settings.json
  ├── keybindings.json
  └── snippets/

VM:    /mnt/rockpool-settings/   (virtiofs mount via tart --dir)
```

During `configure()`, symlink the mounted files into code-server's config path:

```bash
ln -sf /mnt/rockpool-settings/settings.json ~/.local/share/code-server/User/settings.json
ln -sf /mnt/rockpool-settings/keybindings.json ~/.local/share/code-server/User/keybindings.json
```

**Why this works:**

- **No sync protocol.** All workspaces for the same user mount the same host directory. A settings change in one workspace is immediately visible in the next workspace that reads the file.
- **No API endpoints.** No watcher, no push/pull, no concurrency. It's a shared filesystem.
- **Boot-time injection is free.** `configure()` just creates symlinks; the files are already there via the mount.
- **code-server watches its own settings file.** Changes made in one workspace may be picked up by already-running workspaces (VS Code reloads `settings.json` on external modification).

**Scope of the mount:**

The mounted directory contains only settings files -- not the user's home directory, not Rockpool internals. The VM can only see what Rockpool puts in that directory. A workspace cannot access other users' settings or escape the mount.

**Security consideration:** a malicious workspace could write arbitrary content to the shared mount, which other workspaces would read. Threat model is low (same user's workspaces, not multi-tenant), but worth noting. Validation of JSON before symlinking is a possible mitigation.

### Alternative Considered: Push-on-Change via inotify

Watch settings files inside the VM with `inotifywait`, push changes back to a Rockpool API on every save. Rejected because the VM cannot reach the control plane (NAT network, no known API address). Reversing the direction (Rockpool polls the VM via SSH) adds latency and complexity. The shared mount approach avoids the network problem entirely.

### Alternative Considered: Sync on Stop

Capture settings when a workspace stops, store in Rockpool's DB, inject on next workspace boot. Rejected due to concurrency: if workspace A stops after workspace B, A's stale settings overwrite B's newer ones. Resolving this requires timestamps or conflict resolution -- unnecessary complexity when the shared mount gives real-time consistency for free.

### Prerequisites

- Tart `--dir` mount support (needs verification for Linux guest VMs)
- User identity model in Rockpool (currently single-user; multi-user would need per-user mount paths)
- Changes to `TartRuntime.start()` to pass `--dir` flag
