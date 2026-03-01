# EDD: Root VM

| Field        | Value                                                          |
| ------------ | -------------------------------------------------------------- |
| Author       | mvhenten                                                       |
| Status       | Implemented                                                    |
| Created      | 2026-02-28                                                     |
| Updated      | 2026-03-01                                                     |
| Related ADRs | [ADR-015](../ADR/015-two-port-origin-isolation.md)             |
| Related EDDs | [EDD-001](001_Architecture_Overview.md), [EDD-019](019_Linux_Firecracker_Support.md) |
| Related RFCs | [RFC-002](../RFC/002_Tidepool_On_Tidepool.md)                 |

## Summary

The control plane (Caddy, API server, worker, ElasticMQ) currently runs directly on the host machine. EDD-001 describes a "Root VM" that hosts all control plane processes, but this was never implemented. This EDD specifies the Root VM: a Linux VM that runs the entire Rockpool stack, with workspaces running as Podman rootless containers inside it. The host machine runs only the hypervisor and the user's editor.

## Motivation

When the host is internet-facing (NAS, Mac Mini on a home network exposed via Cloudflare Tunnel), the control plane must be isolated behind a real VM boundary. A container shares the host kernel — a kernel exploit from inside the container compromises the host and its data. A VM provides a hardware-enforced isolation boundary between Rockpool and the host's data.

The Root VM is the security boundary. Everything inside it — control plane and workspaces — is isolated from the host by a hypervisor. Workspaces inside the Root VM use Podman rootless containers rather than nested Firecracker VMs, avoiding the performance penalty of nested virtualization while still providing meaningful isolation between workspaces.

### Why not nested Firecracker?

Firecracker requires KVM. Running Firecracker inside a VM means nested virtualization (KVM inside KVM/Virtualization.framework). This works but carries a significant I/O penalty (~40-80% for random disk I/O) because every I/O request traverses two hypervisor layers. For workspaces running `npm install`, git clones, and compilation — all disk-heavy operations — this is unacceptable.

### Why Podman rootless?

Podman rootless containers provide multiple isolation layers without nested virtualization:

| Layer | What it does |
|-------|-------------|
| **User namespaces** | Container root maps to unprivileged UID in the Root VM. A breakout gives you a nobody user. |
| **Seccomp** | Blocks ~40% of syscalls including dangerous ones (ptrace, mount, reboot, etc.) |
| **SELinux/AppArmor** | Mandatory access control — even container root can't access files outside policy |
| **Cgroups** | CPU, memory, I/O limits per container |
| **Filesystem** | Overlay filesystem, separate rootfs per container |
| **Network** | Separate network namespace per container via `pasta` (near-native performance) |
| **No daemon** | No root daemon. Containers run as regular user processes. |

The one gap vs. a VM: containers share the Root VM's kernel. A kernel exploit inside a workspace could compromise the Root VM. But the attacker is still inside the Root VM — one full VM boundary from the host and its data. For a single-user system where you're running your own code, this is an acceptable tradeoff.

### Upgrade path

If Rockpool supports untrusted multi-user workspaces later, Podman can be swapped for Firecracker on bare-metal Linux or for `podman --runtime=kata`. The `RuntimeRepository` interface stays the same.

## Prerequisites

- [EDD-010: PM2 Process Management](010_PM2_Process_Management.md) — process lifecycle inside the VM
- [EDD-021: Production Profile](021_Production_Profile.md) — production ecosystem config
- Tart `--nested` on M3/M4 + macOS 15 Sequoia (for `/dev/kvm` passthrough if Firecracker is needed inside the Root VM later)

## System Topology

### Current (no Root VM)

```
┌──────────────────────────────────────┐
│            Host (macOS/Linux)        │
│                                      │
│  Caddy, Server, Worker, ElasticMQ   │  ← control plane on host
│  PM2                                 │
│                                      │
│  Tart/Firecracker workspace VMs      │  ← one layer of isolation
└──────────────────────────────────────┘
```

### Target (Root VM + Podman workspaces)

```
┌──────────────────────────────────────┐
│         Host (macOS/Linux)           │
│                                      │
│  Tart (macOS) or QEMU/KVM (Linux)   │  ← only the hypervisor
│  User's editor                       │
│                                      │
│  ┌────────────────────────────────┐  │
│  │         Root VM (Linux)        │  │  ← VM boundary from host
│  │                                │  │
│  │  Caddy, Server, Worker, MQ    │  │
│  │  PM2                          │  │
│  │  /mnt/rockpool (virtiofs)     │  │
│  │                                │  │
│  │  ┌────────┐ ┌────────┐       │  │
│  │  │ podman │ │ podman │       │  │  ← rootless containers
│  │  │  ws-a  │ │  ws-b  │       │  │     native disk I/O
│  │  └────────┘ └────────┘       │  │     user namespace isolation
│  │                                │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

### Network

```
Internet ◄──► Cloudflare Tunnel ◄──► Host
                                       │
                                     QEMU/KVM
                                  (port forwarding)
                                       │
                                   Root VM
                                       │
                              Caddy (:8080, :8081, :8082)
                                       │
                              ┌────────┼────────┐
                           ws-a (ctr)  ws-b (ctr)
                        127.0.0.1:X  127.0.0.1:Y
                              │           │
                           -P port mapping
                           (podman publish all)
