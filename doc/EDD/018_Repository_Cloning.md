# EDD-018: Repository Cloning During Workspace Provisioning

| Field   | Value                                                                                                                  |
| ------- | ---------------------------------------------------------------------------------------------------------------------- |
| Author  | mvhenten                                                                                                               |
| Status  | Draft                                                                                                                  |
| Created | 2026-02-25                                                                                                             |
| Updated | 2026-02-25                                                                                                             |
| Related | [RFC-001](../RFC/001_Workspace_From_GitHub_Repository.md), [EDD-017](017_Workspace_Creation_Wizard.md), [EDD-016](016_GitHub_Repository_Listing.md) |

## Summary

When a user creates a workspace with a GitHub repository selected, the worker clones the repository into the VM during provisioning and opens code-server in the cloned directory. The user lands in a running IDE with their code already checked out and git credentials configured — no manual setup.

This implements Phases 3–4 of RFC-001 (token passing, credential injection, clone during provisioning). Phase 5 (UI) is already done in EDD-017.

## Prerequisites

- [RFC-001](../RFC/001_Workspace_From_GitHub_Repository.md) Phase 1 — GitHub App migration (done)
- [EDD-016](016_GitHub_Repository_Listing.md) — Repository listing API (done)
- [EDD-017](017_Workspace_Creation_Wizard.md) — Workspace creation wizard with repo picker (done)
- Workspace `repositoryId` column exists and is linked through the full stack (done in EDD-017 Step 7)

## Problem

Right now, creating a workspace with a repository selected stores the repository link in the DB but does nothing with it. The VM boots with an empty home directory. The user must open a terminal, set up credentials, and `git clone` manually. Every workspace starts the same way, which is exactly the friction we set out to eliminate.

The pieces are in place — the wizard passes a repository, the DB stores it, the worker provisions the VM. The missing link: making the worker clone the repository and configure credentials before the workspace goes live.

## Design Goals

**Fast.** The clone should not add perceptible latency to workspace creation. For most repositories (under ~500MB), the user should not notice the clone — it happens while the VM is booting and code-server is starting.

**Simple.** No new infrastructure. The worker already SSHs into VMs. Cloning is one more SSH command in the provisioning pipeline.

**Push-ready.** The credential helper stays on disk. `git push` works out of the box as long as the token is valid (~8 hours). No extra setup for the user.

## Architecture

### Token Flow

The GitHub access token lives in the server's in-memory session store. The worker has no access to sessions. The token must travel through the queue.

```
Browser → Server (session cookie)
                → queue.send({ workspaceId, repository, githubAccessToken })
                        → Worker picks up job
                                → SSH into VM: write credential helper
                                → SSH into VM: git clone
```

The server reads the token from `res.locals.session` at workspace creation time and includes it in the queue payload. The token is the user's 8-hour GitHub access token — it has the intersection of the GitHub App's permissions (`Contents: Read`) and the user's own repository access.

**Security note:** The token sits in the ElasticMQ queue on localhost until the worker processes it. ElasticMQ is not exposed externally. The token expires in 8 hours regardless. This is acceptable for a single-user self-hosted tool. See RFC-001 Security Model for the full analysis.

### Queue Payload Extension

```typescript
// Current
interface WorkspaceJob {
    type: "create" | "start" | "stop" | "delete";
    workspaceId: string;
}

// New
interface WorkspaceJob {
    type: "create" | "start" | "stop" | "delete";
    workspaceId: string;
    repository?: string;          // "owner/repo" full_name
    githubAccessToken?: string;   // 8h user access token
}
```

Both fields are optional. Existing job types (`start`, `stop`, `delete`) never set them. The `create` type sets `repository` when the workspace has a linked repository, and `githubAccessToken` when the user has a valid GitHub session. The token may be absent (unauthenticated flow, E2E tests) — public repos clone fine without it.

### Credential Injection

When a `githubAccessToken` is provided, the worker writes a git credential helper script to the VM via SSH. When no token is provided (public repos), the credential helper step is skipped and `git clone` runs without credentials.

