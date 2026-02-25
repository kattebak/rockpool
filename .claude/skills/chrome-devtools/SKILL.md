---
name: chrome-devtools
description: Browser automation and debugging with Chrome DevTools Protocol. Use for testing web apps, taking screenshots, analyzing performance, inspecting network requests, and automating browser interactions.
---

# Chrome DevTools Protocol

Browser automation and debugging using Chrome DevTools Protocol (CDP) directly.

## Prerequisites

Chrome must be running with remote debugging enabled. **Always launch it automatically** before using any DevTools commands:

```bash
.claude/skills/chrome-devtools/chrome.sh launch &
```

Then wait a few seconds and verify the connection:

```bash
sleep 3 && curl -s http://localhost:9222/json/version | head -5
```

If Chrome is already running (curl succeeds), skip launching.

This opens Chrome with:

- Remote debugging on port 9222
- Separate user profile (won't affect your main Chrome)
- Auto-open behavior disabled

**Keep this Chrome window open** while using DevTools.

## CLI Tool

Use `.claude/skills/chrome-devtools/chrome.sh` for all CDP operations. The co-located `chrome-cdp.mjs` uses Node.js built-in WebSocket (no external deps).

```bash
.claude/skills/chrome-devtools/chrome.sh list                          # List open tabs
.claude/skills/chrome-devtools/chrome.sh navigate <url>                # Navigate to a URL
.claude/skills/chrome-devtools/chrome.sh screenshot [path]             # Screenshot (default: /tmp/screenshot.png)
.claude/skills/chrome-devtools/chrome.sh eval <expression>             # Run JS in the page
.claude/skills/chrome-devtools/chrome.sh reload                        # Reload current page
.claude/skills/chrome-devtools/chrome.sh version                       # Browser version info
```

Environment variables:
- `CDP_PORT=9222` — remote debugging port (default: 9222)
- `CDP_TAB=0` — tab index to target (default: 0)

## Common CDP Methods

### Navigation & Pages

| Method | Purpose |
| --- | --- |
| `Page.navigate` | Go to a URL (`{url}`) |
| `Page.reload` | Reload the page |
| `Target.createTarget` | Open new tab (`{url}`) |
| `Target.closeTarget` | Close a tab (`{targetId}`) |

### Screenshots & DOM

| Method | Purpose |
| --- | --- |
| `Page.captureScreenshot` | Capture screenshot (`{format: 'png'}`) |
| `DOM.getDocument` | Get the DOM tree |
| `Runtime.evaluate` | Run JavaScript in page (`{expression}`) |

### Input

| Method | Purpose |
| --- | --- |
| `Input.dispatchMouseEvent` | Click, hover, drag |
| `Input.dispatchKeyEvent` | Keyboard input |

### Network & Console

| Method | Purpose |
| --- | --- |
| `Network.enable` | Start capturing network events |
| `Console.enable` | Start capturing console messages |
| `Network.getResponseBody` | Get response body (`{requestId}`) |

### Performance

| Method | Purpose |
| --- | --- |
| `Tracing.start` | Start performance trace |
| `Tracing.end` | Stop trace |
| `Performance.getMetrics` | Get runtime metrics |

### Emulation

| Method | Purpose |
| --- | --- |
| `Emulation.setDeviceMetricsOverride` | Set viewport/device |
| `Emulation.setUserAgentOverride` | Override user agent |

## Common Workflows

### Test a Local Web App

1. Navigate to localhost URL with `Page.navigate`
2. Take a screenshot with `Page.captureScreenshot`
3. Fill inputs with `Runtime.evaluate` (set `.value` and dispatch `input` event)
4. Click buttons with `Runtime.evaluate` (`.click()`)
5. Wait with `setTimeout`, then screenshot again

### Debug Network Issues

1. Enable network capture with `Network.enable`
2. Navigate to the page
3. Collect `Network.requestWillBeSent` / `Network.responseReceived` events
4. Get response bodies with `Network.getResponseBody`

### Responsive Design Testing

1. Set viewport with `Emulation.setDeviceMetricsOverride`
2. Navigate and screenshot at different sizes

## Troubleshooting

### "Cannot connect to browser"

Chrome isn't running with remote debugging. Run:

```bash
.claude/skills/chrome-devtools/chrome.sh launch
```

### Empty response from `/json/list`

No tabs are open. Use `Target.createTarget` to open one, or navigate the blank tab.

### Page not loading in time for screenshot

Increase the `setTimeout` delay before `Page.captureScreenshot`. For SPAs that do client-side rendering, 3-5 seconds may be needed.

## Tips

- Use `Runtime.evaluate` as a Swiss Army knife — you can query DOM, fill forms, click buttons, read text, all via JS expressions
- Screenshots are base64-encoded in the CDP response; decode with `Buffer.from(data, 'base64')`
- CDP docs: https://chromedevtools.github.io/devtools-protocol/