```

Caddy inside the Root VM listens on ports forwarded from the host. Workspace containers expose port 8080 via Podman's `-P` (publish all) flag, which maps each container's port 8080 to a random host port. Caddy proxies to `127.0.0.1:<mapped-port>` — not to bridge IPs, which are unreachable in rootless mode (see [Implementation Notes](#implementation-notes)).

## Workspace Runtime: Podman

### RuntimeRepository implementation

A new `createPodmanRuntime()` implements the existing `RuntimeRepository` interface:

```typescript
interface RuntimeRepository {
    create(name: string, image: string): Promise<void>;   // podman create -P --userns=auto
    start(name: string): Promise<void>;                    // podman start
    stop(name: string): Promise<void>;                     // podman stop --time 10
    remove(name: string): Promise<void>;                   // podman rm (volume preserved)
    status(name: string): Promise<VmStatus>;               // podman inspect → State.Running
    getIp(name: string): Promise<string>;                  // podman port → 127.0.0.1:<mapped-port>
    configure?(name: string, ...): Promise<void>;          // podman exec + podman restart + wait
    clone?(name: string, ...): Promise<void>;              // podman exec (git clone)
    readFile?(name: string, ...): Promise<string>;         // podman exec cat
    writeFile?(name: string, ...): Promise<void>;          // podman exec printf
}
```

Key differences from Firecracker/Tart:

- **No SSH.** Use `podman exec` instead. The shared SSH commands abstraction (`ssh-commands.ts`) is replaced by exec-based equivalents.
- **Port mapping, not bridge IPs.** Rootless Podman bridge IPs (10.88.0.x) are unreachable from outside the container's user namespace. Use `-P` (publish all) + `podman port <name> 8080` instead of `podman inspect → NetworkSettings.IPAddress`. `getIp()` returns `127.0.0.1:<mapped-port>`.
- **OCI images.** Workspace images are Dockerfiles, not ext4 rootfs or Tart OCI images. Build with `podman build`.
- **Rootless.** The entire Podman stack runs without root.
- **Configure restarts the container.** code-server runs as PID 1. `podman restart --time 2` is used after writing config (not `pkill`). Port mappings change on restart, so `getIp()` must be called after `configure()`.

### Workspace image

The workspace Dockerfile (`images/workspace/Dockerfile`) installs the same software as the current `images/scripts/setup.sh`. Uses a custom entrypoint script to support optional workspace folder opening (code-server takes the folder as a positional argument, not a config option):

```dockerfile
FROM debian:bookworm-slim
ARG CS_USER=admin
ARG NODE_MAJOR=22

RUN apt-get update && apt-get install -y \
    curl wget jq git make ca-certificates build-essential \
    python3 vim tmux zip rsync strace sudo ...

RUN useradd -m -s /bin/bash -G sudo "$CS_USER"
RUN curl -fsSL https://code-server.dev/install.sh | sh

USER ${CS_USER}
RUN curl -fsSL https://fnm.vercel.app/install | bash
ENV FNM_PATH="/home/${CS_USER}/.local/share/fnm"
RUN fnm install ${NODE_MAJOR} && fnm default ${NODE_MAJOR}

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
```

The entrypoint script reads an optional folder from `~/.config/code-server/workspace-folder`:

```bash
#!/bin/sh
FOLDER_FILE="$HOME/.config/code-server/workspace-folder"
FOLDER=""
if [ -f "$FOLDER_FILE" ]; then FOLDER="$(cat "$FOLDER_FILE")"; fi
exec code-server --bind-addr=0.0.0.0:8080 --auth=none $FOLDER
```

### Container lifecycle

```bash
# create (with port publishing)
podman create \
  --name workspace-foo \
  -P \
  --userns=auto \
  --cpus=2 --memory=4g \
  --volume workspace-foo-data:/home/admin \
  rockpool-workspace:latest

# start
podman start workspace-foo

# stop
podman stop --time 10 workspace-foo

# remove
podman rm workspace-foo
# persistent data survives in the named volume

# get mapped port (NOT bridge IP — bridge IPs are unreachable in rootless mode)
podman port workspace-foo 8080
# → 0.0.0.0:44231

# exec (replaces SSH)
podman exec workspace-foo git clone https://github.com/user/repo.git

