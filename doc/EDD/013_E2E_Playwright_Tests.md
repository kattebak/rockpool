# EDD: End-to-End Playwright Tests

| Field        | Value                                                                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Author       | mvhenten                                                                                                                                            |
| Status       | Implemented                                                                                                                                         |
| Created      | 2026-02-23                                                                                                                                          |
| Updated      | 2026-02-24                                                                                                                                          |
| Related ADRs | [ADR-012](../ADR/012-github-actions-ci.md), [ADR-015](../ADR/015-three-port-origin-isolation.md)                                                    |
| Related EDDs | [EDD-001](001_Architecture_Overview.md), [EDD-003](003_Caddy_Reverse_Proxy.md), [EDD-004](004_Web_IDE.md), [EDD-010](010_PM2_Process_Management.md) |

## Summary

Add a Playwright-based end-to-end test suite that runs the real platform stack — Caddy, server, worker, queue, database — with only the VM runtime stubbed out. The test stack runs on a separate port range (9xxx) with an ephemeral database, so it can run alongside local development without interference.

Two profiles, controlled by env files:

1. **Test profile** (`test.env`, committed) — runs on GitHub Actions and locally. Real Caddy with basic auth, real server, real worker, real SQS queue (ElasticMQ), ephemeral SQLite DB, stub runtime. Playwright launches its own Chromium. Catches SPA regressions, API contract breaks, UI interaction bugs, Caddy routing/auth issues, and workspace state machine bugs on every push.

2. **Development profile** (`development.env`, gitignored) — runs against `npm start` with real Tart VMs. Connects to a debug Chrome via CDP. Extends test-profile coverage with IDE loading verification (code-server through the Caddy proxy chain). Catches VM provisioning failures and proxy chain issues.

The same test stack also enables running API integration tests against real services in CI — not just E2E browser tests.

The implementation is phased — Phase 1 validates test infrastructure, Phase 2 adds the workspace lifecycle (both run in CI), Phase 3 adds IDE verification (local only).

## Problem

Recent regressions have gone undetected because all existing tests are unit/integration level — they mock the runtime, Caddy, and queue. Nothing validates the actual user-facing flow. A workspace that "works" in unit tests can fail because:

- Client SPA rendering failures (build regressions, broken imports, routing bugs)
- API contract mismatches between generated SDK and server routes
- UI interaction bugs (dialog flows, state transitions, polling)
- Caddy route misconfiguration (prefix stripping, auth handler ordering)
- Basic auth misconfiguration (wrong routes gated, health check blocked)
- VM provisioning race conditions (health check timing, IP assignment)
- code-server not starting or not responding behind the proxy

Running stubs for everything except VMs means phases 1-2 catch the first five categories on every push. Phase 3 (local) catches the last two before deployment.

## Prerequisites

### Test profile (CI)

- Node.js >= 22
- `npm install` (builds TypeSpec artifacts via `make`)
- Caddy binary on `PATH`
- Java runtime (for ElasticMQ) — pre-installed on GitHub Actions runners

### Development profile (local)

- Everything above, plus:
- [EDD-010](010_PM2_Process_Management.md) — PM2 manages Caddy + server + client
- `rockpool-workspace` Tart image built (`make .stamps/rockpool-workspace`)
- `npm run chrome:debug` for the debug browser

## Design Decisions

### Real stack, stub runtime

The previous draft stubbed out everything (Caddy, queue, DB behavior) in the test profile via `NODE_ENV=test`. This was an oversimplification — it meant CI never validated Caddy routing, basic auth, or the real request path users hit.

The revised design runs the real stack in both profiles. The only difference is the VM runtime:

