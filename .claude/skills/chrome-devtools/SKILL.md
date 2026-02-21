---
name: chrome-devtools
description: Browser automation and debugging with Chrome DevTools MCP. Use for testing web apps, taking screenshots, analyzing performance, inspecting network requests, and automating browser interactions.
allowed-tools: Bash(npm:*), mcp__chrome-devtools__*
---

# Chrome DevTools MCP

Browser automation and debugging using Chrome DevTools Protocol.

## Prerequisites

Chrome must be running with remote debugging enabled. **Always launch it automatically** before using any DevTools tools:

```bash
npm run chrome:debug &
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

**Keep this Chrome window open** while using the DevTools MCP tools.

## Available Tools

### Navigation & Pages

| Tool            | Purpose                     |
| --------------- | --------------------------- |
| `navigate_page` | Go to a URL                 |
| `new_page`      | Open new tab                |
| `close_page`    | Close a tab                 |
| `list_pages`    | List open tabs              |
| `select_page`   | Switch to a tab             |
| `wait_for`      | Wait for element/navigation |

### Input & Interaction

| Tool            | Purpose                      |
| --------------- | ---------------------------- |
| `click`         | Click an element             |
| `fill`          | Fill a single input field    |
| `fill_form`     | Fill multiple form fields    |
| `hover`         | Hover over element           |
| `press_key`     | Press keyboard key           |
| `drag`          | Drag and drop                |
| `upload_file`   | Upload file to input         |
| `handle_dialog` | Accept/dismiss alert/confirm |

### Debugging & Inspection

| Tool                    | Purpose                      |
| ----------------------- | ---------------------------- |
| `take_screenshot`       | Capture page screenshot      |
| `take_snapshot`         | Get page HTML snapshot       |
| `evaluate_script`       | Run JavaScript in page       |
| `list_console_messages` | Get console output           |
| `get_console_message`   | Get specific console message |
| `list_network_requests` | List HTTP requests           |
| `get_network_request`   | Get request details          |

### Performance

| Tool                          | Purpose               |
| ----------------------------- | --------------------- |
| `performance_start_trace`     | Start recording trace |
| `performance_stop_trace`      | Stop and save trace   |
| `performance_analyze_insight` | Analyze trace data    |

### Display

| Tool          | Purpose                       |
| ------------- | ----------------------------- |
| `emulate`     | Emulate device (mobile, etc.) |
| `resize_page` | Change viewport size          |

## Common Workflows

### Test a Local Web App

```
1. Navigate to localhost URL
2. Take a screenshot
3. Fill the login form with test credentials
4. Click the submit button
5. Wait for navigation
6. Take another screenshot to verify
```

### Debug Network Issues

```
1. Navigate to the page
2. List network requests
3. Get details for failed requests
4. Check console messages for errors
```

### Performance Analysis

```
1. Start a performance trace
2. Navigate to the page
3. Interact with the page
4. Stop the trace
5. Analyze insights for bottlenecks
```

### Responsive Design Testing

```
1. Navigate to the page
2. Emulate iPhone 14 Pro
3. Take a screenshot
4. Resize to tablet dimensions
5. Take another screenshot
```

## Troubleshooting

### "Cannot connect to browser"

Chrome isn't running with remote debugging. Run:

```bash
npm run chrome:debug
```

### "Page not found" or stale references

Pages can become stale. Use `list_pages` to get current page IDs, then `select_page` to switch.

### Modal dialogs blocking

Use `handle_dialog` to accept or dismiss alerts/confirms/prompts.

## Tips

- Use `wait_for` after navigation or clicks that trigger page changes
- Use CSS selectors for `click`, `fill`, etc. (e.g., `#submit-btn`, `.login-form input[name="email"]`)
- Screenshots are saved to the current directory by default
- Performance traces can be opened in Chrome DevTools (chrome://tracing)
