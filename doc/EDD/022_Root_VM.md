# EDD: Root VM

| Field        | Value                                                          |
| ------------ | -------------------------------------------------------------- |
| Author       | mvhenten                                                       |
| Status       | Draft                                                          |
| Created      | 2026-02-28                                                     |
| Updated      | 2026-02-28                                                     |
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
                                  Tart / QEMU
                                  (port forwarding)
                                       │
                                   Root VM
                                       │
                              Caddy (:8080, :8081, :8082)
                                       │
                              ┌────────┼────────┐
                           ws-a (ctr)  ws-b (ctr)
                           10.0.0.2    10.0.0.3
                              │           │
                           pasta network namespace
                           NAT egress only
```

Caddy inside the Root VM listens on ports forwarded from the host. Workspace containers each get their own network namespace via Podman's `pasta` networking.

## Workspace Runtime: Podman

### RuntimeRepository implementation

A new `createPodmanRuntime()` implements the existing `RuntimeRepository` interface:

```typescript
interface RuntimeRepository {
    create(name: string, image: string): Promise<void>;   // podman create
    start(name: string): Promise<void>;                    // podman start
    stop(name: string): Promise<void>;                     // podman stop
    remove(name: string): Promise<void>;                   // podman rm + podman rmi (if needed)
    status(name: string): Promise<VmStatus>;               // podman inspect
    getIp(name: string): Promise<string>;                  // podman inspect → NetworkSettings.IPAddress
    configure?(name: string, ...): Promise<void>;          // podman exec
    clone?(name: string, ...): Promise<void>;              // podman exec (git clone)
    readFile?(name: string, ...): Promise<string>;         // podman exec cat
    writeFile?(name: string, ...): Promise<void>;          // podman cp or podman exec tee
}
```

Key differences from Firecracker/Tart:

- **No SSH.** Use `podman exec` instead. The shared SSH commands abstraction (`ssh-commands.ts`) is replaced by exec-based equivalents.
- **Instant IP.** `podman inspect` returns the container IP immediately — no polling needed.
- **OCI images.** Workspace images are Dockerfiles, not ext4 rootfs or Tart OCI images. Build with `podman build`.
- **Rootless.** The entire Podman stack runs without root.

### Workspace image

The workspace Dockerfile installs the same software as the current `images/scripts/setup.sh`:

```dockerfile
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    curl wget jq git openssh-server make python3 \
    build-essential vim tmux zip rsync strace

# code-server
RUN curl -fsSL https://code-server.dev/install.sh | sh

# Node.js via fnm
RUN curl -fsSL https://fnm.vercel.app/install | bash

# code-server systemd service or direct entrypoint
EXPOSE 8080
CMD ["code-server", "--bind-addr=0.0.0.0:8080", "--auth=none"]
```

### Container lifecycle

```bash
# create + start
podman run -d \
  --name workspace-foo \
  --userns=auto \
  --security-opt=seccomp=default \
  --cpus=2 --memory=4g \
  --volume workspace-foo-data:/home/coder \
  rockpool-workspace:latest

# stop
podman stop workspace-foo

# remove
podman rm workspace-foo
# persistent data survives in the named volume

# get IP
podman inspect workspace-foo --format '{{.NetworkSettings.IPAddress}}'

# exec (replaces SSH)
podman exec workspace-foo git clone https://github.com/user/repo.git
```

### Persistent storage

Each workspace gets a Podman named volume for `/home/coder` (the working directory). The volume persists across container stop/start cycles. `podman rm` removes the container but not the volume — workspace data survives until explicitly deleted with `podman volume rm`.

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

Extend the existing Packer pipeline or create a dedicated build script.

#### Makefile target

```makefile
$(STAMP_DIR)/rockpool-root-vm: images/root-vm/setup-root-vm.sh images/scripts/setup.sh
	$(BUILD_ROOT_VM_CMD)
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

No changes. Caddy proxies to workspace IPs regardless of the underlying runtime.

### Image pipeline

Workspace images become Dockerfiles. The existing `images/scripts/setup.sh` content moves into a Dockerfile.

### Database

SQLite database at `/opt/rockpool/rockpool.db` (Root VM local disk).

### E2E tests

Playwright runs on the host, pointing at `localhost:9080` (port-forwarded from the Root VM).

## Scope

Scope is a testable breadboard: the Root VM boots, mounts source, runs the stack, exposes three ports, and passes the existing E2E suite.

### In scope

- Root VM image build (Tart on macOS initially)
- Virtiofs source mount with PM2 file watching
- Three-port forwarding (srv0, srv1, srv2) from host to Root VM
- Podman runtime implementation (`createPodmanRuntime()`)
- Workspace Dockerfile (based on existing `setup.sh`)
- Basic auth (Caddy, same as today)
- Host-side scripts (`start:vm`, `stop:vm`, `ssh:vm`)
- E2E test suite passing against the Root VM stack
- PM2 log access from the host