| Component    | Test profile                                                | Development profile           |
| ------------ | ----------------------------------------------------------- | ----------------------------- |
| Caddy        | Real — three-port bootstrap, basic auth, route management   | Same                          |
| Server       | Real — API handlers, workspace service, bootstrap, recovery | Same                          |
| Worker       | Real — queue polling, job processing                        | Same                          |
| Queue        | Real — ElasticMQ (SQS-compatible)                           | Same                          |
| Database     | Real SQLite — ephemeral file, migrations on connect         | Same (persistent file)        |
| Runtime      | `StubRuntime` — in-memory VMs, instant boot, fake IPs       | `TartRuntime` — real Tart VMs |
| Health check | No-op (stub VMs don't need it)                              | curl to VM:8080               |

The server already selects the runtime via `RUNTIME` env var (`const useStubVm = process.env.RUNTIME !== "tart"`). The test profile simply doesn't set `RUNTIME=tart`. Critically, `NODE_ENV` is **not** set to `test` — the server runs its normal startup path including Caddy bootstrap and workspace recovery.

### Separate port range for test isolation

The test stack runs on a 9xxx port range so it doesn't interfere with local development:

| Service                 | Dev ports | Test ports | Config var        |
| ----------------------- | --------- | ---------- | ----------------- |
| Caddy srv0 (dashboard)  | :8080     | :9080      | `SRV0_PORT` (new) |
| Caddy srv1 (IDE routes) | :8081     | :9081      | `SRV1_PORT`       |
| Caddy admin API         | :2019     | :9019      | `CADDY_ADMIN_URL` |
| API server              | :7163     | :9163      | `PORT`            |
| Vite client             | :5173     | :9173      | `--port` flag     |
| ElasticMQ               | :9324     | :9424      | `QUEUE_ENDPOINT`  |

This means `npm run test:e2e` works while `npm start` is running — separate databases, separate queues, separate Caddy instances.

### Ephemeral database

The test profile uses a temporary SQLite file (`/tmp/rockpool-e2e.db`). The database schema is created automatically on first connection via `createDb()`. The file is deleted in test teardown (or by the OS on reboot). No migration scripts needed — the DB package handles schema creation.

### Basic auth in both profiles

Both profiles go through Caddy with basic auth. There's no auth/no-auth branching in the test helpers — `createTestContext()` always sets the `Authorization` header. The `test.env` has its own credentials (`test`/`test`).

This validates that:

- The auth gate is correctly configured on `/api/*` and `/app/*` routes
- The health check endpoint (`/api/health`) bypasses auth (as configured in Caddy)
- The workspace redirect from srv0 to srv1 works with auth

### Two profiles via env files

The project already uses `development.env` (gitignored, contains secrets) for local development. We add a `test.env` (committed, no secrets) for the CI/test profile. Both use the `--env-file` mechanism the server already supports.

```
test.env              ← committed, used by CI and `npm run test:e2e`
development.env       ← gitignored, used by `npm start` for local dev
```

### Test profile: Playwright launches its own Chromium

In the test profile there's no debug Chrome to connect to. Playwright launches a managed Chromium process using its standard browser management.

### Development profile: connect to existing browser via CDP

In the development profile, Playwright connects to the debug Chrome (`npm run chrome:debug`, port 9222) via `connectOverCDP()`. This matches the developer's workflow — same browser, same DevTools, no extra install.

### PM2 ecosystem for test stack

The test stack is managed by PM2 via a dedicated `ecosystem.test.config.cjs`, mirroring how `ecosystem.caddy.config.cjs` manages the development stack. Process names are prefixed with `test-` to avoid collisions with running dev processes.

Playwright's `globalSetup` starts PM2 with the test ecosystem and polls the Caddy health URL until the stack is ready. `globalTeardown` deletes the PM2 processes and cleans up the ephemeral database.

In the development profile, the platform is started independently via `npm start`. The test suite expects it to be running and fails fast if not.

### Serial execution, single worker

The test suite is inherently sequential: create a workspace, wait for it, open it, close it, delete it. Each step depends on the previous one.

- `workers: 1` — single worker process
- `fullyParallel: false` — no parallelism within files
- `test.describe.configure({ mode: 'serial' })` — if one step fails, skip the rest

### Test isolation via unique workspace names

Each test run creates a workspace with a unique name (`e2e-{timestamp}`) and cleans it up afterward. This avoids collisions with existing workspaces.

Cleanup runs in `afterAll` via direct API calls (bypasses UI for reliability). A try/catch ensures cleanup even on test failure.

### Generous timeouts for VM operations

| Scope               | CI timeout | Local timeout | Rationale                           |
| ------------------- | ---------- | ------------- | ----------------------------------- |
| Test (per test)     | 30s        | 5 minutes     | Stubs are instant; VMs take 60s+    |
| Navigation          | 10s        | 30s           | SPA loads fast; Caddy adds latency  |
| Action              | 5s         | 15s           | UI interactions should be fast      |
| Expect (assertion)  | 10s        | 30s           | Stub state changes are near-instant |
| Workspace provision | 15s        | 3 minutes     | Stubs: ~1s; Tart VM: 30-60s         |

## Code Changes Required

### 1. Make Caddy srv0 port configurable

Currently `buildBootstrapConfig` in `packages/caddy/src/auth.ts` hardcodes `:8080` for srv0. Add `srv0Port` to `BootstrapOptions` so the test profile can use `:9080`.

**`packages/caddy/src/types.ts`** — add to `BootstrapOptions`:

```typescript
srv0Port?: number;
```

**`packages/caddy/src/auth.ts`** — use `options.srv0Port ?? 8080`:

```typescript
srv0: {
  listen: [`:${options.srv0Port ?? 8080}`],
  routes: srv0Routes,
},
```

**`packages/server/src/config.ts`** — add:

```typescript
srv0Port: Number.parseInt(process.env.SRV0_PORT ?? "8080", 10),
```

**`packages/server/src/index.ts`** — pass to bootstrap:

```typescript
bootstrapOptions.srv0Port = config.srv0Port;
```

### 2. Worker respects RUNTIME env var

Currently `packages/worker/src/main.ts` hardcodes `createTartRuntime`. It needs the same `RUNTIME` check as the server:

```typescript
const useStubVm = process.env.RUNTIME !== "tart";
const runtime = useStubVm
  ? createStubRuntime()
  : createTartRuntime({ sshKeyPath });
```

### 3. `setup-elasticmq.sh` accepts config argument

The script accepts an optional argument to select the config file. `setup-elasticmq.sh` uses `elasticmq.conf` (port 9324), `setup-elasticmq.sh test` uses `elasticmq.test.conf` (port 9424). A `download` argument downloads the jar without starting it (for CI pre-caching).

### 4. ElasticMQ test config

**`elasticmq.test.conf`** — same as `elasticmq.conf` but on port 9424:

```
include classpath("application.conf")

node-address {
  protocol = http
  host = localhost
  port = 9424
  context-path = ""
}

rest-sqs {
  enabled = true
  bind-port = 9424
  bind-hostname = "0.0.0.0"
  sqs-limits = strict
}

queues {
  workspace-jobs {
    defaultVisibilityTimeout = 120 seconds
    delay = 0 seconds
    receiveMessageWait = 0 seconds
  }
}
```

## Test Suite Structure

```
e2e/
  playwright.config.ts              # Dual-profile config
  helpers/
    platform.ts                     # Browser connection, auth, health checks
    workspace.ts                    # API helpers for create/delete/poll
  tests/
    01-smoke.spec.ts                # Phase 1: dashboard loads (CI + local)
    02-workspace-lifecycle.spec.ts  # Phase 2: full CRUD lifecycle (CI + local)
    03-ide-loading.spec.ts          # Phase 3: IDE renders (local only)
```

## PM2 Test Ecosystem

**`ecosystem.test.config.cjs`** — starts the full stack on 9xxx ports with `test-` prefixed process names:

```javascript
module.exports = {
  apps: [
    {
      name: "test-elasticmq",
      script: "npm-scripts/setup-elasticmq.sh",
      args: "test",
      interpreter: "bash",
      autorestart: true,
      max_restarts: 3,
      restart_delay: 2000,
    },
    {
      name: "test-caddy",
      script: "caddy",
      args: "run",
      interpreter: "none",
      env: {
        CADDY_ADMIN: "localhost:9019",
      },
      autorestart: true,
      max_restarts: 3,
      restart_delay: 2000,
    },
    {
      name: "test-server",
      script: "packages/server/src/index.ts",
      interpreter: "node",
      interpreter_args: "--experimental-strip-types --env-file=test.env",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 1000,
    },
    {
      name: "test-worker",
      script: "packages/worker/src/main.ts",
      interpreter: "node",
      interpreter_args: "--experimental-strip-types --env-file=test.env",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
    },
    {
      name: "test-client",
      script: "npm",
      args: "run dev -w packages/client -- --port 9173",
      autorestart: true,
      max_restarts: 5,
      restart_delay: 1000,
    },
  ],
};
```

Key points:

- Process names prefixed with `test-` — no collision with dev processes from `ecosystem.config.cjs` or `ecosystem.caddy.config.cjs`.
- Server and worker load `test.env` via `--env-file`, which configures all ports, DB path, and credentials. `NODE_ENV` is **not** set to `test`.
- The server bootstraps Caddy on startup (real bootstrap), which configures the :9080/:9081 listeners.
- Caddy starts with `CADDY_ADMIN=localhost:9019` so its admin API doesn't conflict with dev Caddy on :2019.
- ElasticMQ uses `elasticmq.test.conf` (port 9424) via the `test` argument.

## Playwright Config

```typescript
import { defineConfig } from "@playwright/test";

const profile = process.env.E2E_PROFILE ?? "development";
const isTest = profile === "test";

const BASE_URL =
  process.env.DASHBOARD_URL ??
  (isTest ? "http://localhost:9080" : "http://localhost:8080");

export default defineConfig({
  testDir: "tests",
  workers: 1,
  fullyParallel: false,
  retries: isTest ? 1 : 0,
  timeout: isTest ? 30_000 : 5 * 60 * 1000,
  expect: {
    timeout: isTest ? 10_000 : 30_000,
  },
  use: {
    baseURL: BASE_URL,
    actionTimeout: isTest ? 5_000 : 15_000,
    navigationTimeout: isTest ? 10_000 : 30_000,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  // Test profile: Playwright launches its own Chromium
  ...(isTest && {
    projects: [
      {
        name: "chromium",
        use: { browserName: "chromium" },
      },
    ],
  }),

  // Test profile: PM2 manages the stack via globalSetup/globalTeardown
  ...(isTest && {
    globalSetup: "./global-setup.ts",
    globalTeardown: "./global-teardown.ts",
  }),
});
```

### `global-setup.ts`

```typescript
import { execSync } from "node:child_process";

const HEALTH_URL = "http://localhost:9080/api/health";
const STARTUP_TIMEOUT = 60_000;
const POLL_INTERVAL = 1_000;

export default async function globalSetup(): Promise<void> {
  execSync("npx pm2 delete ecosystem.test.config.cjs", {
    stdio: "ignore",
  }).toString;
  execSync("npx pm2 start ecosystem.test.config.cjs", { stdio: "inherit" });

  const deadline = Date.now() + STARTUP_TIMEOUT;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(HEALTH_URL);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
  throw new Error(
    `Test stack did not become healthy within ${STARTUP_TIMEOUT}ms`,
  );
}
```

### `global-teardown.ts`

```typescript
import { execSync } from "node:child_process";
import { unlinkSync } from "node:fs";

export default async function globalTeardown(): Promise<void> {
  execSync("npx pm2 delete ecosystem.test.config.cjs", { stdio: "ignore" });
  try {
    unlinkSync("/tmp/rockpool-e2e.db");
  } catch {}
}
```

Key points:

- `globalSetup` deletes stale processes first (safe if none exist), then starts the test ecosystem and polls the Caddy health URL.
- The health URL (`/api/health` on :9080) is served by Caddy's static response — it only becomes available after the server bootstraps Caddy, so it's a reliable readiness signal.
- `globalTeardown` cleans up PM2 processes and the ephemeral DB file.
- In development profile, neither `globalSetup` nor `globalTeardown` runs — the platform is expected to be running via `npm start`.

## Helpers

### `helpers/platform.ts`

```typescript
import { chromium, type Browser, type BrowserContext } from "@playwright/test";

const profile = process.env.E2E_PROFILE ?? "development";
const isTest = profile === "test";

const CDP_URL = process.env.CDP_URL ?? "http://localhost:9222";
const API_BASE =
  process.env.API_URL ??
  (isTest ? "http://localhost:9080/api" : "http://localhost:8080/api");
const CADDY_USERNAME =
  process.env.CADDY_USERNAME ?? (isTest ? "test" : "admin");
const CADDY_PASSWORD =
  process.env.CADDY_PASSWORD ?? (isTest ? "test" : "admin");

export function getProfile(): string {
  return profile;
}

export function isTestProfile(): boolean {
  return isTest;
}

export function getApiUrl(): string {
  return API_BASE;
}

export async function connectBrowser(): Promise<Browser> {
  if (isTest) {
    return chromium.launch();
  }
  return chromium.connectOverCDP(CDP_URL, { timeout: 10_000 });
}

export async function createTestContext(
  browser: Browser,
): Promise<BrowserContext> {
  const context = await browser.newContext();
  const credentials = Buffer.from(
    `${CADDY_USERNAME}:${CADDY_PASSWORD}`,
  ).toString("base64");
  await context.setExtraHTTPHeaders({
    Authorization: `Basic ${credentials}`,
  });
  return context;
}

export function getAuthHeader(): string {
  const credentials = Buffer.from(
    `${CADDY_USERNAME}:${CADDY_PASSWORD}`,
  ).toString("base64");
  return `Basic ${credentials}`;
}
```

Note: `createTestContext` and `getAuthHeader` no longer branch on profile — both profiles go through Caddy with basic auth.

### `helpers/workspace.ts`

```typescript
import { getApiUrl, getAuthHeader } from "./platform";

const POLL_INTERVAL = 1000;

export function uniqueWorkspaceName(): string {
  return `e2e-${Date.now()}`;
}

export function provisionTimeout(): number {
  const profile = process.env.E2E_PROFILE ?? "development";
  return profile === "test" ? 15_000 : 3 * 60 * 1000;
}

export async function deleteWorkspaceViaApi(name: string): Promise<void> {
  const apiUrl = getApiUrl();
  const headers: Record<string, string> = {
    Authorization: getAuthHeader(),
  };

  const listRes = await fetch(`${apiUrl}/workspaces?limit=100`, { headers });
  const { items } = await listRes.json();
  const workspace = items.find((w: { name: string }) => w.name === name);
  if (!workspace) return;

  if (workspace.status === "running") {
    await fetch(`${apiUrl}/workspaces/${workspace.id}/stop`, {
      method: "POST",
      headers,
    });
    await pollUntilStatus(workspace.id, "stopped");
  }

  if (workspace.status !== "creating" && workspace.status !== "stopping") {
    await fetch(`${apiUrl}/workspaces/${workspace.id}`, {
      method: "DELETE",
      headers,
    });
  }
}

export async function pollUntilStatus(
  id: string,
  status: string,
  timeout = provisionTimeout(),
): Promise<void> {
  const apiUrl = getApiUrl();
  const headers: Record<string, string> = {
    Authorization: getAuthHeader(),
  };

  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const res = await fetch(`${apiUrl}/workspaces/${id}`, { headers });
    const workspace = await res.json();
    if (workspace.status === status) return;
    if (workspace.status === "error") {
      throw new Error(
        `Workspace entered error state: ${workspace.errorMessage}`,
      );
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
  throw new Error(`Workspace did not reach "${status}" within ${timeout}ms`);
}
```

## Phase 1: Smoke Test — Dashboard Loads

**Goal:** Validate the test infrastructure works: Caddy routes traffic, auth works, browser connects, SPA renders.

**Runs in:** CI + local

### `tests/01-smoke.spec.ts`

```typescript
import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  connectBrowser,
  createTestContext,
  isTestProfile,
} from "../helpers/platform";

test.describe("Smoke: dashboard loads", () => {
  test.describe.configure({ mode: "serial" });

  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async () => {
    browser = await connectBrowser();
    context = await createTestContext(browser);
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await context?.close();
    if (isTestProfile()) await browser?.close();
  });

  test("can reach the dashboard through Caddy", async () => {
    await page.goto("/app/workspaces");
    await expect(page).toHaveURL(/\/app\/workspaces/);
  });

  test("dashboard renders the workspace list", async () => {
    const heading = page.getByRole("heading", { name: "Workspaces" });
    const emptyState = page.getByText("No workspaces yet");
    await expect(heading.or(emptyState)).toBeVisible();
  });

  test("header navigation is visible", async () => {
    await expect(page.getByRole("link", { name: "Rockpool" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Workspaces" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "New workspace" }),
    ).toBeVisible();
  });

  test("health check bypasses auth", async () => {
    // Caddy intercepts /api/health with a static 200 "OK" (no auth required)
    const response = await page.request.fetch("/api/health", {
      headers: {},
    });
    expect(response.ok()).toBeTruthy();
    expect(await response.text()).toBe("OK");
  });

  test("API is reachable through Caddy", async () => {
    // This goes through auth gate → API proxy → server
    const response = await page.request.get("/api/workspaces?limit=1");
    expect(response.ok()).toBeTruthy();
  });
});
```

### Phase 1 deliverables

- `@playwright/test` added as devDependency
- `playwright.config.ts` with dual-profile support and full stack startup
- Helper modules for browser connection, auth, workspace API
- Smoke test that validates Caddy routing, auth, dashboard rendering, and API health
- npm scripts for running tests
- Code changes: configurable srv0 port, worker RUNTIME support

### Phase 1 validation

```bash
# Test profile (stub runtime, real everything else):
npm run test:e2e:smoke

# Development profile (platform already running):
npm run test:e2e:smoke
```

## Phase 2: Workspace Lifecycle — Create, Provision, Stop, Delete

**Goal:** Exercise the workspace state machine through the UI. The full stack processes real queue messages through the real worker — only the VM operations are stubbed (instant boot, fake IPs). This validates the Caddy route lifecycle too: stub workspaces get real Caddy routes added/removed.

**Runs in:** CI + local

### `tests/02-workspace-lifecycle.spec.ts`

```typescript
import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  connectBrowser,
  createTestContext,
  isTestProfile,
} from "../helpers/platform";
import {
  deleteWorkspaceViaApi,
  provisionTimeout,
  uniqueWorkspaceName,
} from "../helpers/workspace";

test.describe("Workspace lifecycle: create → provision → stop → delete", () => {
  test.describe.configure({ mode: "serial" });

  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  const workspaceName = uniqueWorkspaceName();

  test.beforeAll(async () => {
    browser = await connectBrowser();
    context = await createTestContext(browser);
    page = await context.newPage();
  });

  test.afterAll(async () => {
    try {
      await deleteWorkspaceViaApi(workspaceName);
    } catch {
      // Best-effort cleanup
    }
    await context?.close();
    if (isTestProfile()) await browser?.close();
  });

  test("open create workspace dialog", async () => {
    await page.goto("/app/workspaces");
    await page.getByRole("button", { name: "New workspace" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText("Create workspace")).toBeVisible();
  });

  test("fill in workspace name and submit", async () => {
    await page.getByLabel("Name").fill(workspaceName);
    await page.getByRole("button", { name: "Create workspace" }).click();
  });

  test("navigates to workspace detail page", async () => {
    await expect(page).toHaveURL(/\/app\/workspaces\//);
    await expect(
      page.getByRole("heading", { name: workspaceName }),
    ).toBeVisible();
  });

  test("workspace provisions and reaches running state", async () => {
    await expect(page.getByText("running")).toBeVisible({
      timeout: provisionTimeout(),
    });
  });

  test("Open IDE link appears when running", async () => {
    await expect(page.getByRole("link", { name: "Open IDE" })).toBeVisible();
  });

  test("stop the workspace", async () => {
    await page.getByRole("button", { name: "Stop" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Stop workspace" }).click();
    await expect(page.getByText("stopped")).toBeVisible({
      timeout: isTestProfile() ? 10_000 : 60_000,
    });
  });

  test("delete the workspace", async () => {
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Delete workspace" }).click();
    await expect(page).toHaveURL(/\/app\/workspaces$/);
  });

  test("workspace no longer appears in the list", async () => {
    await expect(page.getByText(workspaceName)).not.toBeVisible({
      timeout: 10_000,
    });
  });
});
```

### Phase 2 deliverables

- Full lifecycle test through the UI
- Validates real queue processing (server → ElasticMQ → worker → DB → Caddy route)
- Timeout-aware assertions that adapt to CI vs local
- Cleanup via direct API calls in afterAll

### Phase 2 validation

```bash
# Test profile (~10s with stubs, real queue/Caddy):
npm run test:e2e:lifecycle

# Development profile (~3 min with real VMs):
npm run test:e2e:lifecycle
```

## Phase 3: IDE Loading Verification (Local Only)

**Goal:** After a workspace reaches `running`, open the IDE URL on srv1 and verify code-server loads through the Caddy proxy chain.

**Runs in:** local only (requires real VM with code-server)

### Key challenge: cross-origin navigation

The IDE runs on srv1 (:8081), a different origin from the dashboard on srv0 (:8080). Since we connect via CDP locally, we can navigate to any origin within the same browser.

### `tests/03-ide-loading.spec.ts`

```typescript
import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  connectBrowser,
  createTestContext,
  getApiUrl,
  getAuthHeader,
} from "../helpers/platform";
import {
  deleteWorkspaceViaApi,
  pollUntilStatus,
  uniqueWorkspaceName,
} from "../helpers/workspace";

const profile = process.env.E2E_PROFILE ?? "development";
test.skip(
  profile === "test",
  "IDE loading requires real VMs — development profile only",
);

const IDE_PORT = Number.parseInt(process.env.SRV1_PORT ?? "8081", 10);

function buildIdeUrl(workspaceName: string): string {
  return `http://localhost:${IDE_PORT}/workspace/${workspaceName}/`;
}

