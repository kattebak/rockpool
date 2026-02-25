# EDD-017: Workspace Creation Wizard

| Field   | Value                                                                                                             |
| ------- | ----------------------------------------------------------------------------------------------------------------- |
| Author  | mvhenten                                                                                                          |
| Status  | Done                                                                                                              |
| Created | 2026-02-25                                                                                                        |
| Updated | 2026-02-25                                                                                                        |
| Related | [RFC-001](../RFC/001_Workspace_From_GitHub_Repository.md), [EDD-016](016_GitHub_Repository_Listing.md) |

## Summary

Replace the single-page workspace creation form with a multi-step wizard. The wizard guides the user through source selection, optional repository picking, and workspace configuration. Each step is a URL-addressable page with back navigation. State lives in the URL and component state — no modals.

This is the client-side counterpart to EDD-016 (GitHub Repository Listing API).

## Prerequisites

- [EDD-016](016_GitHub_Repository_Listing.md) — GitHub repo listing API endpoints implemented
- Generated SDK with `gitHubListRepos` and `gitHubSearchRepos` functions
- shadcn/ui component library installed in the client

## Wizard Flow

```
/workspaces/new          → Step 1: Choose source (GitHub or blank)
/workspaces/new/repo     → Step 2: Pick a repository (GitHub path only)
/workspaces/new/configure → Step 3: Name, description, image (review & create)
```

Every step has a back button. The browser back button works too because each step is a real route.

### Step 1: Source Selection (`/workspaces/new`)

Two cards the user clicks to choose how to start:

1. **Clone from GitHub** — navigates to `/workspaces/new/repo`
2. **Blank workspace** — navigates to `/workspaces/new/configure`

This replaces the current form at `/workspaces/new`.

### Step 2: Repository Selection (`/workspaces/new/repo`)

A page with a searchable combobox (shadcn `Combobox` component) for picking a GitHub repository.

**Initial load:** Fetches the user's repos via `GET /api/github/repos?sort=updated` and shows them in the dropdown — most recently active repos on top.

**Search:** When the user types in the combobox input, debounce (300ms) and call `GET /api/github/repos/search?q={input}`. Results replace the initial list while typing.

**Combobox items** show:
- Owner avatar (rounded, small — from `owner_avatar`)
- `full_name` (e.g. `mvhenten/rockpool`)
- Description (truncated, muted text)
- Private badge if `private: true`

**On selection:** Navigate to `/workspaces/new/configure` with the selected repo encoded in search params:

```
/workspaces/new/configure?repo=mvhenten/rockpool
```

The configure step reads the `repo` param and looks it up in the cached query data to prefill fields. If the cache is empty (direct navigation), it fetches from `/api/github/repos/search?q={full_name}` to resolve the repo metadata.

**Pagination:** Show a "Load more" button when `next_page` is not null. Appends to the existing list.

### Step 3: Configure (`/workspaces/new/configure`)

The final step before creation. Shows a form with:

| Field         | Source (GitHub path)               | Source (blank path)     | Editable |
| ------------- | ---------------------------------- | ----------------------- | -------- |
| Name          | Derived from repo name (e.g. `rockpool`) | Empty                | Yes      |
| Description   | Copied from repo `description`     | Empty                   | Yes      |
| Image         | `rockpool-workspace`               | `rockpool-workspace`    | No       |
| Repository    | Shows selected repo card with avatar | Not shown             | No (click to go back) |

**Repo info card** (GitHub path only): Displays the selected repo's avatar, full name, description, and a "Change" link that navigates back to `/workspaces/new/repo`.

**Name derivation:** From `full_name`, take the part after `/`. So `mvhenten/rockpool` → `rockpool`. The user can edit it.

**Submit:** Calls `createWorkspace({ name, image, description, repositoryId })`. On success, navigates to `/workspaces/$id`.

## Components

### New: `RepoCombobox`

Searchable combobox for repository selection. Built with shadcn `Combobox` (needs to be added via `npx shadcn@latest add combobox`).

Props:
- `onSelect(repo: GitHubRepo): void`
- `selected?: GitHubRepo`

Manages its own data fetching via React Query hooks.

### New: `RepoCard`

Small display card for a selected repository. Shows avatar, full name, description, private badge. Used in step 3 to confirm the selection.

### New: `SourceCard`

Clickable card for step 1. Icon, title, description. Two instances: GitHub and Blank.

## Routing

Add two new routes to `router.tsx` under the authenticated route:

```typescript
const workspaceNewRepoRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/workspaces/new/repo",
  component: WorkspaceNewRepoPage,
});

const workspaceNewConfigureRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/workspaces/new/configure",
  component: WorkspaceNewConfigurePage,
});
```

The existing `/workspaces/new` route stays but its component changes from the current form to the source selection step.

**Important:** These routes must be registered before the `$id` catch-all route so TanStack Router matches them correctly.