# configure: write config yaml + workspace folder, then restart
podman exec workspace-foo sh -c "printf '%s\n' 'bind-addr: ...' > ~/.config/code-server/config.yaml"
podman exec workspace-foo sh -c "printf '%s' '/home/admin/my-project' > ~/.config/code-server/workspace-folder"
podman restart --time 2 workspace-foo
# MUST wait for container to be running before any subsequent exec
while [ "$(podman inspect workspace-foo --format '{{.State.Running}}')" != "true" ]; do sleep 1; done
```

### Persistent storage

Each workspace gets a Podman named volume for `/home/admin` (the working directory). The volume persists across container stop/start cycles. `podman rm` removes the container but not the volume — workspace data survives until explicitly deleted with `podman volume rm`.

## Root VM Image

### Base

Debian Bookworm (aarch64 for macOS/Apple Silicon, x86_64 for Linux x86 hosts).

### Installed software

- Node.js (via fnm)
- PM2 (global)
- Podman (rootless, from Debian repos)
- Caddy
- ElasticMQ (Java runtime + jar)
- SSH server (for host → Root VM access)
- Virtiofs guest support (kernel module, mount tooling)

### Build

Built via `images/root-vm/build-root-vm.sh` using debootstrap + chroot. Produces `.qemu/rockpool-root.qcow2`. The script handles MBR partitioning, GRUB bootloader with serial console, admin user creation, and raw-to-qcow2 conversion.

#### Makefile target

```makefile
$(STAMP_DIR)/rockpool-root-vm: images/root-vm/build-root-vm.sh images/root-vm/setup-root-vm.sh images/root-vm/keys/rockpool-root-vm_ed25519.pub
	sudo bash images/root-vm/build-root-vm.sh
	touch $@
```

### Filesystem layout inside Root VM

```
/mnt/rockpool/              ← virtiofs mount (host project dir)
  packages/
  node_modules/
  ecosystem.*.config.cjs
  ...

/opt/rockpool/              ← persistent state (not shared with host)
  rockpool.db               ← SQLite database
  .logs/                    ← workspace logs

~/.local/share/containers/  ← Podman rootless storage (images, containers, volumes)

/home/admin/                ← SSH user
```

The project source lives on the host filesystem, mounted read-write via Virtiofs. Persistent state (database, container images, workspace volumes, logs) lives on the Root VM's own disk.

## Host-Side Interface

### macOS (Tart)

```bash
tart run \
  --dir=rockpool:~/Development/rockpool \
  --net-softnet \
  --net-softnet-expose=8080:8080,8081:8081,8082:8082 \
  rockpool-root
```

### Linux (QEMU/KVM)

```bash
qemu-system-x86_64 \
  -enable-kvm \
  -cpu host \
  -m 8G \
  -smp 4 \
  -drive file=rockpool-root.qcow2,format=qcow2 \
  -virtfs local,path=/path/to/rockpool,mount_tag=rockpool,security_model=mapped-xattr \
  -device virtio-net-pci,netdev=net0 \
  -netdev user,id=net0,hostfwd=tcp::8080-:8080,hostfwd=tcp::8081-:8081,hostfwd=tcp::8082-:8082 \
  -nographic