test.describe("IDE loading: code-server renders in browser", () => {
  test.describe.configure({ mode: "serial" });

  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  const workspaceName = uniqueWorkspaceName();

  test.beforeAll(async () => {
    browser = await connectBrowser();
    context = await createTestContext(browser);
    page = await context.newPage();

    const apiUrl = getApiUrl();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: getAuthHeader(),
    };

    const createRes = await fetch(`${apiUrl}/workspaces`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: workspaceName,
        image: "rockpool-workspace",
      }),
    });
    const workspace = await createRes.json();
    await pollUntilStatus(workspace.id, "running");
  });

  test.afterAll(async () => {
    try {
      await deleteWorkspaceViaApi(workspaceName);
    } catch {
      // Best-effort cleanup
    }
    await context?.close();
  });

  test("IDE URL responds (no 502)", async () => {
    const response = await page.goto(buildIdeUrl(workspaceName), {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status()).toBeLessThan(500);
  });

  test("code-server root element renders", async () => {
    await expect(
      page.locator(".monaco-workbench, #workbench\\.parts\\.editor, .web-api"),
    ).toBeVisible({ timeout: 60_000 });
  });

  test("IDE shows activity bar", async () => {
    await expect(
      page.locator(".activitybar, [id='workbench.parts.activitybar']"),
    ).toBeVisible({ timeout: 30_000 });
  });

  test("IDE menu bar is present", async () => {
    await expect(
      page.locator(".title-actions, .menubar, [role='menubar']"),
    ).toBeVisible({ timeout: 15_000 });
  });
});
```

### Phase 3 deliverables

- IDE loading test skipped in test profile via `test.skip(profile === "test", ...)`
- Creates workspace via API, opens IDE URL, verifies VS Code DOM elements
- Catches Caddy proxy chain, prefix stripping, and code-server startup issues

## `test.env`

Committed to the repo. Contains no secrets — only configuration for the test stack on the 9xxx port range.

```bash
# E2E test profile — real stack, stub runtime, ephemeral DB, separate ports
E2E_PROFILE=test

