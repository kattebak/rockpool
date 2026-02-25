# EDD-016: GitHub Repository Listing API

| Field   | Value                                                                                                                          |
| ------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Author  | mvhenten                                                                                                                       |
| Status  | Draft                                                                                                                          |
| Created | 2026-02-24                                                                                                                     |
| Updated | 2026-02-24                                                                                                                     |
| Related | [RFC-001](../RFC/001_Workspace_From_GitHub_Repository.md), [EDD-003](003_Caddy_Reverse_Proxy.md), [EDD-007](007_Data_Model.md) |

## Summary

Add a server-side proxy for the GitHub repository listing and search APIs, and extend the Workspace model to persist the source repository. The control plane exposes two endpoints -- `GET /api/github/repos` and `GET /api/github/repos/search` -- that forward requests to GitHub using the session's user access token. The client never sees the GitHub token; all GitHub API interaction goes through the control plane.

A new `Repository` entity stores a snapshot of GitHub repo metadata (full_name, owner, description, default_branch, private). The Workspace model gains a `repositoryId` foreign key and a `description` field. These are set at creation time when a workspace is created from a repository.

This is Phase 2 of [RFC-001](../RFC/001_Workspace_From_GitHub_Repository.md). Phase 1 (GitHub App auth migration) is implemented.

## Prerequisites

- [RFC-001](../RFC/001_Workspace_From_GitHub_Repository.md) -- accepted, Phase 1 implemented
- GitHub App auth with user access tokens and refresh logic (`@rockpool/auth`)
- Session stores `githubAccessToken`, `refreshToken`, `tokenExpiresAt`

## Why Server-Side Proxy

The GitHub access token is stored server-side in the session. It is never exposed to the browser. Proxying through the control plane preserves this:

1. Token stays server-side -- the client sends only its session cookie
2. Token refresh is transparent -- the middleware refreshes expired tokens before forwarding
3. Response shape is controlled -- Rockpool returns a stable subset of GitHub's response, decoupled from GitHub API changes
4. Rate limits are managed centrally -- a single point to add caching or throttling

## API Design

### `GET /api/github/repos`

List repositories the authenticated user has access to. Proxies to GitHub's `GET /user/repos`.

**Query parameters:**

| Parameter  | Type   | Default   | Constraints                                 | Description      |
| ---------- | ------ | --------- | ------------------------------------------- | ---------------- |
| `page`     | int    | 1         | >= 1                                        | Page number      |
| `per_page` | int    | 30        | 1-100                                       | Results per page |
| `sort`     | string | `updated` | `created`, `updated`, `pushed`, `full_name` | Sort field       |

**Response (200):**

```json
{
  "items": [
    {
      "full_name": "mvhenten/rockpool",
      "owner": "mvhenten",
      "description": "Cloud IDE platform",
      "private": false,
      "default_branch": "main",
      "updated_at": "2026-02-24T12:00:00Z"
    }
  ],
  "next_page": 2
}
```

`next_page` is `null` when there are no more pages. Derived from GitHub's `Link` response header.

**Upstream GitHub request:**

```
GET https://api.github.com/user/repos?type=all&sort={sort}&per_page={per_page}&page={page}
Authorization: Bearer {githubAccessToken}
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
```

The `type=all` parameter ensures we get repos the user owns, collaborates on, and has org membership for.

**Response mapping:**

Each GitHub repo object has 100+ fields. We return only what the client needs:

| Rockpool field   | GitHub field         |
| ---------------- | -------------------- |
| `full_name`      | `full_name`          |
| `owner`          | `owner.login`        |
| `owner_type`     | `owner.type`         |
| `owner_avatar`   | `owner.avatar_url`   |
| `description`    | `description`        |
| `private`        | `private`            |
| `default_branch` | `default_branch`     |
| `updated_at`     | `updated_at`         |

### `GET /api/github/repos/search`

Search repositories by name. Proxies to GitHub's `GET /search/repositories`.

**Query parameters:**

| Parameter  | Type   | Default | Constraints | Description      |
| ---------- | ------ | ------- | ----------- | ---------------- |
| `q`        | string | --      | required    | Search query     |
| `page`     | int    | 1       | >= 1        | Page number      |
| `per_page` | int    | 30      | 1-100       | Results per page |

**Response (200):**