## API Client

Add to `packages/client/src/lib/api.ts`:

```typescript
export async function listGitHubRepos(params?: {
  page?: number;
  per_page?: number;
  sort?: string;
}): Promise<GitHubRepoListResponse> {
  const { data } = await gitHubListRepos({ query: params, throwOnError: true });
  return GitHubRepoListResponseSchema.parse(data);
}

export async function searchGitHubRepos(params: {
  q: string;
  page?: number;
  per_page?: number;
}): Promise<GitHubRepoSearchResponse> {
  const { data } = await gitHubSearchRepos({ query: params, throwOnError: true });
  return GitHubRepoSearchResponseSchema.parse(data);
}
```

Add a new hooks file `packages/client/src/hooks/use-github.ts`:

```typescript
export function useGitHubRepos(params?) // useQuery wrapping listGitHubRepos
export function useGitHubRepoSearch(q: string, params?) // useQuery, enabled when q.length > 0
```

## File Structure

```
packages/client/src/
  routes/
    workspace-new.tsx            -- Step 1: source selection (rewrite existing)
    workspace-new-repo.tsx       -- Step 2: repo picker
    workspace-new-configure.tsx  -- Step 3: name/description/image form
  components/
    repo-combobox.tsx            -- Searchable repo dropdown
    repo-card.tsx                -- Selected repo display card
    source-card.tsx              -- Clickable source option card
    ui/combobox.tsx              -- shadcn combobox (added via CLI)
  hooks/
    use-github.ts                -- React Query hooks for GitHub API
  lib/
    api.ts                       -- Add GitHub API functions
  router.tsx                     -- Add new routes
```

## Implementation Steps

### Step 1: Add shadcn Combobox component ✅

~~Run `npx shadcn@latest add combobox` in the client package.~~

Used `@base-ui/react` Combobox primitive instead of Popover+Command — consistent with the project's existing component library.

### Step 2: API client and hooks ✅

`listGitHubRepos` and `searchGitHubRepos` added to `api.ts`. `use-github.ts` created with `useInfiniteQuery` hooks for pagination.

### Step 3: Build components ✅

`SourceCard`, `RepoCard`, and `RepoCombobox` created. Combobox has 300ms debounce, "Load more" pagination, avatar/badge display.

### Step 4: Build wizard pages ✅

`workspace-new.tsx` rewritten as source selection. `workspace-new-repo.tsx` and `workspace-new-configure.tsx` created.

### Step 5: Update routing ✅

Both new routes registered in `router.tsx` before the `$id` catch-all.

### Step 6: Verify ✅

E2E tests pass (15/15, 4 skipped IDE-loading tests). Blank workspace wizard path fully verified.

### Step 7: Wire repositoryId through the stack ✅

Added after initial implementation. The configure page now passes `repositoryId` (as `full_name`) to `createWorkspace`. The server workspace route resolves `full_name` → upserts a `repository` record via GitHub API → links the DB `id` to the workspace. Changes span DB queries, workspace-service, server route, app deps, and client.

### Step 8: Auth-optional GitHub routes ✅

GitHub routes now work without OAuth. The `/repos` endpoint returns an empty list when no session is available. The `/repos/search` endpoint calls GitHub's public search API without auth (10 req/min rate limit). Repo resolution during workspace creation also falls back to unauthenticated GitHub API for public repos. This enables E2E testing in the CI environment (basic auth only) and supports future non-GitHub auth providers.

### Step 9: GitHub repo picker E2E test ✅

`04-github-workspace.spec.ts` — full wizard path: search `octocat/Hello-World` → select → verify name prefill → create workspace → provision → stop → delete. All 25 E2E tests pass (4 IDE-loading skipped).

## Implementation Notes

### What's working
- All three wizard pages render and navigate correctly (type-check passes)
- Routing with URL-based state (`?repo=owner/name`) works
- API client functions and React Query hooks are wired up
- E2E tests pass — both blank workspace path and GitHub repo picker path
- `repositoryId` and `description` wired through full stack: client → server route → workspace service → DB
- Server auto-upserts `repository` records from GitHub API when `repositoryId` contains `/`
- GitHub API routes work without OAuth (public search, empty user listing)

## Decisions

| Question                     | Decision          | Rationale                                                                 |
| ---------------------------- | ----------------- | ------------------------------------------------------------------------- |
| State in URL or React state? | URL (search params) | Back button works, shareable links, survives refresh                    |
| Combobox or separate page list? | Combobox       | Compact, search-as-you-type, familiar pattern (GitHub's own repo picker) |
| Debounce search?             | Yes, 300ms        | Avoids hammering the search API (30 req/min rate limit)                  |
| Pagination style?            | "Load more" button | Simpler than infinite scroll, works well in a dropdown                   |
| Pass repo data between steps? | Search params (full_name) + query cache | Minimal URL, fast if cached, resilient if not |