# Server
PORT=9163
SRV0_PORT=9080
SRV1_PORT=9081
DB_PATH=/tmp/rockpool-e2e.db
SPA_PROXY_URL=http://localhost:9173

# Caddy
CADDY_ADMIN_URL=http://localhost:9019
CADDY_USERNAME=test
CADDY_PASSWORD=test

# Queue (ElasticMQ on test port)
QUEUE_ENDPOINT=http://localhost:9424
QUEUE_URL=http://localhost:9424/000000000000/workspace-jobs

# E2E helper URLs (resolved through Caddy, not direct)
DASHBOARD_URL=http://localhost:9080
API_URL=http://localhost:9080/api
```

Add `!test.env` to `.gitignore` exceptions.

## GitHub Actions Workflow

```yaml
name: E2E Tests

on:
  push:
    branches: [main]
  pull_request:

jobs:
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Install Caddy
        run: |
          sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
          curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
          curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
          sudo apt-get update
          sudo apt-get install caddy

      - name: Install dependencies
        run: npm ci

      - name: Download ElasticMQ
        run: npm-scripts/setup-elasticmq.sh download

      - name: Install Playwright Chromium
        run: npx playwright install chromium

      - name: Run E2E tests (test profile)
        run: E2E_PROFILE=test npm run test:e2e

      - name: Upload test artifacts
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: |
            e2e/test-results/
            e2e/playwright-report/
          retention-days: 7
