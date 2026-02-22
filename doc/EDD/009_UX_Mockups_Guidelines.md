# EDD: UX Mockups and Guidelines

| Field   | Value          |
| ------- | -------------- |
| Author  | GitHub Copilot |
| Status  | Draft          |
| Created | 2026-02-22     |
| Updated | 2026-02-22     |

## Summary

This EDD specifies the UX for the Tidepool web client (workspace management SPA). It provides information architecture, interaction flows, mockups, and UX guidelines grounded in common patterns from Material Design, Apple HIG, Microsoft Fluent, and GitHub Primer.

## Prerequisites

- [ADR 010: React shadcn TanStack SPA](../ADR/010-react-shadcn-tanstack-spa.md)
- [EDD 001: Architecture Overview](001_Architecture_Overview.md)
- [EDD 007: Data Model](007_Data_Model.md)
- [EDD 008: Package Structure](008_Package_Structure.md)
- [EDD 003: Caddy Reverse Proxy](003_Caddy_Reverse_Proxy.md)

## Goals

- Make workspace creation and access fast and obvious for a single developer.
- Provide clear, trustworthy status and errors for VM lifecycle operations.
- Ensure the UI works well on laptop and tablet widths without mobile-specific features.
- Establish UX guidelines that are consistent and accessible across the client.

## Non-Goals

- Redesigning the IDE UI (code-server is out of scope).
- Implementing multi-user permissions or team management.
- Defining the full design system implementation details (tokens, code). This EDD defines usage guidelines and intent.
- Supporting multiple workspace templates at launch; start with a single default image.

## Users and Use Cases

### Primary User

- A single developer who starts, stops, and enters workspaces daily.

### Key Jobs

- Create a new workspace from a base image or template.
- See workspace status at a glance (starting, running, stopped, error).
- Open the IDE quickly.
- Register and view forwarded ports.
- Delete or stop a workspace safely.

## Information Architecture

- /app/workspaces
  - Workspace list (empty, populated, filtered)
  - Create workspace modal
- /app/workspaces/:id
  - Workspace detail and actions
  - Port forwarding management
  - Activity log (optional, low fidelity)
- /app/settings
  - Basic preferences (future)

Navigation is a top bar with a left-aligned brand and a small nav list. Primary actions live in a persistent top-right button.

## UX Principles (Common Guidelines)

- Clarity over density: readable labels, short sentences, avoid jargon.
- Consistent patterns: one primary button style, one primary action per page.
- Immediate feedback: visible status changes, inline progress, and deterministic empty states.
- Progressive disclosure: hide advanced options behind a reveal or expandable panel.
- Familiar controls: form fields, tables, and modals behave like common web apps.
- Accessibility by default: high contrast, keyboard navigation, clear focus states.

## Layout and Visual Guidelines

### Layout

- Max content width: 1200px
- Page padding: 24px
- Vertical rhythm: 8px base spacing scale (4, 8, 12, 16, 24, 32, 48)
- Grid: 12 columns, 24px gutters

### Typography

- Use a humanist sans-serif (e.g., Source Sans 3, IBM Plex Sans).
- Heading scale: 28 / 22 / 18 / 16
- Body: 14 or 15
- Monospace: UI for code or ports (e.g., IBM Plex Mono).

### Color and Contrast

- Light theme only (for now).
- Use a cool blue or teal accent, avoid purple.
- Minimum contrast ratio: 4.5:1 for text, 3:1 for UI components.

Suggested palette (can be refined in implementation):

- Background: #F7F8FA
- Surface: #FFFFFF
- Border: #E2E6EA
- Text: #182026
- Muted text: #5C6B77
- Accent: #137CBD
- Success: #0F9960
- Warning: #D9822B
- Danger: #C23030

### Motion

- Use short, purposeful animations only for status changes and modal transitions.
- Duration: 150-250ms, ease-out.
- Avoid idle animations.

## Core Components

### App Shell

- Top bar with Tidepool brand on left.
- Nav links: Workspaces, Settings.
- Primary action button on right: New Workspace.

### Workspace List

- Table or card list with status pill, last updated, and actions.
- Inline status indicator (color + label) is always visible.
- Secondary action menu per row for stop/delete.

### Workspace Detail

- Header with name, status, and primary actions (Open IDE, Stop, Delete).
- Details panel: image, resources, created date, last updated.
- Ports panel: list, add new port, remove port.

### Forms

- Labels above inputs.
- Inline validation, avoid toasts for form errors.
- Only one primary action in modal footer.

### Empty States

- Clear explanation and single action.
- Show a lightweight illustration only if it does not compete with CTA.

## Component Inventory (shadcn/ui)

Keep the UI minimal and rely on shadcn built-in components with default variants. Avoid custom components unless a gap is confirmed.

### Navigation and Structure

- `NavigationMenu` for top nav
- `Breadcrumb` for workspace detail context
- `Separator` for page section dividers
- `Card` for list rows and detail panels

### Data Display

- `Table` for workspace list
- `Badge` for status
- `Tooltip` for icon-only actions

### Actions and Menus

- `Button` (primary, secondary, destructive)
- `DropdownMenu` for row actions
- `Dialog` for create/stop/delete confirmations

### Forms

- `Form` with `Input`, `Select`, `Switch`
- `Popover` + `Command` for image selection if needed
- `Textarea` only for optional notes

