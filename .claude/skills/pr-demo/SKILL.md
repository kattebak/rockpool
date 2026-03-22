# PR Demo

Capture screenshots or record videos and attach them to pull requests using a detached `assets` branch.

## When to Use

Use this skill when creating or updating a pull request that includes UI changes. Visual demos should be captured automatically as part of the PR workflow whenever frontend components are added or modified.

The demo must be truly end-to-end: capture the full user journey from empty dashboard through workspace creation, IDE loading, and back to dashboard. Partial demos (missing IDE, showing errors) are not acceptable.

## Choosing a Format

Pick ONE format per PR — not both.

**Use screenshots when** the change is about **how something looks**:
- New layout, restyled component, color/typography changes
- Before/after comparisons
- Static UI additions (new page, new panel)

**Use video when** the change is about **how something behaves**:
- Multi-step flows (compose, save, appears in drafts)
- State transitions, auto-save, loading states
- Animations, transitions, interactive feedback
- Navigation flows

The signal is in the diff: touches event handlers, state management, forms, navigation → video. Touches styles, layout, static rendering → screenshot.

## How It Works

Assets are stored on an orphan `assets` branch — a detached branch with no history connection to `main`. This keeps binary files out of the main branch while making them accessible via raw.githubusercontent.com URLs.

```
assets branch (orphan)
└── pr-<number>/
    ├── feature-overview.png
    ├── compose-flow.webm
    └── ...
```

## Prerequisites

- Chromium installed (`chromium-browser`)
- Playwright available in devDependencies
- Local dev stack running (use `/local-dev` skill to start)

## Step-by-Step Recipe

### 1. Start the Local Dev Stack

```bash
npm start
```

Wait for all services (Caddy, server, worker, ElasticMQ, client) to be online. Verify:

```bash
# Check services are running
npm run logs -- --tail 10 --no-follow

# Check the UI is accessible
curl -sf http://localhost:8080/ -o /dev/null && echo "UI is up"
```

### 2a. Take Screenshots with Playwright

Create a temporary `.mjs` script **inside the project directory** (so Playwright resolves):

```javascript
// take-screenshots.mjs (in project root, delete after use)
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

// Navigate and capture
await page.goto("http://localhost:5173/...", { waitUntil: "networkidle", timeout: 15000 }).catch(() => {});
await page.waitForTimeout(3000);
await page.screenshot({ path: "/tmp/ss-feature-name.png" });

// Interact (click, fill, keyboard) and capture more states
await page.click("button.some-action");
await page.waitForTimeout(1000);
await page.screenshot({ path: "/tmp/ss-after-action.png" });

await browser.close();
```

### 2b. Record Video with Playwright

For behavioral changes, use Playwright's built-in `recordVideo` on the browser context:

```javascript
// record-demo.mjs (in project root, delete after use)
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: "/tmp/demos/", size: { width: 1440, height: 900 } }
});
const page = await context.newPage();

// Automate the flow — act like a user
await page.goto("http://localhost:5173/...", { waitUntil: "networkidle", timeout: 15000 }).catch(() => {});
await page.waitForTimeout(2000);

// Step through the interaction
await page.click("button.compose");
await page.waitForTimeout(1000);
await page.fill("input[name=to]", "recipient@example.com");
await page.waitForTimeout(500);
await page.fill("input[name=subject]", "Demo subject");
await page.waitForTimeout(1000);

// Wait a moment so the viewer can see the final state
await page.waitForTimeout(2000);

// Close context to finalize and save the video
await context.close();
const videoPath = await page.video().path();
console.log("Video saved to:", videoPath);

await browser.close();
```

Run it:

```bash
node record-demo.mjs
```

**Important:**
- The script MUST be an `.mjs` file in the project root (for Playwright module resolution)
- Output is WebM format (no ffmpeg needed)
- The video is only saved when `context.close()` is called
- Call `page.video().path()` after closing the context to get the file path
- Use `page.click()` for interactions — keyboard shortcuts may not fire in headless
- Use `waitForTimeout` after navigation/interactions (1-3 seconds) so viewers can follow the flow
- Delete the script after use — don't commit it

### 3. Verify Assets

Read each screenshot or play each video to verify it captured the right content before uploading. Every screenshot must be inspected for errors before proceeding:

- Check for error banners, red status badges, or failure messages
- Verify the workspace reached "Running" state with a green badge
- Verify the IDE fully loaded (monaco editor visible, not a loading spinner)
- If any screenshot shows errors, re-capture — do not upload broken demos

### 4. Push to the Assets Branch