```

Key points:

- Caddy installed via official apt repository
- Java is pre-installed on `ubuntu-latest` runners
- PM2 is installed via `npm ci` (devDependency)
- `npm ci` triggers `preinstall` which runs `make` to generate TypeSpec artifacts
- ElasticMQ jar downloaded ahead of time (`globalSetup` starts it via PM2)
- `E2E_PROFILE=test` tells the Playwright config to activate `globalSetup`/`globalTeardown`, which start the test stack via PM2
- Phase 3 (IDE loading) is automatically skipped via `test.skip`

## npm Scripts

```json
{
  "test:e2e": "npx playwright test --config e2e/playwright.config.ts",
  "test:e2e:smoke": "npx playwright test --config e2e/playwright.config.ts tests/01-smoke.spec.ts",
  "test:e2e:lifecycle": "npx playwright test --config e2e/playwright.config.ts tests/02-workspace-lifecycle.spec.ts",
  "test:e2e:ide": "npx playwright test --config e2e/playwright.config.ts tests/03-ide-loading.spec.ts"
}
```

## Bonus: API Integration Tests in CI

The same test stack (real Caddy + server + worker + queue + ephemeral DB on 9xxx ports) can also run API integration tests that go through the full request path. Tests can `fetch()` against `http://localhost:9080/api/...` with basic auth headers and exercise the real API through Caddy — no mocks.