### Feedback

- `Toast` for background success and non-blocking errors
- `Alert` for inline error blocks
- `Skeleton` for list loading
- `Progress` for create/start status

## Component States

### Workspace Status Badge

- Starting: neutral badge, spinner icon
- Running: success badge
- Stopped: muted badge
- Error: destructive badge

### Buttons

- Primary: Create workspace, Open IDE
- Secondary: Stop, Start
- Destructive: Delete
- Disabled: any action when status is transitioning (Starting, Stopping)

### Forms

- Required fields show inline error text on blur and on submit
- Submit button shows loading state during API call
- Errors stay inline; toast only for global failures

### Lists

- Empty list shows empty state card with CTA
- Loading shows 5-row skeleton
- Error state shows alert with retry

## Mockups (Low Fidelity)

### Workspace List (Empty)

```
+--------------------------------------------------------------------------------+
| Tidepool                                    Workspaces   Settings   [New]     |
+--------------------------------------------------------------------------------+
|                                                                                |
|  No workspaces yet                                                             |
|  Create your first workspace to start coding in minutes.                        |
|                                                                                |
|  [Create workspace]                                                            |
|                                                                                |
+--------------------------------------------------------------------------------+
```

### Workspace List (Populated)

```
+--------------------------------------------------------------------------------+
| Tidepool                                    Workspaces   Settings   [New]     |
+--------------------------------------------------------------------------------+
| Search: [ name or image ]                                                      |
|                                                                                |
| Name        Status     Image           Updated          Actions                |
| ----------  ---------  --------------  ---------------  --------------------- |
| demo        Running    debian:latest   2 min ago        [Open] [Stop] [More]   |
| api-test    Stopped    debian:12       Yesterday        [Open] [Start] [More]  |
| broken      Error      debian:latest   5 min ago        [View error] [More]    |
+--------------------------------------------------------------------------------+
```

### Create Workspace (Modal)

```
+---------------------------------- Create Workspace ----------------------------+
| Name*            [ demo-2                 ]                                     |
| Image            [ default (read-only) ]                                        |
| CPU              [ 2 v ]    Memory [ 4 GB v ]                                   |
|                                                                                 |
| Advanced                                                                    v   |
|   (collapsed by default)                                                       |
|                                                                                 |
|                      [Cancel]                         [Create workspace]       |
+--------------------------------------------------------------------------------+
```

### Workspace Detail (Running)

```
+--------------------------------------------------------------------------------+
| Tidepool                                    Workspaces   Settings   [New]     |
+--------------------------------------------------------------------------------+
| demo                                                                    Running |
| [Open IDE]  [Stop]  [Delete]                                                     |
|--------------------------------------------------------------------------------|
| Details                                 | Ports                                 |
| Image: debian:latest                    | 3000  app-server   [Open] [Remove]    |
| CPU: 2   Memory: 4 GB                   | 5173  ui-preview   [Open] [Remove]    |
| Created: 2026-02-22 09:10               | [Add port]                             |
| Updated: 2 min ago                      |                                       |
|--------------------------------------------------------------------------------|
| Recent activity                                                              v  |
| - Workspace started                                                           |
| - Port 3000 registered                                                        |
+--------------------------------------------------------------------------------+
```

### Stop Workspace (Confirm)

```
+------------------------------- Stop Workspace --------------------------------+
| Stopping a workspace disconnects the IDE and any forwarded ports.              |
|                                                                               |
| [Cancel]                                                  [Stop workspace]     |
+-------------------------------------------------------------------------------+
```

### Error State (Inline)

```
+--------------------------------------------------------------------------------+
| demo                                                                    Error   |
| [Retry start]  [Delete]                                                        |
|--------------------------------------------------------------------------------|
| Error details                                                                   |
| Failed to start VM. Check runtime logs and image availability.                  |
+--------------------------------------------------------------------------------+
```

## Interaction Flows

### Create and Enter Workspace

1. User clicks New Workspace.
2. Modal opens with name and image fields.
3. On submit, the list shows a new row with status Starting.
4. When status is Running, the row shows Open and the header shows Open IDE.

### Register Port

1. User opens workspace detail.
2. Clicks Add port.
3. Enters port and optional label.
4. Port appears in list with Open and Remove actions.

### Stop and Delete

- Stop requires a confirmation modal.
- Delete requires typing the workspace name to confirm.

## Content and Copy Guidelines

- Use short sentences and direct verbs.
- Avoid internal jargon (use "workspace" instead of "VM").
- Errors should explain the next step when possible.
- Use consistent labels: Create workspace, Open IDE, Stop, Delete.

## Accessibility Requirements

- Keyboard navigation for all interactive elements.
- Visible focus ring with 2px thickness and sufficient contrast.
- Color is never the only indicator (status text always present).
- Support reduced motion settings.
- Meet WCAG 2.2 AA for contrast.

## Analytics (Optional)

- Workspace create started/completed
- Workspace open
- Port added/removed
- Error state viewed

## Risks and Open Questions

- Should we support dark mode before release?
- Are we exposing enough runtime diagnostics for user-facing errors?
- Do we need a lightweight activity log now or later?

## Appendix: Guideline Sources

- Material Design (Google)
- Apple Human Interface Guidelines
- Microsoft Fluent Design
- GitHub Primer
- GOV.UK Design System (content and form clarity)