**IMPORTANT: Never checkout the orphan `assets` branch in the main worktree.** Doing so wipes all tracked files (including `.claude/settings.json`), breaking the working tree. Always use a temporary git worktree.

```bash
# Create a temporary worktree for the assets branch
git worktree add /tmp/assets-wt assets 2>/dev/null || {
  # First time: create the orphan branch
  git worktree add --orphan -b assets /tmp/assets-wt
}

# Copy assets into the worktree
mkdir -p /tmp/assets-wt/pr-<number>
cp /tmp/ss-*.png /tmp/assets-wt/pr-<number>/ 2>/dev/null
cp /tmp/demos/*.webm /tmp/assets-wt/pr-<number>/ 2>/dev/null

# Commit and push from the worktree
cd /tmp/assets-wt
git add pr-<number>/
git commit -m "Add PR #<number> demo assets"
git push origin assets
cd -

# Clean up the worktree
git worktree remove /tmp/assets-wt
```

### 5. Reference in PR Comment

**For screenshots**, use the standard image syntax:

```markdown
![Description](https://github.com/<owner>/<repo>/blob/assets/pr-<number>/screenshot-name.png?raw=true)
```

**For videos**, GitHub does NOT support inline video playback from repo URLs. The syntax `![alt](video.webm?raw=true)` shows a broken thumbnail. Use a clickable thumbnail that links to the raw video instead:

```markdown
[![Demo video](https://github.com/<owner>/<repo>/blob/assets/pr-<number>/thumbnail.png?raw=true)](https://github.com/<owner>/<repo>/blob/assets/pr-<number>/demo.webm?raw=true)
```

For this repo:

```markdown
![Feature Screenshot](https://github.com/kattebak/rockpool/blob/assets/pr-<number>/feature-name.png?raw=true)
[![Demo video](https://github.com/kattebak/rockpool/blob/assets/pr-<number>/thumbnail.png?raw=true)](https://github.com/kattebak/rockpool/blob/assets/pr-<number>/demo.webm?raw=true)
```

**Tip:** For the best native playback experience, drag-drop the video file directly into a PR comment on github.com. GitHub will host the video and provide inline playback controls. The repo-hosted approach above only works as a clickable link to download/view the video.

**Important:** Use the `blob/...?raw=true` format, NOT `raw.githubusercontent.com`. The blob format works for both private and public repos when the viewer is authenticated. The `raw.githubusercontent.com` format returns 404 for private repos.

### 6. Post to PR

```bash
gh pr comment <number> --body "$(cat <<'EOF'
## Demo

### Feature Name

![Screenshot](https://github.com/kattebak/rockpool/blob/assets/pr-<number>/screenshot.png?raw=true)

[![Demo video](https://github.com/kattebak/rockpool/blob/assets/pr-<number>/thumbnail.png?raw=true)](https://github.com/kattebak/rockpool/blob/assets/pr-<number>/demo.webm?raw=true)
EOF
)"
```

## Naming Conventions

| Pattern | Example | Use |
|---------|---------|-----|
| `pr-<number>/` | `pr-11/` | Directory per PR |
| `<feature>-<state>.png` | `compose-new.png` | Screenshot: feature + state |
| `<feature>-<state>.webm` | `compose-flow.webm` | Video: feature + flow name |
| `<page>-<view>.png` | `settings-smtp.png` | Screenshot: page + view |
| `before.png` / `after.png` | | For comparison screenshots |

## Demo Checklist

Before posting, verify every item:

- [ ] Empty dashboard screenshot — clean, no stale data
- [ ] Workspace creation flow — all steps captured
- [ ] Workspace detail — Running status, green badge, no errors
- [ ] IDE loaded — monaco editor visible, activity bar present
- [ ] Dashboard with workspace — workspace card visible
- [ ] Video plays or links correctly in PR
- [ ] All screenshots inspected for errors before upload

## Troubleshooting

### Keyboard shortcuts not firing in headless

Use `page.click()` on buttons instead of `page.keyboard.press()`. Headless Chromium may not route keyboard events to the correct element without explicit focus.

### Playwright can't find module

The screenshot/recording script must be in the project root directory (not `/tmp/`) so that `import { chromium } from "playwright"` resolves via `node_modules/`.

### Assets branch already exists

Just `git checkout assets` — no need to create it again. Add new `pr-<number>/` directories alongside existing ones.

### Video file is empty or missing

The video is only finalized when `context.close()` is called. Always close the context before accessing the video path. If the context crashes, no video file is produced.

## Cleanup

Old PR asset directories can be deleted from the assets branch when PRs are merged or closed. The branch itself should persist.