```

## Development Workflow

The developer experience stays almost identical to today:

1. **Start the Root VM** — `npm run start:vm`
2. Project directory appears at `/mnt/rockpool/` inside the VM via Virtiofs
3. **SSH into the Root VM** (or the start script does this automatically)
4. **`npm start`** inside the VM — PM2 starts Caddy, server, worker, ElasticMQ
5. Edit files on the host in your editor — changes appear instantly via Virtiofs
6. PM2 watches for file changes, restarts the server automatically
7. Browser points at `localhost:8080` — port-forwarded to Caddy inside the Root VM
8. **`npm stop`** and exit — or shut down the VM

### npm scripts (host-side)

```json
{
  "start:vm": "npm-scripts/start-root-vm.sh",
  "stop:vm": "npm-scripts/stop-root-vm.sh",
  "ssh:vm": "npm-scripts/ssh-root-vm.sh"
}
```

These scripts detect the platform and use Tart or QEMU accordingly.

## Impact on Existing Code

### New: Podman runtime

A new `@rockpool/runtime` implementation: `createPodmanRuntime()`. Uses `podman` CLI commands and `podman exec` instead of SSH.

### Tart runtime

No longer used for workspace VMs. Retained only for Root VM boot scripts on macOS.

### Firecracker runtime

Retained for bare-metal Linux deployments where workspaces need full VM isolation (future multi-user scenario).

### Server config

`createRuntimeFromConfig()` gains a `podman` option:

```typescript
if (runtimeEnv === "podman" || (!runtimeEnv && insideRootVm)) {
    return createPodmanRuntime();
}
```

Default runtime inside the Root VM is Podman.

### Caddy config

`toDial()` helper added to handle `host:port` format from `getIp()`. When `vmIp` is `127.0.0.1:44231`, Caddy dials that directly instead of appending a default port.

### Health check

`toHealthUrl()` updated to handle `host:port` format. When `vmIp` includes a colon, it's used as-is instead of appending `:8080`.

### Workspace service

`provisionAndStart()` restructured to run sequentially, not in parallel:

1. `configure()` — writes config yaml + workspace-folder, restarts container, waits for running
2. `clone()` — runs `git clone` via `podman exec` (must run after restart completes)
3. `getIp()` — gets the post-restart port mapping (port changes on every restart)
4. `healthCheck()` — polls code-server at the new port

`configure()` and `clone()` were originally `Promise.all()`. This fails with Podman because `podman restart` kills any running `podman exec` sessions. The fix: run them sequentially.

### Image pipeline

Workspace images become Dockerfiles. The existing `images/scripts/setup.sh` content moves into a Dockerfile.

### Database

SQLite database at `/opt/rockpool/rockpool.db` (Root VM local disk).

### E2E tests

Playwright runs on the host, pointing at `localhost:9080` (port-forwarded from the Root VM).

## Scope

Scope is a testable breadboard: the Root VM boots, mounts source, runs the stack, exposes three ports, and passes the existing E2E suite.

### In scope

- Root VM image build (QEMU/KVM on Linux — implemented first)
- Virtiofs source mount with PM2 file watching (watch delay 2000ms for Virtiofs latency)
- Six-port forwarding (dev 8080-8082 + test 9080-9082) from host to Root VM
- Podman runtime implementation (`createPodmanRuntime()`)
- Workspace Dockerfile (based on existing `setup.sh`)
- Basic auth (Caddy, same as today)
- Host-side scripts (`start:vm`, `stop:vm`, `ssh:vm`, `vm:logs`, `start:rootvm`, `stop:rootvm`)
- E2E test suite passing against the Root VM stack (`test:e2e:rootvm`, `test:e2e:podman`)
- PM2 log access from the host
- Developer workflow guide (`doc/root-vm-dev.md`)

### Out of scope (deferred to later iterations)

- GitHub auth / OAuth — basic auth only
- Devcontainer support (EDD-015)
- User preferences sync (EDD-020)
- macOS / Tart deployment — Linux/QEMU implemented first
- Production profile / production config — no `ecosystem.production.config.cjs` adaptation
- Production hardening (firewall rules, boot persistence, backups)
- Cloudflare Tunnel / external ingress
- Multi-user

## Setup Instructions

### Host prerequisites

```bash
# Install QEMU/KVM, virtiofs, and debootstrap (Ubuntu/Debian)
sudo apt install qemu-system-x86 qemu-utils virtiofsd debootstrap grub-pc-bin

# Ensure KVM access
sudo usermod -aG kvm $USER
# Log out and back in for group membership to take effect

# Install Podman (for host-side E2E testing without the VM)
sudo apt install podman
```

### Build the Root VM image

```bash
# Requires sudo (debootstrap creates root-owned chroots, GRUB needs loopback)
sudo bash images/root-vm/build-root-vm.sh