```bash
#!/bin/sh
echo "protocol=https"
echo "host=github.com"
echo "username=x-access-token"
echo "password=ghp_XXXXX"
```

At `~/.rockpool/git-credential-helper`, configured as:

```bash
git config --global credential.helper '/home/admin/.rockpool/git-credential-helper'
```

This is the standard git mechanism. The token is not visible in process lists or shell history. It works for all git operations (`clone`, `pull`, `push`, `fetch`). The file persists on VM disk but the token expires in ~8 hours. After expiry, git operations return a 401 — not a security risk, just a usability limit addressed by workspace restart (which re-injects a fresh token in a future iteration).

### Clone Strategy

```bash
git clone --depth 1 --single-branch https://github.com/{owner}/{repo}.git /home/admin/{repo}
```

**`--depth 1`**: Shallow clone. Downloads only the latest commit, not the full history. For a typical project (~50MB working tree), this reduces clone time from minutes to seconds. The user can `git fetch --unshallow` later if they need full history.

**`--single-branch`**: Only fetch the default branch. Combined with `--depth 1`, this is the fastest possible clone — minimal network transfer, minimal disk writes.

**Target directory**: `/home/admin/{repo}` — uses the repository name (part after `/` in `owner/repo`). For `mvhenten/rockpool`, the directory is `/home/admin/rockpool`. This is the natural location a developer would choose.

### Parallel Provisioning

The current provisioning pipeline is sequential:

```
Boot VM → Get IP → Configure code-server → Health check → Add Caddy route
```

Cloning and code-server configuration are independent operations. They both SSH into the VM but touch different files and services. Running them in parallel means the clone is "free" whenever it finishes before the health check — which it will for most repositories.

```
Boot VM → Get IP → ┬─ Configure code-server ─┐
                    └─ Clone repository ───────┤
                                               ├─ Health check → Add Caddy route
```

If the clone finishes first, it waits for configure. If configure finishes first (likely for large repos), the health check runs as soon as code-server is ready, then `provisionAndStart` completes. The clone's `Promise` is awaited alongside the configure — if it rejects, the workspace enters the error state.

**Why not fire-and-forget the clone?** If the clone fails (bad token, deleted repo, network error), the user should know immediately, not discover it after the workspace is "running". Failing the whole provision is the right UX — the error message tells them exactly what went wrong.

### Code-Server Working Directory

After the clone succeeds, code-server should open in the cloned directory, not `~`. The `configure()` step in the runtime already writes a `config.yaml` and restarts code-server. We need to also set the working directory.

Code-server supports a `--folder` CLI flag. The systemd unit for code-server runs:

```
ExecStart=/usr/bin/code-server --bind-addr 0.0.0.0:8080
```

We modify the configure step: if a repository was cloned, update the systemd override to include `--folder /home/admin/{repo}`. On restart, code-server opens directly in the project.

Implementation: the `configure()` function in `tart-runtime.ts` gains an optional `folder` parameter. When set, it creates a systemd drop-in override:

```bash
mkdir -p /etc/systemd/system/code-server@admin.service.d
printf '[Service]\nExecStart=\nExecStart=/usr/bin/code-server --bind-addr 0.0.0.0:8080 --folder /home/admin/{repo}\n' \
  | sudo tee /etc/systemd/system/code-server@admin.service.d/folder.conf
sudo systemctl daemon-reload
```

The `ExecStart=` empty line is required by systemd to clear the previous `ExecStart` before setting a new one. The `daemon-reload` picks up the new override. The subsequent `systemctl restart code-server@admin` in `configure()` then uses the new command.

**Why a systemd drop-in instead of modifying the unit file?** Drop-ins survive package updates and are the systemd-recommended way to customize service units. If the base code-server package is updated, the drop-in persists.

### Workspace Restart Behavior

When a workspace with a repository is stopped and restarted:

1. The VM disk persists (`tart stop` does not delete the VM)
2. The cloned code is still at `/home/admin/{repo}`
3. `provisionAndStart` starts the VM, reconfigures code-server (including the folder override), health checks, adds Caddy route
4. The user lands back in their code — no re-clone needed

