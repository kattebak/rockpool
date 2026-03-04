# Testing

## Unit Tests

```bash
npm test
```

Runs `npm run test --workspaces --if-present` across all packages.

## E2E Profiles

A single `compose.yaml` serves both profiles. The test profile uses different port numbers passed via env vars to avoid colliding with development:

| Profile | Ports | Use case |
| --- | --- | --- |
| **development** | 8080/8081/8082 (defaults) | `npm run start:dev` / `npm run stop:dev`. Manual testing, devtools. |
| **test** | 9080/9081/9082 | `npm run test:e2e:headless`. Headless Playwright with real containers. |

The test profile auto-starts the server stack via Playwright `globalSetup` using `podman compose`.

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