### Out of scope (deferred to later iterations)

- GitHub auth / OAuth — basic auth only
- Devcontainer support (EDD-015)
- User preferences sync (EDD-020)
- Linux host / QEMU deployment — macOS/Tart first
- Production profile / production config — no `ecosystem.production.config.cjs` adaptation
- Production hardening (firewall rules, boot persistence, backups)
- Cloudflare Tunnel / external ingress
- Multi-user

## Rollout Plan

Phases 1-2 use the existing stub runtime to validate VM infrastructure. Phases 3-4 add the Podman workspace runtime. The `RUNTIME` value in `rootvm-test.env` controls which mode runs (`stub` or `podman`).

### Phase 1: Root VM image — boot, mount, SSH

**Goal:** A Tart Linux VM that boots, mounts the project directory via Virtiofs, exposes three ports to the host, and is reachable via SSH.

**Steps:**

1. Create a base Tart Linux VM (Debian Bookworm aarch64) using `tart create`
2. Write `images/root-vm/setup-root-vm.sh` provisioning script that installs:
   - Node.js (via fnm)
   - PM2 (global)
   - Caddy
   - ElasticMQ (Java + jar)
   - SSH server with Rockpool keypair
   - (Podman is NOT installed yet — stub runtime only in this phase)
3. Add fstab entry for Virtiofs auto-mount at `/mnt/rockpool`
4. Add Makefile target: `$(STAMP_DIR)/rockpool-root-vm`
5. Write `npm-scripts/start-root-vm.sh`:
   - `tart run --dir=rockpool:<project-dir> --net-softnet --net-softnet-expose=8080:8080,8081:8081,8082:8082,9080:9080,9081:9081,9082:9082 rockpool-root`
   - Forward both dev ports (8080-8082) and test ports (9080-9082)
   - Wait for SSH to become available
   - Print the VM IP and connection info
6. Write `npm-scripts/stop-root-vm.sh`: graceful `tart stop`
7. Write `npm-scripts/ssh-root-vm.sh`: SSH wrapper using Rockpool keypair
8. Write `npm-scripts/vm-logs.sh`: runs PM2 logs over SSH for quick access from the host
9. Add npm scripts: `start:vm`, `stop:vm`, `ssh:vm`, `vm:logs`

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

**Target test results (Podman runtime):**

| Test file | Expected result |
|-----------|----------------|
| `01-smoke.spec.ts` | Pass |
| `02-workspace-lifecycle.spec.ts` | Pass — real Podman containers |
| `03-ide-loading.spec.ts` | Pass — code-server in container, accessed through Caddy |
| `04-github-workspace.spec.ts` | Skip — no GitHub auth |
| `05-clone-verification.spec.ts` | Skip — no GitHub auth |
| `06-preferences-save.spec.ts` | Skip — deferred |

**Verification:**

- `npm run test:e2e:rootvm` (with `RUNTIME=podman`) passes tests 01-03
- Workspace creates, provisions, and reaches running state
- code-server renders in the browser via Caddy proxy
- WebSockets work (terminal, file operations in code-server)
- Stop and delete clean up the container

**This is the second milestone.** The full Podman workspace lifecycle works end to end inside the Root VM.

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

- [ ] **Root VM resource allocation.** How much CPU/RAM for the Root VM? It needs enough for the control plane + N Podman containers (each limited to 2 CPU / 4 GB).
- [ ] **Virtiofs performance.** Is file watching over Virtiofs fast enough for a good dev loop, or will there be noticeable latency on save → PM2 restart?
- [ ] **Root VM disk sizing.** Podman images and volumes need space. OCI layers are shared, so N workspaces from the same image are cheaper than N Firecracker rootfs copies. How large should the Root VM disk be?
- [ ] **Tart softnet port forwarding.** Does `--net-softnet-expose` reliably forward WebSocket traffic for code-server? Needs verification.
- [ ] **Linux host hypervisor.** QEMU is the obvious choice, but should we consider libvirt/virt-manager for easier management on Linux NAS?
- [ ] **Graceful shutdown.** When the Root VM shuts down, should it stop all workspace containers first, or let them die and recover on next boot?
- [ ] **Podman networking mode.** Default `pasta` (userspace, no root) vs. `slirp4netns` (legacy) vs. bridge with `podman network create` (needs root). `pasta` is the modern default and performs well — verify it works for WebSocket proxying.
- [ ] **code-server in container.** Current images run code-server as a systemd service. In a container, systemd is usually not running. Run code-server directly as the container entrypoint, or use systemd in the container (`--systemd=always`)?
