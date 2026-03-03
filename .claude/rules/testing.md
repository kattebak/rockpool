# Testing

## Unit Tests

```bash
npm test
```

Runs `npm run test --workspaces --if-present` across all packages.

## E2E Profiles

Two profiles controlled by `E2E_PROFILE` and `ENV_FILE`:

| Profile | Port | Runtime | Use case |
| --- | --- | --- | --- |
| **development** | 8080 | podman | `npm start` / `npm stop`. User clicks around, devtools debugging. Not Playwright. |
| **test** | 9080 | podman | Headless Playwright with real containers. Separate DB/ports — does not interfere with development. |

Config for test lives in `test.env`. The test profile auto-starts the server stack via Playwright `globalSetup` using `podman compose`.

### Commands

```bash
npm run test:e2e:headless  # test profile — headless Playwright
```

## Verification

After code changes:

```bash
npm run fix -- --unsafe    # formatter/linter
npm run test:e2e:headless  # E2E tests
```