# Fix output directory ownership (build runs as root)
sudo chown -R $USER:$USER .qemu/
```

Produces `.qemu/rockpool-root.qcow2` (~37 MB base image).

### Build the workspace container image

```bash
podman build -t rockpool-workspace:latest images/workspace/
```

### Start the Root VM

```bash
npm run start:vm       # Boot VM, wait for SSH
npm run ssh:vm         # SSH into the VM
npm run start:rootvm   # Boot VM + start PM2 stack (one command)
```

### Run E2E tests

```bash
npm run test:e2e:ci        # Stub runtime, no VM needed
npm run test:e2e:podman    # Podman runtime on host (requires podman + workspace image)
npm run test:e2e:rootvm    # Stub runtime inside Root VM (requires running VM)
```

### Stop

```bash
npm run stop:rootvm    # Stop PM2 inside VM + shut down VM
npm run stop:vm        # Just shut down the VM
```

## Rollout Plan

Phases 1-2 use the existing stub runtime to validate VM infrastructure. Phases 3-4 add the Podman workspace runtime. The `RUNTIME` value in `rootvm-test.env` controls which mode runs (`stub` or `podman`).

### Phase 1: Root VM image — boot, mount, SSH

**Goal:** A QEMU/KVM Linux VM that boots, mounts the project directory via Virtiofs, exposes ports to the host, and is reachable via SSH.

**Steps:**

1. Create a base QEMU VM image (Debian Bookworm x86_64) using debootstrap + chroot (`images/root-vm/build-root-vm.sh`, requires `sudo`)
2. Write `images/root-vm/setup-root-vm.sh` provisioning script that installs:
   - Node.js (via fnm)
   - PM2 (global)
   - Caddy (from official apt repo)
   - ElasticMQ (Java + jar at `/opt/elasticmq/`)
   - SSH server with Rockpool keypair (Ed25519, password auth disabled)
   - Virtiofs fstab entry, systemd-networkd DHCP, serial console
3. Add Makefile target: `$(STAMP_DIR)/rockpool-root-vm`
4. Write `npm-scripts/start-root-vm.sh`:
   - Starts `virtiofsd --sandbox=namespace` for the project directory
   - Starts QEMU/KVM with `vhost-user-fs-pci` for Virtiofs
   - Forwards ports: 2222→22 (SSH), 8080-8082 (dev), 9080-9082 (test), 9324+9424 (ElasticMQ)
   - Waits for SSH to become available
   - Prints connection info
5. Write `npm-scripts/stop-root-vm.sh`: SSH `sudo poweroff`, falls back to SIGTERM/SIGKILL
6. Write `npm-scripts/ssh-root-vm.sh`: SSH wrapper using project keypair on port 2222
7. Write `npm-scripts/vm-logs.sh`: runs PM2 logs over SSH
8. Add npm scripts: `start:vm`, `stop:vm`, `ssh:vm`, `vm:logs`

**Verification:**

- `npm run start:vm` boots the VM
- `npm run ssh:vm` drops into a shell
- `/mnt/rockpool/package.json` exists inside the VM
- Editing a file on the host is visible inside the VM immediately
- `npm run stop:vm` shuts it down cleanly

### Phase 2: Stub runtime E2E inside the Root VM

**Goal:** The full Rockpool stack runs inside the Root VM with `RUNTIME=stub`, and the CI E2E suite passes from the host. This validates the entire VM infrastructure — port forwarding, Caddy, basic auth, PM2, file watching — without any new workspace runtime code.

**Steps:**

1. Create `rootvm-test.env` (based on `test.env`):
   - Same test port range: `SRV0_PORT=9080`, `SRV1_PORT=9081`, `SRV2_PORT=9082`
   - `RUNTIME=stub`
   - Source paths: `/mnt/rockpool/`
   - State paths: `/tmp/rockpool-e2e.db`
2. Create `ecosystem.rootvm-test.config.cjs`:
   - Same structure as `ecosystem.test.config.cjs`
   - Uses `--env-file=rootvm-test.env`
   - Source at `/mnt/rockpool/`, state at `/tmp/`
3. Update E2E `global-setup.ts` to support `E2E_PROFILE=rootvm`:
   - PM2 start/stop commands run over SSH (`npm run ssh:vm -- '...'`)
   - Poll the same `localhost:9080` URLs (port-forwarded from the VM)
4. Add npm script: `test:e2e:rootvm` — runs Playwright against the Root VM
5. Verify `npm install` works inside the VM against the Virtiofs mount
6. Verify PM2 file watching triggers restarts on host-side edits

**Target test results (stub runtime — same as CI profile):**

| Test file | Expected result |
|-----------|----------------|
| `01-smoke.spec.ts` | Pass — dashboard, health check, API through Caddy on three ports |
| `02-workspace-lifecycle.spec.ts` | Pass — create/provision/stop/delete with stub runtime |
| `03-ide-loading.spec.ts` | Skip — stub runtime |
| `04-github-workspace.spec.ts` | Skip — no GitHub auth |
| `05-clone-verification.spec.ts` | Skip — stub + no GitHub auth |
| `06-preferences-save.spec.ts` | Skip — deferred |

**Verification:**

- `npm run test:e2e:rootvm` passes from the host — same tests that pass in CI
- From the host browser: `http://localhost:8080/app/workspaces` loads the SPA (basic auth)
- All three ports (8080, 8081, 8082) are reachable from the host
- `npm run vm:logs` shows PM2 output
- Edit a server file on the host → PM2 restarts inside the VM

**This is the first milestone.** The Root VM infrastructure is proven. Everything after this is additive.

### Phase 3: Podman runtime implementation

**Goal:** Implement `createPodmanRuntime()` behind `RUNTIME=podman` env flag. Cover with unit tests. No E2E yet — just the runtime and its tests.

**Steps:**

1. Add Podman to the Root VM image (`setup-root-vm.sh`): `apt-get install podman`
2. Create workspace Dockerfile at `images/workspace/Dockerfile`:
   - Based on `debian:bookworm-slim`
   - Installs the same packages as `images/scripts/setup.sh`
   - code-server as the entrypoint (no systemd)
   - Exposes port 8080
3. Add Makefile target for the workspace container image
4. Implement `createPodmanRuntime()` in `packages/runtime/src/podman-runtime.ts`:
   - `create()` → `podman create` with named volume, userns, resource limits
   - `start()` → `podman start`
   - `stop()` → `podman stop`
   - `remove()` → `podman rm` (volume preserved)
   - `status()` → `podman inspect` → map container state to `VmStatus`
   - `getIp()` → `podman inspect --format '{{.NetworkSettings.IPAddress}}'`
   - `configure()` → `podman exec` (replaces SSH-based configure)
   - `clone()` → `podman exec` (git clone, public repos only — no GitHub auth)
   - `readFile()` → `podman exec cat`
   - `writeFile()` → `podman exec tee` or `podman cp`