**Token re-injection on restart is deferred.** The restart queue job currently has no token. The server's `start()` method would need the session token passed through. For v1, after 8 hours the credential helper's token is stale and `git push` fails with a clear 401. The fix is to re-authenticate (restart the workspace after a fresh login), or add a "refresh credentials" endpoint in a future iteration.

### Error Handling

| Failure                        | Behavior                                                | Error message                                    |
| ------------------------------ | ------------------------------------------------------- | ------------------------------------------------ |
| Clone fails (404)              | `provisionAndStart` throws, workspace → error state     | `Repository "owner/repo" not found or not accessible` |
| Clone fails (401)              | Same                                                    | `GitHub authentication failed — token may have expired` |
| Clone fails (network)          | Same                                                    | `Failed to clone repository: {git error output}` |
| Clone times out                | SSH exec times out (inherit runtime timeout), → error   | `Repository clone timed out`                     |
| Token missing (no GitHub auth) | Clone still attempted (works for public repos)          | Clone failure if repo is private                 |
| No repository field            | No clone attempted, workspace provisions blank           | None — same as today                             |

The "token missing" case handles the unauthenticated flow (E2E tests, non-GitHub auth). The workspace is created, the `repositoryId` is stored, but no clone happens. The user sees a blank workspace and can clone manually.

## Implementation

### Step 1: Extend queue payload types

Add optional `repository` and `githubAccessToken` fields to `WorkspaceJob` in `@rockpool/queue`.

```
packages/queue/src/types.ts
```

### Step 2: Pass token and repository through the creation flow

The server workspace route already resolves `repositoryId` to a DB record. After resolving, it needs to:
1. Look up the repository's `full_name` from the DB record
2. Read the session's `githubAccessToken`
3. Pass both to `workspace-service.create()`
4. `create()` includes them in the queue payload

Changes:
```
packages/server/src/routes/workspaces.ts     -- pass full_name and token to service
packages/workspace-service/src/workspace-service.ts -- accept and forward to queue
```

### Step 3: Add `getRepository` DB query

The workspace route already has the repository record from the upsert. Pass the `full_name` directly — no new query needed. But for the restart path (future), add a `getRepository` query to resolve `repositoryId → Repository` from the worker side.

```
packages/db/src/queries.ts -- add getRepository(db, id)
```

### Step 4: Add clone capability to the runtime

Add a `clone` method to the `RuntimeRepository` interface and implement it in `TartRuntime`. This method:
1. Writes the credential helper script via SSH
2. Configures git to use it via SSH
3. Runs `git clone --depth 1 --single-branch` via SSH

The method is separate from `configure()` because cloning is an optional step with different error semantics.

```
packages/runtime/src/types.ts          -- add clone() to RuntimeRepository
packages/runtime/src/tart-runtime.ts   -- implement clone via sshExec
packages/runtime/src/stub-runtime.ts   -- no-op stub for tests
```

### Step 5: Add folder parameter to configure

Extend `configure()` to accept an optional `folder` path. When set, it writes a systemd drop-in override so code-server opens in that directory.

```
packages/runtime/src/tart-runtime.ts   -- extend configure() env with ROCKPOOL_FOLDER
```

### Step 6: Wire clone into provisionAndStart

After getting the VM IP, run `clone()` and `configureAndWait()` in parallel using `Promise.all`. Pass the repository name as the folder to `configure()`.

```
packages/workspace-service/src/workspace-service.ts -- parallel clone + configure
```

The flow becomes:

```typescript
const vmIp = await runtime.getIp(workspace.name);

const repoName = repository?.split("/")[1];
const clonePromise = repository
    ? runtime.clone(workspace.name, vmIp, repository, githubAccessToken)
    : Promise.resolve();

const folder = repoName ? `/home/admin/${repoName}` : undefined;
await Promise.all([
    configureAndWait(workspace.name, vmIp, folder),
    clonePromise,
]);
```

The `githubAccessToken` is optional in `clone()`. When present, the credential helper is written before cloning. When absent (public repos), the clone runs without credentials.