```json
{
  "items": [
    {
      "full_name": "mvhenten/rockpool",
      "owner": "mvhenten",
      "description": "Cloud IDE platform",
      "private": false,
      "default_branch": "main",
      "updated_at": "2026-02-24T12:00:00Z"
    }
  ],
  "total_count": 42,
  "next_page": 2
}
```

Same item shape as `/api/github/repos`. The `total_count` field comes from GitHub's search response.

**Upstream GitHub request:**

```
GET https://api.github.com/search/repositories?q={q}&per_page={per_page}&page={page}
Authorization: Bearer {githubAccessToken}
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
```

**Rate limit:** GitHub's search API allows 30 requests/minute (vs 5,000/hour for the REST API). If the upstream returns 403 with `X-RateLimit-Remaining: 0`, return 429 to the client.

## Error Handling

| Condition                           | HTTP Status | Response                                                     |
| ----------------------------------- | ----------- | ------------------------------------------------------------ |
| Not authenticated                   | 401         | `{ "error": "Not authenticated" }`                           |
| GitHub token expired, refresh fails | 401         | `{ "error": "GitHub session expired, please log in again" }` |
| GitHub API returns 403 (rate limit) | 429         | `{ "error": "GitHub rate limit exceeded, try again later" }` |
| GitHub API returns 401 (bad token)  | 401         | `{ "error": "GitHub session expired, please log in again" }` |
| GitHub API returns 5xx              | 502         | `{ "error": "GitHub is unavailable" }`                       |
| Missing `q` parameter on search     | 400         | `{ "error": "Search query is required" }`                    |

GitHub errors are translated to Rockpool errors. The client never sees raw GitHub API responses.

## TypeSpec Models

Define models and endpoints in `typespec/main.tsp`. This gives us generated types, validators, OpenAPI docs, and DB schema for free.

### Repository Entity

A persisted entity that stores a snapshot of GitHub repo metadata at clone time. This is a Rockpool resource, not a mirror — it captures what we knew about the repo when the workspace was created.

```typespec
@table("repository", "rockpool")
model Repository {
  @visibility(Lifecycle.Read)
  @pk
  @uuid("base36", true)
  id: string;

  @visibility(Lifecycle.Create, Lifecycle.Read)
  full_name: string;  // "mvhenten/rockpool"

  @visibility(Lifecycle.Create, Lifecycle.Read)
  owner: string;  // "mvhenten"

  @visibility(Lifecycle.Create, Lifecycle.Read)
  owner_type: "User" | "Organization";

  @visibility(Lifecycle.Create, Lifecycle.Read)
  owner_avatar: string;  // GitHub avatar URL

  @visibility(Lifecycle.Create, Lifecycle.Read)
  description?: string;

  @visibility(Lifecycle.Create, Lifecycle.Read)
  default_branch: string;

  @visibility(Lifecycle.Create, Lifecycle.Read)
  private: boolean;

  @createdAt
  @visibility(Lifecycle.Read)
  createdAt: utcDateTime;
}
```

The `owner`, `owner_type`, and `owner_avatar` fields are stored separately from `full_name` for UI display (org headers, badges, card avatars) without client-side parsing.

### Workspace Model Changes

Add `description` and a foreign key to `Repository` on the existing Workspace model:

```typespec
model Workspace {
  // ... existing fields ...

  @visibility(Lifecycle.Create, Lifecycle.Read)
  description?: string;

  @visibility(Lifecycle.Create, Lifecycle.Read)
  @references(Repository.id)
  repositoryId?: string;
}
```

Both fields are optional — blank workspaces (no repo) remain valid. Both are set at creation time and read-only after that. The `description` is copied from the GitHub repo description at creation time; it can also be set manually for non-repo workspaces.

The `repositoryId` links to the `Repository` entity. Multiple workspaces can reference the same repository (e.g. `rockpool`, `rockpool-2`). When creating a workspace from a repo, the server upserts the `Repository` record (by `full_name`) and sets the foreign key.

### Workspace Name Derivation

When creating a workspace from a repository, the workspace name is derived from the repo name. If `mvhenten/rockpool` is selected, the default name is `rockpool`. If that name already exists, append an incrementing suffix: `rockpool-2`, `rockpool-3`, etc.

The server handles this -- the client suggests the derived name, but the server checks for conflicts and assigns the final name. The existing `name` uniqueness constraint enforces this.

### GitHub API Models