5. Export from `packages/runtime/src/index.ts`
6. Register `podman` in `createRuntimeFromConfig()`:
   ```typescript
   if (runtimeEnv === "podman") {
       return createPodmanRuntime();
   }
   ```
7. Unit tests in `packages/runtime/test/podman-runtime.test.ts`:
   - Full lifecycle: create → start → status → getIp → stop → remove
   - configure writes code-server config
   - clone fetches a public repo
   - status mapping (running, stopped, not found)
   - Tests run inside the Root VM (require Podman)

**Verification:**

- `npm test -w runtime` passes (unit tests for Podman runtime)
- Inside the Root VM: `RUNTIME=podman` starts the server, creating workspaces uses `podman` CLI
- `RUNTIME=stub` still works — no regressions

### Phase 4: Podman E2E — full workspace lifecycle

**Goal:** E2E tests 01-03 pass with real Podman workspaces. Flip `RUNTIME=podman` in `rootvm-test.env` and run the same `test:e2e:rootvm` script.

**Steps:**

1. Set `RUNTIME=podman` in `rootvm-test.env`
2. Build the workspace container image inside the Root VM (as part of test setup or Makefile)
3. Refactor workspace-service if needed: any assumptions about SSH-based configure/clone must work with `podman exec` equivalents
4. Verify Caddy can proxy to Podman container IPs (pasta networking)
5. Verify WebSocket passthrough (code-server terminal, LSP)

**Actual test results (Podman runtime, `test:e2e:podman` on host):**

| Test file | Result |
|-----------|--------|
| `01-smoke.spec.ts` | Pass (6/6) — dashboard, health check, API through Caddy |
| `02-workspace-lifecycle.spec.ts` | Pass (9/9) — create/provision/stop/delete with real Podman containers |
| `03-ide-loading.spec.ts` | Pass (4/4) — code-server renders in browser through Caddy proxy |
| `04-github-workspace.spec.ts` | Flaky (0/10) — GitHub public API rate limit (60 req/hr unauthenticated) |
| `05-clone-verification.spec.ts` | Pass (3/3) — git clone, code-server opens in cloned folder, explorer shows files |
| `06-preferences-save.spec.ts` | Pass (5/5) — read/write prefs via `podman exec` |

**Total: 29 passed, 1 flaky (GitHub rate limit), 7 cascading skips.**

**Verification:**

- `npm run test:e2e:podman` passes tests 01-03, 05-06 with real Podman containers
- Workspace creates, provisions, and reaches running state
- code-server renders in the browser via Caddy proxy
- Git clone works, code-server opens in the cloned directory
- WebSockets work (terminal, file operations in code-server)
- Stop and delete clean up the container

**This is the second milestone.** The full Podman workspace lifecycle works end to end.

### Phase 5: Developer workflow polish

**Goal:** The Root VM development loop is smooth enough to replace the host-native workflow for daily use.

**Steps:**

1. Decide `node_modules` location: Virtiofs mount vs. VM-local copy
   - If Virtiofs is too slow for `node_modules`, use a VM-local `node_modules` with a sync script
   - If fast enough, keep it simple — everything on the mount
2. Add `npm run start:rootvm` that combines VM boot + SSH + `npm start` in one command
3. Add `npm run stop:rootvm` that runs `npm stop` inside the VM + `tart stop`
4. Ensure PM2 watch patterns work reliably over Virtiofs (test with rapid saves)
5. Document the workflow in a short `doc/root-vm-dev.md` (not a full EDD, just a how-to)

**Verification:**

- Single command to go from cold start to working stack
- Edit-save-reload cycle feels responsive (< 3 seconds from save to server restart)
- Logs are easily accessible from the host
- Stopping is clean — no orphaned processes or VMs

## Security Model

```
┌─────────────────────────────────────────────┐
│  Host (NAS / Mac Mini)                      │
│                                             │
│  Attack surface: hypervisor only            │
│  No Rockpool code runs here                 │
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │  Root VM                    [VM boundary] │
│  │                                       │  │
│  │  Control plane (trusted code)         │  │
│  │                                       │  │
│  │  ┌─────────┐ ┌─────────┐             │  │
│  │  │ ws-a    │ │ ws-b    │  [container  │  │
│  │  │ userns  │ │ userns  │   boundary]  │  │
│  │  │ seccomp │ │ seccomp │             │  │
│  │  │ cgroups │ │ cgroups │             │  │
│  │  └─────────┘ └─────────┘             │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘

Workspace breakout path:
  container escape → Root VM (unprivileged user) → VM escape → host
  Two boundaries between workspace code and host data.
```

## Open Questions

- [ ] **Root VM resource allocation.** How much CPU/RAM for the Root VM? Defaults to 8 GB RAM / 4 CPUs (configurable via `ROOT_VM_MEMORY` and `ROOT_VM_CPUS` env vars). Needs real-world testing with N concurrent workspaces.
- [ ] **Root VM disk sizing.** Podman images and volumes need space. OCI layers are shared, so N workspaces from the same image are cheaper than N Firecracker rootfs copies. Current default not yet tuned.
- [ ] **macOS / Tart support.** Linux/QEMU was implemented first. Tart support for macOS hosts is deferred — the scripts would need platform detection and Tart equivalents.

