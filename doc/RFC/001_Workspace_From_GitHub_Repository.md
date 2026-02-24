# RFC: Create Workspace from GitHub Repository

| Field   | Value                          |
| ------- | ------------------------------ |
| Author  | mvhenten                       |
| Status  | Draft                          |
| Created | 2026-02-24                     |
| Related | EDD-003, EDD-007, EDD-011, EDD-015 |

## Problem

Rockpool workspaces are blank slates. A user creates a workspace with a name and a base image, gets an empty code-server environment, and must manually clone their code. This is the #1 friction point: every workspace starts with `git clone`, and if the repo is private, the user must manually set up credentials inside the VM.

The goal: a user picks a GitHub repository, clicks "Create", and lands in a running code-server with their code already checked out and ready to edit.

## Scope

This RFC covers:

1. Listing the user's accessible GitHub repositories in the client
2. Cloning a repository into the workspace VM during provisioning
3. Configuring git credentials inside the VM so `git push` works
4. The auth model changes required to make this secure

This RFC does **not** cover devcontainer support (see EDD-015), webhooks, PR integration, or multi-provider git hosting.

## The OAuth Scope Problem

Rockpool currently uses a **GitHub OAuth App** with scopes `read:user` and `email`. To access repositories, we would need to add the `repo` scope.