### Step 7: Update processor to pass job fields

The processor currently calls `provisionAndStart(job.workspaceId)`. Update it to forward the new job fields so the workspace service can use them.

```
packages/worker/src/processor.ts -- pass repository and token from job
packages/workspace-service/src/workspace-service.ts -- accept in provisionAndStart
```

### Step 8: E2E tests

Two levels of E2E coverage, matching the existing test patterns:

**CI (stub runtime):** The existing `04-github-workspace.spec.ts` already creates a workspace from `octocat/Hello-World` and waits for "running" state. Once the clone step is wired in, this test exercises the full code path through the stub — token flows through queue, `clone()` is called (no-op on stub), workspace reaches "running" without error. No changes needed to the test itself; the stub's no-op clone ensures backward compatibility.

**Full suite (real VMs):** New test file `05-clone-verification.spec.ts`, skipped in CI (same pattern as `03-ide-loading.spec.ts`). Uses the same public `octocat/Hello-World` repo as `04-github-workspace.spec.ts` — no GitHub auth token needed. This test:

1. Creates a workspace with `octocat/Hello-World` via the API (no auth token, public repo)
2. Polls until "running"
3. Navigates to the IDE URL (`/workspace/{name}/`)
4. Waits for code-server to render (Monaco workbench visible)
5. Verifies the file explorer shows the cloned repo's files (e.g., `README` from Hello-World)

This validates the full clone pipeline on a real VM: `git clone` via SSH succeeded → code-server `--folder` set correctly → user sees their code. The credential helper path (private repos + token) is covered by unit tests on the runtime.

```
e2e/tests/05-clone-verification.spec.ts  -- real VM clone verification (skipped in CI)
```

### Step 9: Unit tests for clone mechanics

The tart-runtime already has unit tests with injected mock `exec`. Add tests that verify:

1. The credential helper script content (correct token, correct format)
2. The git config command for the credential helper
3. The `git clone --depth 1 --single-branch` command with correct URL and target
4. Error propagation when clone fails (non-zero exit)

The workspace-service tests use `createMockRuntime()`. Add tests that verify:

1. `provisionAndStart` calls `clone()` when repository and token are provided
2. `provisionAndStart` skips `clone()` when no repository is set
3. Clone and configure run in parallel (both resolve before the workspace is marked running)
4. Clone failure puts the workspace in error state with a descriptive message

```
packages/runtime/test/tart-runtime.test.ts           -- clone SSH command verification
packages/workspace-service/test/workspace-service.test.ts -- clone integration in provisioning
```

## File Changes

```
packages/queue/src/types.ts                         -- extend WorkspaceJob
packages/runtime/src/types.ts                       -- add clone() to RuntimeRepository
packages/runtime/src/tart-runtime.ts                -- implement clone(), extend configure()
packages/runtime/src/stub-runtime.ts                -- no-op clone stub
packages/server/src/routes/workspaces.ts            -- pass repo + token to service
packages/workspace-service/src/workspace-service.ts -- parallel clone in provisionAndStart
packages/worker/src/processor.ts                    -- forward job fields
packages/db/src/queries.ts                          -- add getRepository()
e2e/tests/05-clone-verification.spec.ts             -- real VM clone E2E (skipped in CI)
packages/runtime/test/tart-runtime.test.ts          -- clone SSH command tests
packages/workspace-service/test/workspace-service.test.ts -- clone provisioning tests
```

## Decisions

| Question | Decision | Rationale |
| --- | --- | --- |
| Shallow or full clone? | `--depth 1 --single-branch` by default | Speed. Most IDE usage doesn't need full history. User can `git fetch --unshallow` when needed. |
| Clone target directory? | `/home/admin/{repo-name}` | Natural convention. Matches what a developer would type manually. |
| New "cloning" workspace status? | No — keep "creating" | Adding a status requires TypeSpec change, DB migration, client updates, state machine change. The UX benefit (showing "cloning..." instead of "creating...") doesn't justify the cost for v1. Revisit when we add progress streaming. |
| Token in queue vs. worker-fetches-token? | Token in queue | The worker has no access to the server's in-memory session store. Passing through the queue is simple, secure (localhost only), and avoids coupling. When we add persistent sessions, we can revisit. |
| Re-inject token on restart? | Deferred | Restart flow doesn't have access to a fresh token. The clone persists on disk. `git push` fails after 8h — acceptable for v1. |
| Parallel clone + configure? | Yes | They're independent SSH operations. Parallel execution hides clone latency behind code-server startup time. |
| Code-server folder mechanism? | Systemd drop-in override | Survives package updates. Standard systemd pattern. Cleaner than modifying the unit file directly. |

