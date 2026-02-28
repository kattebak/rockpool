# Testing

## Unit Tests

```bash
npm test
```

Runs `npm run test --workspaces --if-present` across all packages.

## E2E Profiles

Three profiles controlled by `E2E_PROFILE`:

| Profile | Port | Runtime | VM tests | Use case |
| --- | --- | --- | --- | --- |
| **development** | 8080 | tart | n/a | `npm start` / `npm stop`. User clicks around, devtools debugging. Not Playwright. |
| **test** | 9080 | tart | yes | Headless Playwright with real VMs. Separate DB/ports — does not interfere with development. |
| **ci** | 9080 | stub | skipped | Same as test but without VMs. For GitHub Actions. |
| **production** | 10080 | auto | n/a | `npm run start:production` / `npm run stop:production`. Pre-built client, no watchers, LAN-accessible. |

Config for test/ci lives in `test.env`. Config for production lives in `production.env`. Both test profiles auto-start the server stack via Playwright `globalSetup` using `ecosystem.test.config.cjs`.

### Commands

```bash
npm run test:e2e:headless  # test profile — real VMs, headless
npm run test:e2e:ci        # ci profile — stub runtime, VM tests skipped
```

### VM-dependent tests

These skip when `E2E_PROFILE=ci`:

- `03-ide-loading.spec.ts`
- `05-clone-verification.spec.ts`

Everything else works with the stub runtime.

## Verification

After code changes:

```bash
npm run fix -- --unsafe    # formatter/linter
npm run test:e2e:headless  # E2E with real VMs
```
