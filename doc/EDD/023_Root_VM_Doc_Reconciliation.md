# EDD: Root VM Documentation Reconciliation

| Field        | Value                                          |
| ------------ | ---------------------------------------------- |
| Author       | mvhenten                                       |
| Status       | Draft                                          |
| Created      | 2026-02-28                                     |
| Updated      | 2026-02-28                                     |
| Related EDDs | [EDD-022](022_Root_VM.md)                      |

## Summary

After EDD-022 (Root VM with Podman workspaces) lands, several existing EDDs, ADRs, and RFCs will be partially or fully outdated. This EDD catalogs which documents need updating and what to investigate in each. The goal is a single pass of doc reconciliation after the Root VM refactor is stable.

This is not a rewrite — it's a checklist. Each item describes what likely changed and what to verify before editing.

## When to execute

After EDD-022 Phase 2 (stub E2E passing inside Root VM) at the earliest. Ideally after Phase 4 (Podman E2E passing), when the full picture is clear.

## Documents to update

### EDD-001: Architecture Overview

**Impact: High — core topology changed.**

Investigate and update:

- System topology diagram: "Root VM" is no longer hypothetical, it's real. Diagram should show the actual layers (host → Tart/QEMU → Root VM → Podman containers)
- Control plane section: currently describes server + worker running on "the root VM" but in practice they ran on the host. Now they actually run in a VM — verify the description matches reality
- Workspace VMs section: workspaces are now Podman containers, not microVMs. Update terminology and isolation description
- Network architecture: the isolated bridge (`rockpool0`, Firecracker TAP devices) is replaced by Podman's `pasta` networking inside the Root VM. Verify what the actual network topology looks like
- Deployment targets table: add Podman as the workspace runtime, note Tart is Root VM only on macOS, update Firecracker status (retained for bare-metal Linux, not used inside Root VM)
- Request flow diagrams: verify they still match — workspace creation now goes through `podman create` instead of VM boot
- Port forwarding section: verify the flow (Caddy → container IP vs. Caddy → VM IP)

### EDD-002: MicroVM Runtime

**Impact: High — a new runtime was added, evaluation conclusions changed.**

Investigate and update:

- Runtime evaluation table: add Podman as an option, update the verdict
- The "Tart for macOS, Firecracker for Linux" split is no longer the primary model — Podman is the default inside the Root VM on both platforms
- Tart section: clarify Tart is now used for Root VM boot only, not workspace VMs
- Firecracker section: clarify it's retained for bare-metal Linux multi-user scenarios
- `RuntimeRepository` interface: verify the interface description still matches — Podman uses `podman exec` instead of SSH
- Check if the macOS/Linux compatibility table needs updating

### EDD-005: Workspace Image Pipeline

**Impact: High — Packer/ext4 replaced by Dockerfile.**

Investigate and update:

- Image build process: Packer (Tart) and `build-firecracker-rootfs.sh` (Firecracker) are replaced by `podman build` with a Dockerfile for the default runtime
- `images/scripts/setup.sh`: verify whether it's still the source of truth or if its contents have moved into the Dockerfile
- Image distribution: OCI container images via Podman registry vs. Tart OCI images vs. ext4 files
- Verify which Makefile targets changed and which are obsolete

### EDD-010: PM2 Process Management

**Impact: Medium — PM2 now runs inside the Root VM.**

Investigate and update:

- Ecosystem configs: verify which configs exist and which are used inside the Root VM
- File watching: verify the description of watch patterns — paths changed to `/mnt/rockpool/` for Virtiofs mount
- Boot persistence section: PM2 startup inside the Root VM vs. on the host
- The section on RFC-002 (Rockpool-on-Rockpool): partially superseded by EDD-022

### EDD-019: Linux Firecracker Support

**Impact: Medium — Firecracker is no longer the default workspace runtime inside the Root VM.**

Investigate and update:

- Clarify that Firecracker is retained for bare-metal Linux deployments (future multi-user)
- The nested virtualization addendum (Addendum A): verify whether this is still relevant or superseded by the Podman approach
- Network setup scripts (`firecracker-bridge-setup.sh`, `firecracker-net.sh`): verify if these are still used or only for bare-metal
- Slot allocator: verify if it's still active or only for bare-metal Firecracker