## Remaining Work

### Blocker: Fix workspace–repository FK constraint

The `workspace.repositoryId` column is `nullableText` (stores base36 as-is), but `repository.id` is `base36Uuid` (stores UUID via `toDriver`). SQLite FK enforcement (`PRAGMA foreign_keys = ON`) compares raw stored values — they never match, so workspace creation with a repo always fails with `SQLITE_CONSTRAINT_FOREIGNKEY`.

The current inline FK on `workspace.repositoryId` is the wrong modeling. Repositories and workspaces have a many-to-many relationship (a workspace could have multiple repos in the future, a repo can be cloned into multiple workspaces). Replace the inline FK with a **junction table**:

```typespec
@table("workspace_repository", "rockpool")
model WorkspaceRepository {
    @pk @references(Workspace.id)
    workspaceId: string;

    @pk @references(Repository.id)
    repositoryId: string;

    @createdAt @visibility(Lifecycle.Read)
    createdAt: utcDateTime;
}
```

Steps:
1. Add `WorkspaceRepository` junction table to `typespec/main.tsp`
2. Remove `repositoryId` from the `Workspace` model
3. Run `make all` to regenerate `@rockpool/db-schema`, `@rockpool/validators`, etc.
4. Update `packages/db/src/schema.ts` to export the new table
5. Update `packages/db/src/queries.ts`: replace `createWorkspace` repositoryId handling with junction table insert, add `getWorkspaceRepository(db, workspaceId)` query
6. Update the server workspace route to insert into the junction table after creating the workspace
7. Update workspace-service `create()` — no longer passes `repositoryId` to `dbCreateWorkspace`; instead inserts into junction table
8. Update the workspace list/get API to join the repository data (or add a sub-query)
9. Migrate the existing dev DB (drop old `repository_id` column, create junction table, re-link any existing records)
10. Run `npm run fix -- --unsafe` and verify all tests pass

### Remaining: Rebuild and re-run E2E

After the FK fix, the dev stack needs a rebuild and restart:
1. `make all` (regenerate TypeSpec artifacts)
2. Restart PM2 processes so server + worker pick up new code
3. Run `npm run test:e2e` (full suite with real VMs) to validate clone end-to-end

### Remaining: Verify clone E2E on real VMs

The `05-clone-verification.spec.ts` test is written but hasn't been validated against real VMs yet. After the FK fix + stack restart, confirm:
- Workspace with `octocat/Hello-World` reaches "running"
- Code-server opens with the cloned repo visible in the explorer

## Open Questions

- [ ] **Branch selection.** v1 clones the default branch. Should we add a branch picker to the wizard? This would require extending the Repository model or passing a branch through the creation flow.
- [ ] **Large repository handling.** Even with `--depth 1`, repositories with large binary assets (game engines, monorepos with vendored deps) can be slow. Should we set a timeout and fail gracefully, or let it run indefinitely? Current SSH exec timeout is ~60s which may be too short.
- [ ] **Clone progress streaming.** `git clone` outputs progress to stderr. We could capture it and stream to the client via SSE or WebSocket for real-time progress. Worth the complexity?
- [ ] **Token re-injection endpoint.** A `POST /api/workspaces/:id/refresh-credentials` that SSHs into the running VM and updates the credential helper with a fresh token. Avoids workspace restart for token refresh.
- [ ] **Multiple repositories per workspace.** The junction table makes this straightforward — insert multiple rows. The clone step and UI would need extending.