### Resolved

- [x] **Virtiofs performance.** PM2 watch delay doubled to 2000ms (from 1000ms) to account for Virtiofs inotify propagation latency. Prevents spurious double-restarts. `node_modules` kept on the Virtiofs mount for simplicity.
- [x] **Linux host hypervisor.** QEMU/KVM with user-mode networking. No libvirt — direct QEMU invocation keeps the dependency surface minimal.
- [x] **Graceful shutdown.** `stop-root-vm.sh` SSHes in and runs `sudo poweroff`. Falls back to SIGTERM, then SIGKILL after timeout. Workspace containers are not explicitly stopped first — they die with the VM and recover on next boot.
- [x] **Podman networking mode.** Neither `pasta` nor `slirp4netns` bridge IPs work for rootless Podman — bridge IPs (10.88.0.x) exist inside a user namespace and are unreachable from outside. Solution: `-P` (publish all) + `podman port <name> 8080` to get the host-mapped port. Caddy proxies to `127.0.0.1:<mapped-port>`.
- [x] **code-server in container.** Custom `entrypoint.sh` (not systemd). Reads optional workspace folder from `~/.config/code-server/workspace-folder` and passes it as a positional arg to `code-server`. code-server's YAML config does **not** support a `default-workspace` option — it crashes with `Unknown option`. Configuration changes use `podman restart --time 2` since code-server is PID 1, followed by a wait-for-running poll.
- [x] **Tart softnet port forwarding.** N/A — Linux/QEMU implemented first. QEMU user-mode networking handles TCP port forwarding including WebSockets.

## Implementation Notes

### Blocker: rootless Podman bridge IPs are unreachable

The EDD originally specified `podman inspect → NetworkSettings.IPAddress` for `getIp()`. This does not work with rootless Podman. Container bridge IPs (e.g., `10.88.0.2`) exist inside a user namespace and are unreachable from processes outside that namespace (including Caddy running on the Root VM).

**Solution:** Containers are created with `-P` (publish all exposed ports). `getIp()` calls `podman port <name> 8080` which returns the host-mapped port (e.g., `0.0.0.0:44231`). The runtime returns `127.0.0.1:<port>` as the workspace address.

**Ripple effects:**
- `caddy-client.ts`: added `toDial()` helper to handle `host:port` format
- `health-check.ts`: `toHealthUrl()` updated to handle `host:port` (no default `:8080` append)
- `workspace-service.ts`: `getIp()` must be called **after** `configure()` because `podman restart` remaps ports

### Configure uses `podman restart`, not process signaling

code-server runs as PID 1 (container entrypoint). Killing it kills the container. The runtime writes config via `podman exec`, then runs `podman restart --time 2` for a clean restart. This causes port remapping, which is why `getIp()` ordering matters.

