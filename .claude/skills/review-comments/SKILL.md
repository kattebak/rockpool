---
name: review-comments
description: Fetch and implement GitHub PR review comments for the current branch. Use when the user wants to see or implement PR review feedback.
---

# Review Comments Skill

Fetch unresolved review comments from the GitHub PR associated with the current branch, then analyze and implement them.

## Workflow

### Step 1: Find the PR for the Current Branch

```bash
git branch --show-current
gh pr list --head <BRANCH_NAME> --json number,title,url,state --limit 1
```

If no PR is found, check if a PR number was provided as an argument. If neither works, report the error and stop.

### Step 2: Detect Repository Owner and Name

```bash
gh repo view --json owner,name --jq '"\(.owner.login)/\(.name)"'
```

Use this for all subsequent API calls instead of hardcoded values.

### Step 3: Fetch Review Threads with Resolution Status

```bash
gh api graphql -f query='
  query($owner: String!, $repo: String!, $pr: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $pr) {
        reviewThreads(first: 100) {
          nodes {
            isResolved
            comments(first: 10) {
              nodes {
                body
                path
                line
                startLine
                author { login }
                createdAt
              }
            }
          }
        }
      }
    }
  }
' -f owner=<OWNER> -f repo=<REPO> -F pr=<PR_NUMBER>
```

### Step 4: Filter to Unresolved Comments

From the GraphQL response, filter review threads where `isResolved` is `false`.

Focus on the first comment in each thread (the top-level review comment) that is:
- Not from the PR author (self-comments are usually notes, not actionable)
- Actionable (contains suggestions, requests, or corrections)

Skip comments that are:
- Approvals or "LGTM" style comments
- Pure questions that were answered

### Step 5: Present Comment Summary

Before implementing, present a structured summary:

```
Found X review comments on PR #N: "PR Title"

1. [file.ts:42] @reviewer - "Comment text summary..."
   Type: code-style | refactoring | bug-fix | suggestion

2. [other-file.ts:15-20] @reviewer - "Comment text summary..."
   Type: code-style | refactoring | bug-fix | suggestion
```

### Step 6: Implement Comments

For each actionable comment:
1. Read the affected file at the commented line range
2. Understand the context and surrounding code
3. Implement the requested change following project standards
4. Mark progress

### Step 7: Check CI Status and Test Failures

```bash
gh pr view <PR_NUMBER> --json statusCheckRollup --jq '.statusCheckRollup[] | "\(.name): \(.conclusion // .state)"'
```

If there are test failures, fetch logs:

```bash
gh run list --branch <BRANCH_NAME> --json name,status,conclusion,databaseId --limit 5
gh run view <DATABASE_ID> --log-failed 2>&1 | head -n 200
```

### Step 8: Verify Changes

After implementing all changes:

```bash
npm run fix
npm run lint
npm run check
npm test
```

### Step 9: Summary Report

Provide a final summary:
- Comments implemented (with file:line references)
- Comments skipped (with reason)
- Comments needing clarification
- CI test failures fixed
- Verification results