### EDD-021: Production Profile

**Impact: Low — out of scope for EDD-022, but verify assumptions.**

Investigate:

- Does the production profile still make sense with the Root VM model?
- Port ranges, DB paths, Caddy config — any that assume host-native execution?
- Flag anything that will break when production moves inside the Root VM (deferred work, but document the gap)

### ADR-015: Three-Port Origin Isolation

**Impact: Low — the three-port model is unchanged, but verify the transport.**

Investigate:

- Ports are now forwarded from host to Root VM via Tart `--net-softnet-expose` or QEMU `hostfwd`. Verify the ADR's security properties still hold through port forwarding
- Cookie scope: verify that `SameSite`/`Secure` flags still work correctly when the browser sees `localhost:8080` but the traffic traverses a port forward

### ADR-006: ElasticMQ Message Queue

**Impact: Low — ElasticMQ now runs inside the Root VM.**

Investigate:

- Verify the ADR's rationale still holds (local SQS-compatible queue)
- Check if any connection URLs or ports changed

### ADR-017: code-server Web IDE

**Impact: Medium — code-server now runs inside a Podman container instead of a VM.**

Investigate:

- Startup method: systemd service vs. container entrypoint — verify which is used and update
- Configuration: SSH-based vs. `podman exec`-based — verify the ADR's description of how code-server is configured
- WebSocket behavior: verify the ADR's notes on WebSocket proxying still apply through Podman networking

### RFC-002: Tidepool on Tidepool

**Impact: Medium — partially superseded by EDD-022.**

Investigate:

- RFC-002 proposes Incus for nested virtualization. EDD-022 uses Podman instead. Clarify the relationship
- The "nested host image" concept in RFC-002 overlaps with the Root VM image in EDD-022
- Determine whether RFC-002 should be marked as superseded, revised, or kept as a future extension (e.g., multi-level nesting for demos)

## Documents NOT affected

These were reviewed and don't need changes:

| Document | Why unaffected |
|----------|---------------|
| ADR-001: express-openapi-validator | API layer unchanged |
| ADR-002: biome | Tooling unchanged |
| ADR-003: typespec | API spec unchanged |
| ADR-004: pino logging | Logging unchanged |
| ADR-005: node22 ESM | Runtime unchanged |
| ADR-007: npm workspaces | Monorepo structure unchanged |
| ADR-008: native-first | Dependency philosophy unchanged |
| ADR-009: sqlite drizzle | DB layer unchanged |
| ADR-010: react shadcn | Frontend unchanged |
| ADR-011: esbuild | Bundling unchanged |
| ADR-012: github actions CI | CI unchanged (stub runtime) |
| ADR-013: cloudflare tunnel | Ingress unchanged (deferred) |
| ADR-014: build tooling | Makefile conventions unchanged |
| ADR-016: shift-left codegen | Codegen unchanged |
| EDD-003: Caddy Reverse Proxy | Caddy config is runtime-agnostic — proxies to IPs regardless of source |
| EDD-007: Data Model | Workspace entity unchanged |
| EDD-009: UX Mockups | UI unchanged |
| EDD-012: Vite Migration | Build tooling unchanged |
| EDD-013: E2E Playwright | Test framework unchanged (new profile added, not changed) |
| EDD-014: ElasticMQ Worker | Worker architecture unchanged |
| EDD-015: Devcontainer | Out of scope, deferred |
| EDD-016: GitHub Repo Listing | Out of scope, deferred |
| EDD-017: Workspace Creation Wizard | UI unchanged |
| EDD-018: Repository Cloning | Cloning mechanism may change (SSH → podman exec) — verify but likely minor |
| EDD-020: User Preferences | Out of scope, deferred |

## Process

For each document listed above:

1. Read the current document
2. Compare against the actual implementation (code, configs, scripts)
3. Note what's wrong, outdated, or missing
4. Update the document — keep it concise, don't rewrite from scratch
5. If a document is fully superseded, mark it as such and link to the replacement

Do this in a single pass after EDD-022 is stable. Don't update docs piecemeal during implementation — wait until the dust settles.