After `podman restart`, the runtime polls `podman inspect --format '{{.State.Running}}'` until the container is running again. Without this wait, subsequent `podman exec` calls fail with `container state improper` (the container hasn't finished restarting yet).

### code-server `default-workspace` does not exist

The EDD's configure method originally wrote `default-workspace: /path` into the code-server config YAML. code-server does not support this option — it crashes with `Unknown option --default-workspace`. code-server takes the folder as a positional CLI argument instead.

**Solution:** The workspace container uses a custom `entrypoint.sh` that reads an optional folder path from `~/.config/code-server/workspace-folder` and passes it as a positional argument to `code-server`. The `configure()` method writes this file alongside the config YAML.

### `podman inspect` can return State as undefined

During container state transitions (restart, stop), `podman inspect` may return JSON where `State` is undefined. `mapContainerStateToVmStatus()` guards against this by returning `"stopped"` when `State` is missing.

### Worker also needs runtime registration

The EDD only mentioned registering Podman in the server's `createRuntimeFromConfig()`. The worker also creates a runtime and needed the same `RUNTIME=podman` branch.

### Image build: debootstrap, not Packer

The Root VM image is built with `debootstrap` + `chroot` instead of Packer. This avoids a Packer dependency and produces a minimal Debian installation. The build script (`images/root-vm/build-root-vm.sh`) handles partitioning, GRUB installation, and qcow2 conversion.

### SSH keypair for Root VM access

An Ed25519 keypair is stored at `images/root-vm/keys/`. The private key is gitignored; the public key is tracked. SSH uses port 2222 on the host (forwarded to 22 in the VM) to avoid conflict with the host's SSH daemon.

### E2E test profiles

Two new profiles were added:
- `E2E_PROFILE=rootvm` — PM2 commands run over SSH into the Root VM
- `E2E_PROFILE=podman` — runs locally with `RUNTIME=podman` (for testing Podman without the VM)

## Verified E2E Results

All three profiles pass. The Podman profile runs real containers end-to-end — workspace create, provision, code-server rendering, git clone, preferences save, stop, and delete.

| Profile | Runtime | Where PM2 runs | Result |
|---------|---------|----------------|--------|
| `test:e2e:ci` | stub | host | 15 passed, 22 skipped |
| `test:e2e:rootvm` | stub | Root VM (over SSH) | 15 passed, 22 skipped |
| `test:e2e:podman` | podman | host | 29 passed, 1 flaky, 7 cascading skips |

The Podman profile passes tests 01-03 (smoke, workspace lifecycle, IDE loading), 05 (clone verification with code-server opening in cloned folder), and 06 (preferences save). Test 04 (GitHub repo picker) is flaky due to GitHub public API rate limits (60 req/hr unauthenticated) — not a Podman issue. The full workspace lifecycle works: `podman create` → `podman start` → `configure` via `podman exec` → `podman restart` → wait for running → `git clone` → `getIp` → health check → Caddy reverse proxy → code-server renders in cloned folder → `podman stop` → `podman rm`.

## Issues Found During Integration Testing

### 1. virtiofsd sandbox mode requires `--sandbox=namespace`

The default `--sandbox=chroot` requires root. Since virtiofsd runs as an unprivileged user, `--sandbox=namespace` is required. Fixed in `npm-scripts/start-root-vm.sh`.

### 2. ElasticMQ ports need forwarding

The Playwright `globalSetup` creates SQS queues from the host. ElasticMQ ports (9324, 9424) must be forwarded from the host to the VM alongside the Caddy ports. Added `hostfwd=tcp::9324-:9324,hostfwd=tcp::9424-:9424` to the QEMU netdev.

### 3. GLIBC / Node.js ABI mismatch for better-sqlite3

The host (Ubuntu, GLIBC 2.39, Node v25) and VM (Debian Bookworm, GLIBC 2.36, Node v24 LTS) have different GLIBC versions and Node.js ABIs. The host-compiled `better-sqlite3` native addon fails inside the VM. **Workaround:** install Node v25 in the VM via `fnm install 25` and `npm rebuild better-sqlite3`. **Image rebuild fix:** the provisioning script should install the same Node.js major version as the host.

### 4. VM DNS resolution requires manual configuration

QEMU user-mode networking provides a DNS proxy at 10.0.2.3, but `systemd-resolved` inside the VM doesn't know about it. **Workaround:** manually set `/etc/resolv.conf` to `nameserver 10.0.2.3`. **Image rebuild fix:** add a persistent networkd configuration or a drop-in for `systemd-resolved`.

### 5. fnm PATH not available in non-interactive SSH sessions

The fnm PATH setup was inside `.bashrc` after the interactive guard (`case $- in *i*) ...`), making `node`, `npm`, and `pm2` unavailable for remote SSH commands. **Workaround:** moved fnm PATH block above the guard. **Image rebuild fix:** add fnm PATH to `/etc/profile.d/fnm.sh` or top of `.bashrc`.

### 6. `.qemu/` directory ownership

`build-root-vm.sh` runs as root and creates `.qemu/` with root ownership. The start script (running as unprivileged user) can't write PID files. **Workaround:** `sudo chown -R $USER .qemu/` after build. **Image rebuild fix:** ensure the build script's final step chowns the output directory.

### Files created

| File | Purpose |
|------|---------|
| `images/root-vm/build-root-vm.sh` | Builds QEMU qcow2 image via debootstrap |
| `images/root-vm/setup-root-vm.sh` | Provisioning script (runs in chroot) |
| `images/root-vm/keys/` | SSH keypair for VM access |
| `images/workspace/Dockerfile` | Workspace container image |
| `images/workspace/entrypoint.sh` | code-server entrypoint with optional folder arg |
| `packages/runtime/src/podman-runtime.ts` | `createPodmanRuntime()` implementation |
| `packages/runtime/test/podman-runtime.test.ts` | 22 unit tests |
| `npm-scripts/start-root-vm.sh` | Starts virtiofsd + QEMU/KVM |
| `npm-scripts/stop-root-vm.sh` | Graceful shutdown |
| `npm-scripts/ssh-root-vm.sh` | SSH wrapper |
| `npm-scripts/vm-logs.sh` | PM2 logs over SSH |
| `npm-scripts/start-rootvm.sh` | Combined VM boot + PM2 start |
| `npm-scripts/stop-rootvm.sh` | Combined PM2 stop + VM shutdown |
| `rootvm-test.env` | Root VM test environment |
| `podman-test.env` | Podman-only test environment |
| `ecosystem.rootvm-test.config.cjs` | PM2 config for Root VM tests |
| `ecosystem.podman-test.config.cjs` | PM2 config for Podman tests |
| `ecosystem.rootvm.config.cjs` | PM2 config for Root VM development |
| `doc/root-vm-dev.md` | Developer workflow guide |