The `repo` scope grants **full read/write access** to all repositories the user can access: code, commit statuses, repository invitations, collaborators, deployment statuses, and webhooks. There is no `repo:read` scope. This has been a [long-standing community request](https://github.com/orgs/community/discussions/7891) since 2015 with no resolution.

The sub-scopes (`repo:status`, `repo_deployment`, `repo:invite`) do not grant code access -- they are narrowly scoped to metadata. The only scopes that touch code are:

| Scope         | Grants                                         |
| ------------- | ---------------------------------------------- |
| `repo`        | Full read/write on ALL public and private repos |
| `public_repo` | Full read/write on public repos only            |

For a cloud IDE that only needs to **clone** a repository and **push** changes back, `repo` is wildly overprivileged. It would allow Rockpool (or anyone who compromises the stored token) to delete branches, invite collaborators, or modify webhook configurations on every repo the user has access to.

This is not acceptable. We need a different approach.

## GitHub Apps: The Right Tool

GitHub Apps are GitHub's recommended model for integrations that need repository access. They solve every problem OAuth App scopes cannot:

| Capability                      | OAuth App        | GitHub App                          |
| ------------------------------- | ---------------- | ----------------------------------- |
| Read-only repo access           | Not possible     | `Contents: Read` permission         |
| Scope to specific repositories  | All or nothing   | Per-installation repo selection      |
| Token expiry                    | Never (manual)   | 1h (installation) / 8h (user)       |
| Token refresh                   | Not applicable   | 6-month refresh tokens              |
| Least privilege                 | Broad scopes     | Fine-grained permissions per category |

Every major cloud IDE uses GitHub Apps: Codespaces (built-in), Gitpod, CodeSandbox, Coder. This is the established pattern.

### GitHub App Permissions We Need

| Permission        | Level | Purpose                                      |
| ----------------- | ----- | -------------------------------------------- |
| Contents          | Read  | Clone repositories, read file listings        |
| Metadata          | Read  | List repositories, read repo metadata         |

That's it for read-only cloning. When we later want `git push` support:

| Permission        | Level | Purpose                                      |
| ----------------- | ----- | -------------------------------------------- |
| Contents          | Write | Push commits, create branches                 |

These are per-category permissions. `Contents: Write` does not grant access to issues, pull requests, webhooks, or any other GitHub feature. It is strictly scoped to repository content.

### Two Token Types

A GitHub App produces two kinds of tokens:

**User access token** (via web flow):
- Acts as the user, constrained by the app's permissions
- Issued through an OAuth-like web flow (nearly identical to current OAuth App flow)
- Expires in **8 hours**, with a **6-month refresh token**
- Can list all repos the user has access to
- Works for user-owned repos without app installation
- For org repos, requires the app to be installed on the org

**Installation access token** (via server-side JWT):
- Acts as the app, not the user
- Scoped to repos selected during app installation
- Can be further restricted to a **single repository** at generation time
- Expires in **1 hour**
- Generated server-side using the app's private key

Both are useful. User access tokens for browsing and listing. Installation access tokens for injecting into VMs (shorter-lived, tighter scope).

## Proposed Architecture

### Auth Flow: From OAuth App to GitHub App

The GitHub App web flow is nearly identical to the current OAuth App flow:

```
Current (OAuth App):
  1. GET https://github.com/login/oauth/authorize?client_id=OAUTH_ID&scope=read:user+email
  2. GitHub redirects to /api/auth/callback?code=XXX
  3. POST https://github.com/login/oauth/access_token → access_token (never expires)

Proposed (GitHub App):
  1. GET https://github.com/login/oauth/authorize?client_id=APP_ID
  2. GitHub redirects to /api/auth/callback?code=XXX
  3. POST https://github.com/login/oauth/access_token → access_token (8h) + refresh_token (6mo)
```

Key differences:

1. **No `scope` parameter.** GitHub App permissions are configured at app registration, not per-request. The authorization URL does not include scopes.
2. **Token expiry.** The access token expires in 8 hours. We must store the refresh token and refresh proactively.
3. **Refresh flow.** `POST https://github.com/login/oauth/access_token` with `grant_type=refresh_token` and `refresh_token=XXX`.

The rest of the auth flow -- session cookies, `forward_auth`, the verify endpoint -- is unchanged.

### Migration Path

This is not a parallel-run situation. The migration is a clean swap:

1. **Create a GitHub App** on github.com/settings/apps with:
   - User authorization callback: `http://localhost:8080/api/auth/callback`
   - Permissions: `Contents: Read`, `Metadata: Read`
   - Request user authorization (OAuth) during installation: Yes
2. **Replace env vars**: `GITHUB_OAUTH_CLIENT_ID` → `GITHUB_APP_CLIENT_ID`, same for secret
3. **Update `@rockpool/auth`**: remove `scopes` from config, add token refresh logic
4. **Update session model**: store `refreshToken` + `tokenExpiresAt` alongside `githubAccessToken`
5. **Remove the old OAuth App** from GitHub

Since Rockpool is a single-user self-hosted tool, there is no migration of existing users. The operator creates a new GitHub App and updates their `.env` file.

### Repository Listing

New API endpoint on the control plane:

```
GET /api/github/repos?page=1&per_page=30&sort=updated
```

This is a server-side proxy to GitHub's `GET /user/repos` API:

1. Extract the session's `githubAccessToken`
2. If the token is expired, refresh it using the stored `refreshToken`
3. Forward the request to `https://api.github.com/user/repos` with the token
4. Return a simplified response:

```json
{
  "items": [
    {
      "full_name": "mvhenten/rockpool",
      "description": "Cloud IDE platform",
      "private": false,
      "default_branch": "main",
      "updated_at": "2026-02-24T12:00:00Z",
      "clone_url": "https://github.com/mvhenten/rockpool.git"
    }
  ],
  "next_page": 2
}
```

Why proxy through the control plane instead of calling GitHub directly from the client:

1. The GitHub access token is stored server-side (in the session, never exposed to the browser)
2. Token refresh happens transparently
3. Rate limits are managed centrally
4. The response shape is controlled by Rockpool, not GitHub's API

### Workspace Creation with Repository

The workspace creation API gains an optional `repository` field:

```
POST /api/workspaces
{
  "name": "rockpool",
  "image": "rockpool-workspace",
  "repository": "mvhenten/rockpool"
}
```

When `repository` is present:
1. The server validates the format (`owner/repo`)
2. The server verifies the user has access to the repo (via GitHub API with the session token)
3. The workspace is created with `repository` stored in the DB
4. The queue job includes the repository info
5. The worker clones the repo during provisioning

When `repository` is absent:
- Current behavior, unchanged. Blank workspace.

### Clone During Provisioning

The `provisionAndStart()` flow gains a new step between "get VM IP" and "configure":

```
provisionAndStart(id)
  1. Get workspace from DB (now includes repository)
  2. Check VM status, create/start as needed
  3. Get VM IP
  4. [NEW] If repository is set:
     a. Generate a scoped credential for the repo
     b. SSH into VM: configure git credential helper
     c. SSH into VM: git clone https://github.com/{repository}.git /home/admin/workspace
  5. Configure code-server (existing step)
  6. Health check
  7. Add Caddy route
  8. Update DB status
```

The clone happens via SSH, using the same mechanism we already use for `configure()`.

### Credential Injection

The VM needs git credentials to clone private repos (and later, to push). There are three approaches, in order of preference:

#### Approach 1: Credential helper script (recommended for v1)

During provisioning, the worker writes a credential helper script to the VM via SSH:

```bash
#!/bin/sh
echo "protocol=https"
echo "host=github.com"
echo "username=x-access-token"
echo "password=TOKEN_VALUE_HERE"
```

Then configures git to use it:

```bash
git config --global credential.helper '/home/admin/.rockpool/git-credential-helper'
```

**Pros:** Standard git mechanism. Token not visible in process list or shell history. Works with all git operations (`clone`, `pull`, `push`, `fetch`).

**Cons:** Token stored as plaintext on the VM disk. If the VM is compromised, the token is exposed.

**Mitigation:** Use a token with the shortest viable lifetime. For installation access tokens (1h), this limits the exposure window. For user access tokens (8h), the risk is acceptable for a single-user self-hosted tool where the user trusts their own VMs.

#### Approach 2: Token vending service (future)

A daemon or API on the host that the VM contacts to get fresh credentials:

```bash
#!/bin/sh
# Credential helper that calls back to host
curl -s http://HOST_IP/api/internal/git-credential?workspace=NAME
```

**Pros:** No token stored on disk. Fresh token for every git operation. Central revocation.

**Cons:** Requires network path from VM to host. Currently, Tart VMs are NAT-isolated and cannot reach the host's control plane. Changing this has security implications (VMs could attack the control plane). Could use Tart's `--dir` virtiofs mount as a side-channel (mount a FIFO or socket), but this is complex.

**Verdict:** Not viable for v1 without network architecture changes. Desirable for a future multi-user deployment where VMs are less trusted.

#### Approach 3: Token embedded in clone URL (not recommended)

```bash
git clone https://x-access-token:TOKEN@github.com/owner/repo.git
```

**Cons:** Token visible in process list (`ps aux`), stored in `.git/config` as the remote URL, potentially logged by git. Breaks `git push` (stored URL may have an expired token). Not recommended by GitHub.

### Which Token to Inject?

Two options for the token we write to the VM:

**Option A: User access token (8h)**
- Already available in the session
- Works for any repo the user can access
- 8-hour window covers a workday
- After expiry, git operations fail until workspace restart

**Option B: Installation access token (1h, scoped to single repo)**
- Must be generated server-side using the GitHub App private key
- Scoped to just the target repository
- 1-hour window is too short for comfortable use
- Requires token refresh during the session (needs approach 2 above)

**Recommendation:** Use the **user access token** for v1. It's already available, lasts long enough for a session, and works for any repo. The 8-hour window matches a typical workday. When the token expires, `git push` fails with a clear error -- the user restarts their workspace (which re-injects a fresh token) or we add a "refresh credentials" API endpoint later.

For a future hardened multi-user deployment, switch to installation access tokens + token vending.

## Data Model Changes

### Workspace entity

Add an optional `repository` field:

```typespec
model Workspace {
  // ... existing fields ...

  @visibility(Lifecycle.Create, Lifecycle.Read)
  repository?: string;  // e.g. "mvhenten/rockpool"
}
```

This is a nullable text column in SQLite. Existing workspaces have `NULL`. The field is set at creation time and is immutable (you can't change the repo of a running workspace -- create a new one).

The `repository` value is the GitHub "full name" format: `owner/repo`. Not a URL. Not a `.git` suffix. The clone URL is derived: `https://github.com/{repository}.git`.

### Session model

Add `refreshToken` and `tokenExpiresAt`:

```typescript
interface Session {
  id: string;
  userId: number;
  username: string;
  githubAccessToken: string;
  refreshToken: string;       // new
  tokenExpiresAt: number;     // new: epoch ms
  createdAt: number;
  expiresAt: number;
}
```

The `tokenExpiresAt` tracks when the GitHub access token expires (8 hours from issuance). The `expiresAt` tracks when the session itself expires (24 hours from login). These are independent: a session can outlive its access token (we refresh), and an access token never outlives its session.

## API Changes

### New: `GET /api/github/repos`

List repositories the authenticated user can access.

Query parameters:
- `page` (int, default 1) -- page number
- `per_page` (int, default 30, max 100) -- results per page
- `sort` (string, default "updated") -- `created`, `updated`, `pushed`, `full_name`

Response:
```json
{
  "items": [
    {
      "full_name": "mvhenten/rockpool",
      "description": "Cloud IDE platform",
      "private": false,
      "default_branch": "main",
      "updated_at": "2026-02-24T12:00:00Z"
    }
  ],
  "next_page": 2,
  "total_count": 42
}
```

This endpoint is not defined in TypeSpec (it's a GitHub API proxy, not a Rockpool resource). It's a standalone Express route that reads the session token and forwards to GitHub.

### New: `GET /api/github/repos/search`

Search repositories by name. Proxies to GitHub's `GET /search/repositories` with the user's token.

Query parameters:
- `q` (string, required) -- search query
- `page` (int, default 1)
- `per_page` (int, default 30, max 100)

Note: GitHub's search API has a stricter rate limit (30 req/min). The server should enforce this and return 429 when exceeded.

### Modified: `POST /api/workspaces`

Add optional `repository` field to the request body:

```json
{
  "name": "rockpool",
  "image": "rockpool-workspace",
  "repository": "mvhenten/rockpool"
}
```

Validation:
- `repository` must match `^[a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+$` (GitHub owner/repo format)
- Server verifies the user has access to the repo before creating the workspace (HEAD request to `https://api.github.com/repos/{repository}` with the session token)
- If the repo is not accessible, return 422 with a clear error

### Queue Job Payload

The queue job for workspace creation gains the repository and access token:

```typescript
type CreateJob = {
  type: "create";
  workspaceId: string;
  repository?: string;
  githubAccessToken?: string;
};
```

The access token is passed through the queue so the worker can inject it into the VM without needing access to the session store. The queue is internal (ElasticMQ on localhost), so the token is not exposed externally. The token expires in 8 hours regardless.

**Alternative:** The worker could look up the session and get a fresh token. But the worker has no access to session state (it's in the server process's memory). Passing the token through the queue is simpler and avoids coupling the worker to the session store.

**Future alternative:** When we add persistent session storage (e.g., in SQLite), the worker can query it directly. At that point, we can remove the token from the queue payload and have the worker fetch a fresh token when it processes the job.

## Implementation Outline

### Phase 1: GitHub App Migration

1. Create a GitHub App on github.com
2. Update `@rockpool/auth`:
   - Remove `scopes` from `AuthConfig`
   - Add `refreshToken` and `tokenExpiresAt` to session
   - Add token refresh logic (called before any GitHub API request)
   - Handle the `refresh_token` and `expires_in` fields from the token exchange response
3. Update `packages/server/src/config.ts`:
   - Rename env vars (or keep the same names -- they serve the same purpose)
   - Remove the `scopes` array
4. Update `packages/server/src/app.ts`:
   - Token refresh middleware for API routes that need GitHub access
5. Test: OAuth login flow works with the new GitHub App

### Phase 2: Repository Listing API

1. Add `GET /api/github/repos` route to the server
2. Add `GET /api/github/repos/search` route
3. Both read the session's `githubAccessToken`, refresh if expired, forward to GitHub API
4. Test: can list and search repos through the new endpoints

### Phase 3: Workspace Creation with Repository

1. Add `repository` field to TypeSpec model → regenerate DB schema, validators, types
2. Update `createWorkspace` in workspace-service to accept and store `repository`
3. Update queue job payload to include `repository` and `githubAccessToken`
4. Update worker to pass these to `provisionAndStart()`
5. Test: workspace created with repository stored in DB

### Phase 4: Clone During Provisioning

1. Add clone step to `provisionAndStart()`:
   - After VM boot + SSH ready, before `configure()`
   - Write credential helper via SSH
   - Run `git clone` via SSH
2. Update `configure()` to set `code-server` working directory to the cloned repo
3. Increase SSH timeouts for clone operations (large repos)
4. Test: workspace boots with code already checked out

### Phase 5: Client UI

1. Add repo picker component (searchable list/dropdown)
2. Update workspace creation form: optional "Clone from repository" section
3. Auto-suggest workspace name from repo name (`my-org/my-repo` → `my-repo`)
4. Show clone progress in workspace detail (status: "creating" → "cloning" → "running"?)
5. Test: end-to-end workspace creation from repo picker

## Security Model

### Token Storage

| Token                  | Where stored        | Lifetime | Audience         |
| ---------------------- | ------------------- | -------- | ---------------- |
| User access token      | Server memory (session) | 8 hours  | GitHub API       |
| Refresh token          | Server memory (session) | 6 months | GitHub API       |
| Session ID             | Browser cookie (HttpOnly) | 24 hours | Control plane    |
| VM credential helper   | VM disk (`~/.rockpool/`) | 8 hours* | github.com       |

*The credential helper contains the user access token. It expires when the token expires, though the file persists. Stale tokens are harmless (git operations fail with 401, no security exposure).

### Token Scope

The user access token has the **intersection** of:
1. The GitHub App's permissions (`Contents: Read`, `Metadata: Read`)
2. The user's actual permissions on each repository

A user with read-only access to a repo gets read-only. A user with write access gets write access, up to the app's permission level. If the app only has `Contents: Read`, even a repo admin can only read through Rockpool's token.

### VM Trust Model

VMs are single-tenant (one user, one workspace). The user trusts their own VMs -- they run arbitrary code inside them. The token in the credential helper is the user's own token with their own permissions. If the VM is compromised, the attacker gets the same access the user already has, limited by the app's permissions and the 8-hour token expiry.

For multi-user deployments (future), this model should be tightened:
- Use installation access tokens (1h) scoped to a single repo
- Token vending service instead of disk-stored credentials
- Workspace-level token revocation on suspicious activity

### Rate Limits

GitHub API rate limits apply to the user access token: 5,000 requests/hour. The `/api/github/repos` endpoint is a proxy, so every client request results in one GitHub API request. The server should cache repo listings briefly (30-60 seconds) to avoid hammering GitHub when the user is browsing.

GitHub's search API has a stricter limit: 30 requests/minute. The `/api/github/repos/search` endpoint should enforce this and return 429 when the upstream limit is hit.

## GitHub App Installation UX

When the user first uses Rockpool with the GitHub App, they go through:

1. **Authorization** (like today's OAuth flow): "Rockpool wants to access your account" → Authorize
2. **Installation** (new): "Where do you want to install Rockpool?" → Select repos or "All repositories"

The installation step lets the user choose which repos Rockpool can access. They can change this later in GitHub settings. For personal repos, the installation happens automatically. For org repos, an org admin may need to approve.

If the user tries to create a workspace from a repo that's not in the app's installation, the server gets a 404 from GitHub's API. The error message should be clear: "Rockpool does not have access to this repository. Install the Rockpool app on {org} to grant access."

Users can manage their installation at: `https://github.com/settings/installations` (personal) or `https://github.com/organizations/{org}/settings/installations` (org).

## Alternatives Considered

### Stay with OAuth App, add `repo` scope

Simple: add `repo` to the scopes array, done. But `repo` is indefensibly overprivileged. It grants write access to every repository the user can access. A cloud IDE that asks for `repo` scope is asking users to trust it with their entire GitHub presence. This is the status quo for legacy tools, but Rockpool should not start here.

### Fine-grained Personal Access Tokens (PATs)

The user generates a PAT in GitHub settings, pastes it into Rockpool. Fine-grained PATs support `Contents: Read` per-repository.

**Why not:** Manual token management is poor UX. The user must create a PAT, scope it to the right repos, paste it in, and rotate it periodically. This is appropriate for CI pipelines, not for interactive tools. The OAuth-like web flow of a GitHub App is strictly better for UX.

### SSH Deploy Keys

Generate an SSH keypair per workspace, add the public key as a deploy key on the target repo.

**Why not:** Deploy keys are per-repository, read-only or read-write, and must be managed via the GitHub API. This requires `admin:public_key` scope on an OAuth token to create deploy keys -- circling back to the same scope problem. Also, each key must be unique per repo (GitHub rejects duplicate public keys), making management complex for users with many repos.

### Embed token in git remote URL

```
git remote set-url origin https://x-access-token:TOKEN@github.com/owner/repo.git
```

**Why not:** Token is stored in `.git/config` (plaintext, committed if `.git` is bundled). Visible in `git remote -v` output. Breaks when the token expires (must update the remote URL). The credential helper approach is strictly better.

### Dual auth: Keep OAuth App for login, add GitHub App for repos

Run both an OAuth App (for authentication) and a GitHub App (for repository access) simultaneously.

**Why not:** Two authorization flows confuse the user ("Why is GitHub asking me twice?"). Two sets of tokens to manage. Two sets of credentials in the environment. A single GitHub App handles both authentication and repository access. The user-access-token flow IS the OAuth flow.

## Open Questions

- [ ] **Should the workspace name be auto-derived from the repo name?** If the user picks `mvhenten/rockpool`, should the workspace name default to `rockpool`? What if that name is taken?
- [ ] **Should we add a `cloning` status to the workspace state machine?** Currently: `creating → running`. With cloning: `creating → cloning → running`. This gives better progress feedback but adds a state.
- [ ] **How to handle large repositories?** A `git clone` of a large repo (e.g., linux kernel) could take minutes. Should we use `--depth 1` (shallow clone) by default? Make it configurable?
- [ ] **How to handle clone failures?** If the repo doesn't exist, or the user lost access between clicking "create" and the worker processing the job, what error state should the workspace enter?
- [ ] **Should we support non-GitHub git hosts?** GitLab, Bitbucket, self-hosted Gitea. This RFC is GitHub-specific. Supporting others would require a provider abstraction layer. Defer?
- [ ] **Token in queue payload security.** The ElasticMQ queue is on localhost, but the token sits in the queue until the worker processes it. Is this acceptable? Alternative: store a session reference and have the worker look up the token.
- [ ] **Should `Contents: Write` be requested from the start?** Read-only cloning is safe but the user can't push from the workspace without write permission. Requesting write from the start is more useful but broader than strictly needed for cloning.

## References

- [GitHub: Scopes for OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)
- [GitHub: Differences between GitHub Apps and OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps)
- [GitHub: Generating a user access token for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
- [GitHub: Generating an installation access token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
- [GitHub: Best practices for creating a GitHub App](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app)
- [GitHub: Choosing permissions for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)
- [GitHub: Security in Codespaces](https://docs.github.com/en/codespaces/reference/security-in-github-codespaces)
- [GitHub: Caching your GitHub credentials in Git](https://docs.github.com/en/get-started/git-basics/caching-your-github-credentials-in-git)
- [GitHub Community: Read-only OAuth scope request](https://github.com/orgs/community/discussions/7891)
- [GitHub REST API: List repositories for the authenticated user](https://docs.github.com/en/rest/repos/repos#list-repositories-for-the-authenticated-user)