This is a separate effort, but the infrastructure from this EDD makes it possible with zero additional setup. The test stack is started once, and both E2E browser tests and API integration tests run against it.

## File Layout

```
rockpool/
  test.env                          # Committed — test stack config (9xxx ports)
  ecosystem.test.config.cjs         # PM2 ecosystem for test stack
  elasticmq.conf                    # Dev ElasticMQ config (port 9324)
  elasticmq.test.conf               # Test ElasticMQ config (port 9424)
  e2e/
    playwright.config.ts            # Dual-profile config
    global-setup.ts                 # Starts PM2 test stack, polls health
    global-teardown.ts              # Stops PM2 test stack, cleans DB
    helpers/
      platform.ts                   # Browser connection, auth (always on)
      workspace.ts                  # API helpers, unique names, cleanup
    tests/
      01-smoke.spec.ts              # Phase 1: Caddy routing + dashboard (both profiles)
      02-workspace-lifecycle.spec.ts # Phase 2: full CRUD lifecycle (both profiles)
      03-ide-loading.spec.ts        # Phase 3: IDE renders (development profile only)
  .github/
    workflows/
      e2e.yml                       # GitHub Actions workflow
  package.json                      # +test:e2e scripts, +@playwright/test devDep
```

## Environment Variables

| Variable          | `test.env`                  | `development.env`           | Description               |
| ----------------- | --------------------------- | --------------------------- | ------------------------- |
| `E2E_PROFILE`     | `test`                      | `development`               | Switches test profile     |
| `PORT`            | `9163`                      | `7163` (default)            | API server port           |
| `SRV0_PORT`       | `9080`                      | `8080` (default)            | Caddy dashboard port      |
| `SRV1_PORT`       | `9081`                      | `8081` (default)            | Caddy IDE port            |
| `DB_PATH`         | `/tmp/rockpool-e2e.db`      | `rockpool.db` (default)     | SQLite database file      |
| `CADDY_ADMIN_URL` | `http://localhost:9019`     | `http://localhost:2019`     | Caddy admin API           |
| `CADDY_USERNAME`  | `test`                      | from `development.env`      | Basic auth username       |
| `CADDY_PASSWORD`  | `test`                      | from `development.env`      | Basic auth password       |
| `SPA_PROXY_URL`   | `http://localhost:9173`     | `http://localhost:5173`     | Vite dev server           |
| `QUEUE_ENDPOINT`  | `http://localhost:9424`     | `http://localhost:9324`     | ElasticMQ endpoint        |
| `QUEUE_URL`       | `http://localhost:9424/...` | `http://localhost:9324/...` | SQS queue URL             |
| `DASHBOARD_URL`   | `http://localhost:9080`     | `http://localhost:8080`     | SPA entry (through Caddy) |
| `API_URL`         | `http://localhost:9080/api` | `http://localhost:8080/api` | API base (through Caddy)  |
| `CDP_URL`         | (unused)                    | `http://localhost:9222`     | Chrome DevTools Protocol  |