These models represent the proxy response shapes. No `@table` decorator -- they are not persisted.

```typespec
model GitHubRepo {
  full_name: string;
  owner: string;
  owner_type: "User" | "Organization";
  owner_avatar: string;
  description: string | null;
  private: boolean;
  default_branch: string;
  updated_at: utcDateTime;
}

model GitHubRepoListResponse {
  items: GitHubRepo[];
  next_page: int32 | null;
}

model GitHubRepoSearchResponse {
  items: GitHubRepo[];
  total_count: int32;
  next_page: int32 | null;
}

@route("/api/github")
interface GitHub {
  @route("repos")
  @get
  listRepos(
    @query page?: int32,
    @query per_page?: int32,
    @query sort?: "created" | "updated" | "pushed" | "full_name",
  ): GitHubRepoListResponse;

  @route("repos/search")
  @get
  searchRepos(
    @query q: string,
    @query page?: int32,
    @query per_page?: int32,
  ): GitHubRepoSearchResponse;
}
```

After adding to TypeSpec, run `make all` to regenerate `@rockpool/openapi`, `@rockpool/validators`, `@rockpool/enums`, and `@rockpool/db-schema`.

## Implementation

### Step 1: TypeSpec Models and Code Generation

Start here. Add all models (Workspace changes + GitHub API models + GitHub interface) to `typespec/main.tsp`, then run `make all`. This generates types, validators, OpenAPI spec, and the DB schema migration. Everything else builds on top of the generated code.

### Step 2: File Structure

```
typespec/main.tsp                       -- Models and interface (step 1)
packages/server/src/routes/github.ts    -- Express router with both endpoints
packages/server/src/app.ts              -- Mount router at /api/github
```

The router is mounted behind `requireSession` middleware (same as workspace routes), which handles token refresh automatically. The endpoints are defined in the OpenAPI spec, so the existing validator covers them -- no `ignorePaths` change needed.

### Step 3: Router (`packages/server/src/routes/github.ts`)

The router uses generated types from `@rockpool/validators` for request validation and response shaping. Each handler:

1. Reads the session cookie → gets `githubAccessToken`
2. Builds the upstream GitHub URL with query parameters
3. Calls GitHub using `@octokit/request` (already a dependency of `@rockpool/auth`)
4. Maps the response to the Rockpool shape (typed by generated `GitHubRepo`)
5. Parses the `Link` header for `next_page`

### Parsing `next_page` from GitHub's `Link` Header

GitHub returns pagination info in the `Link` response header:

```
Link: <https://api.github.com/user/repos?page=2&per_page=30>; rel="next",
      <https://api.github.com/user/repos?page=5&per_page=30>; rel="last"
```

Parse the `rel="next"` URL and extract the `page` parameter. If no `rel="next"` link exists, `next_page` is `null`.

### Session Token Access

The `requireSession` middleware validates the session and refreshes tokens, but does not expose the session to the request. The GitHub router needs the token. Two options:

**Option A:** The middleware attaches the session to `res.locals.session`. The router reads it from there.

**Option B:** The router calls `authService.getSession(sessionId)` directly.

Option A is cleaner -- the middleware already has the session, no need to fetch it again.

### Mounting in `app.ts`

```typescript
if (deps.authService) {
  const githubRouter = createGitHubRouter(deps.authService);
  app.use("/api/github", requireSession(authService), githubRouter);
}
```

## Decisions

| Question                | Decision   | Rationale                                                                                                                                                                                      |
| ----------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Define in TypeSpec?     | Yes        | API-first: models and endpoints in TypeSpec give us generated types, validators, and OpenAPI docs. The response shape is a Rockpool-defined contract, even if the data originates from GitHub. |
| Use `@octokit/request`? | Yes        | Already a dependency of `@rockpool/auth`. Handles GitHub API headers and auth.                                                                                                                 |
| Cache responses?        | Not for v1 | Adds complexity. GitHub's rate limit (5,000/hr) is generous. Add caching if it becomes a problem.                                                                                              |
| Separate package?       | No         | Two routes in one file, mounted in the server. Not enough to justify a package.                                                                                                                |

## Open Questions

- [ ] Should the search endpoint scope to repos the app has access to, or search all of GitHub? GitHub's search API searches all public repos plus private repos the token has access to. This seems right -- the user can discover public repos to clone.
