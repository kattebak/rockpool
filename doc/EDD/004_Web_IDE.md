# EDD: Web IDE Selection (Coder vs code-server)

| Field   | Value      |
| ------- | ---------- |
| Author  | mvhenten   |
| Status  | Draft      |
| Created | 2026-02-21 |
| Updated | 2026-02-21 |

## Summary

Each Tidepool workspace needs a browser-accessible IDE. This evaluates running full Coder (with coderd server) versus running code-server standalone in each VM. The path-based routing constraint (no subdomains) is the key differentiator.

## Option A: Full Coder Deployment

### Architecture

```
coderd (control plane, PostgreSQL)
  │
  ├── Workspace VM 1 ── coder agent
  ├── Workspace VM 2 ── coder agent
  └── Workspace VM 3 ── coder agent
```

### Requirements

| Component        | CPU    | RAM    | Other                     |
| ---------------- | ------ | ------ | ------------------------- |
| coderd server    | 1 core | 2 GB   | PostgreSQL 13+            |
| Workspace agent  | 0.1    | 256 MB | Connects back to coderd   |

### What you get

- Multi-IDE support (VS Code browser, VS Code Desktop, JetBrains Gateway)
- Centralized workspace templates (Terraform-based)
- Dashboard for managing all workspaces
- User management, RBAC, audit logging
- DERP relay for NAT traversal
- Auto-stop, idle detection, resource quotas

### Blockers for Tidepool

**Coder requires wildcard subdomains for web IDE access:**

```
https://8080--main--workspace--user.coder.example.com
```

This means:
- Wildcard DNS (`*.coder.example.com`)
- Wildcard TLS certificate
- `CODER_WILDCARD_ACCESS_URL` configuration

**Path-based routing is explicitly unsupported** by Coder for web applications. Their docs warn it causes security issues and breaks many frameworks (Vite, React dev server, Next.js, JupyterLab).

This is a hard blocker given Tidepool's path-based routing requirement.

### Other concerns

- PostgreSQL dependency adds operational overhead for a single-host setup
- Terraform provisioner is heavyweight for simple VM lifecycle
- Agent requires persistent outbound connection to coderd

## Option B: code-server Standalone

### Architecture

```
Each workspace VM runs:
  └── code-server (:8080)
      ├── VS Code IDE
      ├── Terminal
      ├── /proxy/<port>/       (dev server forwarding)
      └── /absproxy/<port>/    (absolute path proxy)
```

### Requirements

| Component    | CPU     | RAM  | Other           |
| ------------ | ------- | ---- | --------------- |
| code-server  | 2 cores | 1 GB | No external deps |

### What you get

- VS Code in the browser, full extension support
- Built-in terminal
- Built-in port forwarding via `/proxy/<port>/`
- Path-based reverse proxy works natively
- `--abs-proxy-base-path /workspace/{name}` for nested deployments
- Password auth with rate limiting
- Self-contained, single process per VM

### Path-based proxy support

code-server handles the subfolder problem natively:

```bash
code-server \
  --bind-addr 0.0.0.0:8080 \
  --auth password \
  --abs-proxy-base-path /workspace/alice
```

Behind Caddy, the flow is:
1. Browser requests `/workspace/alice/`
2. Caddy strips prefix, forwards to VM:8080
3. code-server generates correct URLs using the base path

Built-in proxying for dev servers:
- `/workspace/alice/proxy/3000/` → localhost:3000 inside the VM
- This may reduce the need for separate Caddy port-forward routes

### What you lose vs Coder

| Feature                    | Impact for Tidepool             |
| -------------------------- | ------------------------------- |
| JetBrains Gateway          | Low -- VS Code is primary IDE   |
| Terraform templates        | Low -- Tidepool has its own VM lifecycle |
| Multi-user dashboard       | Medium -- build a simple one in the SPA |
| RBAC / audit logging       | Low for single-user initially   |
| Auto-stop / idle detection | Medium -- implement in control plane |
| DERP relay / NAT traversal | N/A -- all access via Caddy     |

## Recommendation

**Use code-server standalone.** The reasoning:

1. **Path-based routing works** -- code-server supports it, Coder does not
2. **No external dependencies** -- no PostgreSQL, no Terraform, no coderd server
3. **Self-contained** -- one process per VM, simple to manage
4. **Built-in port forwarding** -- `/proxy/<port>/` may reduce Caddy config needs
5. **Lower resource overhead** -- no control plane server to run

The features Coder provides (templates, multi-user, idle detection) can be built incrementally in Tidepool's own control plane, which we need anyway for VM lifecycle.

## Implementation Notes

### VM image setup

```bash
curl -fsSL https://code-server.dev/install.sh | sh
```

### Startup script

```bash
code-server \
  --bind-addr 0.0.0.0:8080 \
  --auth none \
  --abs-proxy-base-path /workspace/${WORKSPACE_NAME} \
  --disable-telemetry
```

Auth is `none` because authentication is handled at the Caddy/control plane level, not per-workspace.

### Extension management

code-server supports installing extensions via CLI:

```bash
code-server --install-extension ms-python.python
```

Pre-install common extensions in the VM base image.

## Open Questions

- [ ] Should we offer terminal-only workspaces (no IDE) for lightweight use?
- [ ] Extension marketplace -- use Open VSX or Microsoft's marketplace?
- [ ] Settings sync across workspaces?
- [x] Can code-server's built-in `/proxy/` replace Caddy port forwarding? -- No. Workspaces run SPAs and APIs on forwarded ports that need direct browser access with clean URLs. Caddy port forwarding (`/workspace/{name}/port/{N}/`) works independently of code-server and handles full SPA routing and asset serving. Keep the Caddy subroute approach from [EDD-003](003_Caddy_Reverse_Proxy.md).
- [ ] GPU passthrough for ML workspaces (future)?