## Running the Tests

### CI (automatic on push/PR)

GitHub Actions sets `E2E_PROFILE=test` and runs phases 1-2 automatically. Phase 3 is skipped. The full stack is started by Playwright's `webServer` config on the 9xxx port range.

### Local — quick validation (test profile, no VMs needed)

```bash
# Starts full stack on 9xxx ports — safe to run while npm start is up
npm run test:e2e
```

### Local — full validation (development profile, real VMs)

```bash
# Terminal 1: start platform
npm start

# Terminal 2: start debug browser
npm run chrome:debug

# Terminal 3: run all tests (including IDE loading)
E2E_PROFILE=development npm run test:e2e
```

## What Each Mode Catches

| Regression category                                 | Test profile (stub VMs) | Development profile (real VMs) |
| --------------------------------------------------- | ----------------------- | ------------------------------ |
| SPA build failures (broken imports, missing assets) | Yes                     | Yes                            |
| API contract mismatches (SDK vs server)             | Yes                     | Yes                            |
| UI interaction bugs (dialogs, navigation, polling)  | Yes                     | Yes                            |
| Workspace state machine bugs                        | Yes                     | Yes                            |
| Caddy route configuration (bootstrap, auth gates)   | Yes                     | Yes                            |
| Basic auth misconfiguration                         | Yes                     | Yes                            |
| API proxy routing through Caddy                     | Yes                     | Yes                            |
| Queue processing (server → ElasticMQ → worker)      | Yes                     | Yes                            |
| Workspace Caddy route lifecycle (add/remove)        | Yes (stub IPs)          | Yes (real IPs)                 |
| VM provisioning failures                            | No                      | Yes                            |
| code-server proxy chain issues                      | No                      | Yes                            |
| WebSocket upgrade failures                          | No                      | Yes                            |

