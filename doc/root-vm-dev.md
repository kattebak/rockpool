# Root VM Development Workflow

This guide covers daily development using the Root VM. For architecture details, see [EDD-022](EDD/022_Root_VM.md).

The Root VM runs the entire Rockpool stack (Caddy, server, worker, ElasticMQ, client dev server) inside a QEMU/KVM virtual machine. The host machine runs only the hypervisor and your editor. Workspaces run as Podman rootless containers inside the VM.

## Prerequisites

- QEMU/KVM installed (`sudo apt install qemu-system-x86`)
- virtiofsd installed (`sudo apt install virtiofsd`)
- KVM access (`sudo usermod -aG kvm $USER`, then log out and back in)
- Root VM image built (`make .stamps/rockpool-root-vm`)
- `npm install` completed on the host

## Quick Start

Start the VM and the full stack in one command:

```bash
npm run start:rootvm
```

This boots the VM (if not already running), waits for SSH, then starts all services inside the VM via PM2. Once complete, open your browser to:

```
http://localhost:8080/app/workspaces
```

To stop everything:

```bash
npm run stop:rootvm
```

## Development Loop

1. `npm run start:rootvm` -- cold start to working stack
2. Edit files on the host in your editor
3. PM2 watches `packages/server/src` and auto-restarts on changes
4. Browser at `localhost:8080` shows the dashboard (ports forwarded from the VM)
5. `npm run stop:rootvm` when done

The edit-save-reload cycle should feel responsive. PM2 detects file changes over the Virtiofs mount and restarts the server automatically.

## Commands

| Command | Description |
|---------|-------------|
| `npm run start:rootvm` | Boot VM + start stack (one command) |
| `npm run stop:rootvm` | Stop stack + shut down VM |
| `npm run start:vm` | Boot the VM only (no stack) |
| `npm run stop:vm` | Shut down the VM only |
| `npm run ssh:vm` | SSH into the VM |
| `npm run ssh:vm -- 'command'` | Run a command inside the VM |
| `npm run vm:logs` | View PM2 logs from the VM |
| `npm run vm:logs -- --nostream` | Dump recent logs and exit |
| `npm run test:e2e:rootvm` | Run E2E tests against the Root VM |

## node_modules

The `node_modules` directory lives on the Virtiofs mount (shared with the host). This is the simplest approach: `npm install` on the host and the VM sees the same modules immediately.

If Virtiofs performance for `node_modules` becomes a bottleneck (slow `require()` resolution), this can be optimized later by syncing `node_modules` to the VM's local disk. For now, the shared mount works well enough.

## PM2 Watch Patterns

The Root VM ecosystem config (`ecosystem.rootvm.config.cjs`) watches `packages/server/src` with a 2-second delay. This is slightly longer than the host-native 1-second delay to account for Virtiofs filesystem event propagation.

To manually restart a service without waiting for file watch:

```bash
npm run ssh:vm -- 'cd /mnt/rockpool && npx pm2 restart rootvm-server'
```

To restart all services:

```bash
npm run ssh:vm -- 'cd /mnt/rockpool && npx pm2 restart all'
```

## Port Forwarding

| Host Port | VM Port | Service |
|-----------|---------|---------|
| 8080 | 8080 | Caddy (dev srv0) |
| 8081 | 8081 | Dev srv1 |
| 8082 | 8082 | Dev srv2 |
| 9080 | 9080 | Test srv0 |
| 9081 | 9081 | Test srv1 |
| 9082 | 9082 | Test srv2 |
| 2222 | 22 | SSH |

## Environment Variables

The VM start script supports these environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `ROOT_VM_MEMORY` | 8G | VM memory allocation |
| `ROOT_VM_CPUS` | 4 | VM CPU count |
| `ROOT_VM_SSH_PORT` | 2222 | Host port for SSH forwarding |
| `SSH_WAIT_TIMEOUT` | 120 | Seconds to wait for SSH during boot |

## Troubleshooting

### VM won't start

Check that QEMU and KVM are available:

```bash
qemu-system-x86_64 --version
ls -la /dev/kvm
```

Check the serial log for boot errors:

```bash
tail -f .qemu/serial.log
```

### SSH connection refused

The VM may still be booting. Wait and retry:

```bash
npm run ssh:vm
```

If the VM booted but SSH is not working, check the serial log for errors.

### PM2 not restarting on file changes

Virtiofs inotify events may be delayed. Try increasing the watch delay in `ecosystem.rootvm.config.cjs`, or restart manually:

```bash
npm run ssh:vm -- 'cd /mnt/rockpool && npx pm2 restart rootvm-server'
```

### Services crash-looping

Check PM2 logs for errors:

```bash
npm run vm:logs -- --lines 100 --nostream
```

### Port already in use

If ports 8080-8082 are already bound on the host (by a non-VM Rockpool instance), stop those first:

```bash
npm run stop        # stop host-native PM2 processes
npm run start:rootvm  # then start the VM stack
```