## Open Questions

- [ ] Should we add `data-testid` attributes to UI components for more stable selectors? Current selectors use role/text which works but may break on copy changes.
- [ ] Should Phase 3 test terminal interaction (type a command, verify output)? This would validate WebSocket proxying but adds complexity.
- [ ] Should we add a Phase 4 that tests port forwarding (register a port, open preview URL)?
- [x] Should `setup-elasticmq.sh` accept a config file argument? — Yes, `setup-elasticmq.sh test` uses `elasticmq.test.conf`, `setup-elasticmq.sh download` pre-caches the jar.
- [x] Can E2E tests run in CI without real VMs? — Yes, all phases except IDE loading run against stub runtime with the real stack.
- [x] Should the test profile run through Caddy? — Yes, both profiles use real Caddy with basic auth. This validates routing, auth, and proxy configuration in CI.

## Implementation Notes

### Phase 1 — Implemented (2026-02-24)

PR: #4

All Phase 1 deliverables implemented as specified. Smoke tests pass locally (5/5 in ~12s).

#### CI fixes discovered during implementation

The E2E workflow exposed two pre-existing CI issues unrelated to the E2E tests themselves:

1. **`sed -i ''` is macOS-only** — The Makefile used `sed -i ''` which doesn't work on Linux (GNU sed interprets `''` as a filename). Fixed to `sed -i.bak` with cleanup, which works on both platforms.

2. **`make all` tries to build Tart VM image** — The `all` target includes the Packer/Tart VM image, which is macOS-only (Tart uses Apple Virtualization.framework). Added a `make ci` target that builds only code artifacts. The `preinstall` script uses `make ci` when the `CI` env var is set (GitHub Actions sets this automatically).

#### Global setup requires auth for SPA readiness

The global-setup polls both `/api/health` (no auth, Caddy static response) and `/app/workspaces` (requires basic auth) before running tests. The SPA check ensures Vite has finished compiling — without it, tests hit a blank page because Caddy is up before Vite is ready.

### Phase 2 — Implemented (2026-02-24)

PR: #6

Full workspace lifecycle test (8 serial tests, ~16s with stubs): create → provision → stop → delete through the UI.

#### Worker missing no-op health check for stub runtime

The server already had a no-op health check when using `StubRuntime`, but the worker didn't. The `defaultHealthCheck` curls `http://${vmIp}:8080/healthz` — stub VMs have fake IPs (10.0.1.x) that don't respond, so provisioning hung. Fixed by passing a no-op health check in the worker when `RUNTIME !== "tart"`.

#### Global setup ensures queue exists

ElasticMQ's config-based queue auto-creation can fail when the dev ElasticMQ is also running (port conflict on the management interface). Added `ensureQueue()` in global-setup that creates the `workspace-jobs` queue via the SQS `CreateQueue` API, polling until ElasticMQ is ready.

### Phase 3 — Implemented (2026-02-24)

PR: #7

IDE loading verification test (4 tests, ~10s with real VMs). Skipped in CI via `test.skip(profile === "test")`.

#### Playwright strict mode requires specific selectors

The EDD specified comma-separated CSS selectors as fallbacks (e.g., `.monaco-workbench, #workbench\\.parts\\.editor, .web-api`). These match multiple elements simultaneously, triggering Playwright's strict mode violation. Fixed by using single specific selectors: `.monaco-workbench`, `[id='workbench.parts.activitybar']`, `[role='menubar']`.
