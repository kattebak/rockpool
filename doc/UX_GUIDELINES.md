# UX Guidelines

Frontend development guidelines based on the [Cloudscape Design System](https://cloudscape.design/) patterns. Use this document to make consistent, accessible, and user-friendly interface decisions.

---

## Table of Contents

- [Visual Foundation](#visual-foundation)
- [Layout](#layout)
- [Navigation](#navigation)
- [Forms & Validation](#forms--validation)
- [Selection Controls](#selection-controls)
- [Actions](#actions)
- [Resource Management](#resource-management)
- [Feedback & Loading](#feedback--loading)
- [Error Handling](#error-handling)
- [Empty States](#empty-states)
- [Disabled & Read-Only States](#disabled--read-only-states)
- [Unsaved Changes](#unsaved-changes)
- [Help System](#help-system)
- [Drag and Drop](#drag-and-drop)
- [Dashboard Design](#dashboard-design)
- [Writing Guidelines](#writing-guidelines)
- [Accessibility](#accessibility)

---

## Visual Foundation

### Spacing

Use a **4px base unit** with consistent increments. Spacing conveys meaning:

- **Proximity conveys relationship** — elements positioned closely appear connected; greater distance suggests distinction
- **Larger spacing increases prominence** — use it to draw attention to important elements
- **White space is a design element** — it creates contrast, establishes sections, and provides breathing room

| Token | Size | Use |
|-------|------|-----|
| xxx-small | 2px | Header-description gaps |
| xx-small | 4px | Form field label-control spacing |
| x-small | 8px | Button groups, token spacing |
| small | 12px | Popover vertical padding |
| medium | 16px | Popover horizontal padding, card spacing |
| large | 20px | Grid gutters, container padding, form field gaps |
| x-large | 24px | Task grouping |
| xx-large | 32px | Select option indentation |
| xxx-large | 40px | App layout content padding |

**Do:** Use the spacing scale for custom components to match built-in component spacing.
**Don't:** Make arbitrary spacing decisions — every spacing choice should be intentional.

### Typography

- **Primary font:** Open Sans (Light 300, Normal 400, Bold 700, Heavy)
- **Monospace:** Monaco, Menlo, Consolas, Courier Prime
- **Minimum font size:** 12px
- **One h1 per page** — use headings based on importance hierarchy, not visual preference

| Heading | Size | Line Height | Weight |
|---------|------|-------------|--------|
| X-Large (h1) | 24px | 30px | Bold |
| Large (h2) | 20px | 24px | Bold |
| Medium (h3) | 18px | 22px | Bold |
| Small (h4) | 16px | 20px | Bold |
| X-Small (h5) | 14px | 18px | Bold |

**Do:** Use sentence case capitalization. Maintain parallel structure in list items.
**Don't:** Overuse monospaced font — reserve for code, sample output, numeric datasets, dates, IPs, and IDs.

### Colors

- **Always use design tokens**, never raw color constants — this ensures light/dark mode compatibility
- **Blue:** Primary actions, links, interactive accents. Creates visual hierarchy
- **Red:** Error states, problematic conditions
- **Green:** Success, completion, healthy status

**Do:** Pair color with iconography, text labels, or visual indicators.
**Don't:** Use color as the only means of conveying information — users with color blindness must perceive the same information.

### Iconography

| Size | Dimensions | Use |
|------|-----------|-----|
| Normal | 16×16px | Default, action icons |
| Medium | 20×20px | Medium emphasis |
| Big | 32×32px | Pair with h1 headings |
| Large | 48×48px | High emphasis |

**Do:** Use labels alongside status and symbol icons. Match icon size to accompanying text font-size.
**Don't:** Pair icons with page or section headlines. Combine multiple icons into single objects.

---

## Layout

### Core Principles

1. **Predictable** — define layouts supporting concrete user flows; apply them consistently
2. **Consistent** — follow the spacing system to create coherent visual experiences
3. **Responsive** — build for fluid browser content, not specific screen sizes or devices

### App Layout Types

| Type | Use Case |
|------|----------|
| **Standard** | Expressive use cases (marketing, documentation, hero headers) |
| **Toolbar** | Productivity tools with high information density and frequent interaction |

**Do:** Use one app layout consistently throughout the entire application.
**Don't:** Mix layout types. Use styled headers on high-interactivity pages requiring focus.

### Structural Regions

All layouts provide: collapsible side navigation (left), breadcrumb region, flashbar/notification area, central content region, collapsible tools panel (right).

### Side Navigation State by Context

| Context | Side Navigation |
|---------|-----------------|
| Forms (create, edit) | **Closed** by default |
| View resources (tables, cards) | **Open** by default |
| Details pages | **Open** by default |

---

## Navigation

### Two Navigation Types

| Type | Purpose |
|------|---------|
| **Top navigation** | Global controls: search, notifications, settings, user profile, sign out |
| **Side navigation** | Structural navigation organized to support information architecture |

**Do:** Place utility navigation (account, settings, sign out) in top navigation where users expect it.
**Don't:** Place utility navigation in side navigation.

### Side Navigation Organization

- Order links from general to specific by usefulness, relevance, or frequency
- Keep groupings minimal
- Use dividers sparingly for fundamentally unrelated link sets
- Breadcrumbs must reflect the same information architecture as side navigation

**Do:** Organize navigation supporting primary use cases and mental models.
**Don't:** Mix sections and expandable link groups in the same side navigation. Create sections with only two links.

### Configuration Patterns

| Pattern | Use Case |
|---------|----------|
| Top + Side | Services requiring hierarchy AND utility functions |
| Side only | Services without utility needs (e.g., desktop apps) |
| Top only | Single-page services relying on search as primary navigation |

---

## Forms & Validation

### Form Validation Strategy

Two validation types serve different purposes:

| Type | Trigger | Use Case |
|------|---------|----------|
| **Inline validation** | On field blur / on key press when fixing | Client-side: required fields, format checks |
| **Page-level validation** | After form submission | Server-side: capacity issues, conflicts |

### Validation Do's

- Keep the submit button **always active** — never disable it (except simple delete confirmations)
- Scroll to the top-most error on submission and give it focus
- Validate fields after values are input or when required fields are left empty
- Switch to validate-on-keypress when users are fixing errors
- Display contextual error text below corresponding controls
- Display server-side alerts above submit buttons

### Validation Don'ts

- Don't disable the form submission button
- Don't validate fields on first page visit
- Don't display generic messages like "Fix all errors on this page"
- Don't interrupt users with validation before they enter data

### Error Message Formats

| Scenario | Format |
|----------|--------|
| Required field | "[Label] is required" |
| Invalid format | "Enter a valid [label]" |
| Mismatch | One sentence stating mismatch + next steps |
| Character limit | "Character count: 120/50" |

### Constraint Text

- Maximum two lines
- Plain text only (no italics/boldface)
- Format: "[Label] must be X to Y characters, and must/can't [constraints]"

---

## Selection Controls

Choose the right component for the interaction:

| Scenario | Component |
|----------|-----------|
| Single selection, 2–7 options | **Radio group** |
| Single selection, 2–7 options with rich descriptions | **Tiles** |
| Single selection, 8+ options | **Select** |
| Single selection, 8+ options with user input | **Autosuggest** |
| Multi-selection, 2–7 options | **Checkboxes** |
| Multi-selection, 8+ options | **Multiselect** |
| Boolean, takes effect on submit | **Checkbox** |
| Boolean, takes effect immediately | **Toggle** |
| Boolean, needs metadata for both states | **Radio group** or **Tiles** |

### Progressive Disclosure

**Do:** Use consistent parent control types throughout the same page.
**Don't:** Use identical control types for main options and sub-options (e.g., checkboxes for both parent and child). Place controls between radio options — place them after the group.

---

## Actions

### Global vs. In-Context Actions

| Type | Location | Target | Use Case |
|------|----------|--------|----------|
| **Global** | Page/component headers | One or multiple resources | Bulk operations, create buttons |
| **In-context** | Near specific items | Single resource | Common tasks: download, edit, stop |

**Do:** Pair global and in-context actions — all actions should appear globally; commonly-used ones can also appear contextually.
**Don't:** Use global actions for single-resource operations. Use in-context actions for bulk operations.

---

## Resource Management

### Create Patterns

| Factor | Modal | Single Page | Multi-Page (Wizard) |
|--------|-------|-------------|---------------------|
| Form length | 1 field | 2–15 fields, up to 5 groups | 16+ fields or 5+ groups |
| Complexity | Basic | Basic | Complex, interrelated |
| Mutability | Mutable after creation | Mutable after creation | Immutable after creation |

#### Single Page Create

- Keep the primary section short — only required fields without good defaults and fields 80%+ of users expect
- Use good defaults so users can create resources with one click
- Field order in the primary section becomes the default table column order ("data symmetry")
- Place additional inputs in expandable sections labeled with nouns (e.g., "Additional settings")

#### Multi-Page Create (Wizard)

- Limit to 3–5 steps (maximum 7)
- Each step on a single page
- Include a review page summarizing all choices
- Enable backward navigation to revise previous selections

**Do:** Always allow users to exit forms. Show unsaved changes modal if input exists.
**Don't:** Disable the primary button. Use inline editing on review pages.

### Edit Patterns

| Factor | Page Edit | Inline Edit |
|--------|-----------|-------------|
| Settings | Interdependent | Independent |
| Context | Dedicated page | Within current view |
| Multiple resources | One at a time | Simultaneous updates |

### Delete Patterns

| Severity | Pattern | Confirmation |
|----------|---------|-------------|
| Low risk, easy to recreate | **One-click delete** | None |
| Moderate risk, not quickly recreatable | **Simple confirmation** | Modal with confirm button |
| High risk, cascading consequences | **Additional confirmation** | Modal with typed confirmation |

#### Delete Modal Content

- Title: "Delete [resource type]" — singular or plural as appropriate
- Bold the resource identifier
- State irreversibility: "You can't undo this action"
- Include consequences and cascading effects
- Execute button: "Delete" (or matching verb like "Terminate")

### View Patterns

| Pattern | When to Use |
|---------|-------------|
| **Table view** | 9+ resources, shared metadata, columnar data, comparison needed |
| **Card view** | ≤5 resources, different metadata, non-columnar data (charts, images) |
| **Split view** | Extension of table/card for monitoring or troubleshooting |

#### Table View Guidelines

- Organize columns by importance (left to right)
- Use the "full-page" table variant
- Enable pagination even for single-page datasets
- Support preferences for row count, column visibility/order

**Don't:** Combine pagination and progressive loading. Modify column headers after user filtering.

### Details Pages

| Pattern | When to Use |
|---------|-------------|
| **With tabs** | Multiple tasks on a single resource, grouped by task |
| **As a hub** | Large, complex datasets with related resources |

- Display all information at once when possible
- Use containers to group content into meaningful sections
- Reflect the creation flow in information grouping
- Breadcrumb: [Service] > [Resource type] > [Resource name/ID]

---

## Feedback & Loading

### Feedback Component Selection

| Duration | Component | Behavior |
|----------|-----------|----------|
| < 1 second | None | Block interaction silently |
| 1–10 seconds | **Spinner** | Block further interaction; reassure operation is active |
| 10+ seconds | **Progress bar** | Allow navigation elsewhere; show completion estimate |

### Feedback Types

| Component | Use Case | Placement |
|-----------|----------|-----------|
| **Alert** | Brief messages requiring action | Contextual: near fields or section tops |
| **Flashbar** | Status notifications for operations | Always at page top |
| **Spinner** | Process is running (unknown duration) | Where the action was initiated |
| **Progress bar** | Operation with known duration | Contextual on page or in flash message |

### Refreshing

**Do:** Keep the dataset visible during refresh. Enable user actions on resources during refresh. Display a timestamp after refresh.
**Don't:** Add refresh buttons unless users need to perform an explicit action.

### Loading Messages

- No articles (a, an, the)
- No end punctuation

---

## Error Handling

### Error Placement

| Error Type | Component | Placement |
|------------|-----------|-----------|
| Field validation | **Form field** | Inline, below the field |
| Server-side validation | **Alert** | Above submit button |
| Action failure (e.g., delete) | **Flashbar** | Page level |
| Component render failure | **Error boundary** | Where component should appear |
| Unexpected client-side error | **Error boundary** | Page or section level |

### Error Message Principles

1. **Make it actionable** — help users understand what they can do to resolve the problem
2. **Be specific** — include error counts, codes, and details to help troubleshooting
3. **Include recommendations** — suggest how the error can be fixed
4. **Add links** — if you can't recommend an action, link to documentation

### Error Message Do's

- Clearly state what is wrong and what action to take
- Use action verbs: "Security code doesn't match. Refresh the code and try again."
- Include expandable sections for raw error messages on unexpected failures
- Explain why the error happened if known

### Error Message Don'ts

- Don't display raw machine-generated errors as the primary message
- Don't overwhelm users with error details
- Don't make false promises (e.g., "our team has been informed" without automatic tracking)
- Don't imply user blame (e.g., "You didn't enter a valid format")
- Don't use jargon
- Don't use error messages to display warnings — errors signal critical failure; warnings are advisory

---

## Empty States

### Three Types

| Type | When | Content |
|------|------|---------|
| **Empty state** | No resources created / all deleted | Heading + description + action button |
| **Zero results** | Filter returns no matches | "No matches" heading + "Clear filter" button |
| **Empty value** | No data for a field | Display a hyphen "-" |

### Do's

- Always provide an action to prevent user confusion
- Display resource counters reflecting actual counts
- For zero results, always include a "Clear filter" button

### Don'ts

- Don't use empty states for errors (use flashbar or status indicators)
- Don't repeat heading/button text in descriptions
- Don't implement empty states in help panels

### Writing

- **Heading:** Bold text, no end punctuation (e.g., "No distributions")
- **Description:** Include end punctuation; explain why the state is empty
- **Action button:** Match corresponding table button labels (e.g., "Create distribution")

---

## Disabled & Read-Only States

### When to Use Each

| State | Purpose | Example |
|-------|---------|---------|
| **Disabled** | Prevent interaction when actions could cause errors or prerequisites aren't met | Disable "Delete" until a resource is selected |
| **Read-only** | Allow viewing without modification; user lacks edit permissions | Form fields on review pages |

### Do's

- Use read-only controls in forms when you need the value in form submission but prevent modification
- Use plain text (not read-only controls) on review pages
- Communicate disabled reasons via tooltips for buttons, dropdowns, tabs, and date pickers

### Don'ts

- Don't apply disabled state to form submission buttons — follow validation patterns instead
- Don't show disabled items when there is no activation path — hide them to simplify the interface

### Disabled Reason Copy

| Cause | Format |
|-------|--------|
| Permissions | "This action is available in/for [constraint]" |
| Prerequisites | "This action is available when [future action]" |
| Technical limitations | "This action is unavailable due to [technical constraints]" |

---

## Unsaved Changes

### Core Principle

Preventing data loss is critical to maintaining user trust.

### Do's

- Show confirmation modals after any action that could result in data loss
- Use warning alerts for potential data loss
- Use the `beforeunload` event for browser-native modals (closing tabs, reloading, changing URLs)
- Consider saving progress at intervals for large data entries

### Don'ts

- Don't show modals when no change has occurred, changes are already saved, or actions open new tabs
- Don't show modals for controls tied to progressive disclosure
- Don't implement "don't show again" options — users can't re-activate them

---

## Help System

### Three-Tier Progressive Disclosure

The help system addresses three user questions: "What is this?", "Why do I care?", and "How do I make the right decision?"

| Tier | Content Type | Examples |
|------|-------------|---------|
| **Small (UI text)** | Labels, descriptions, placeholders, constraints, errors | Form field labels, input placeholders |
| **Medium (Help panel)** | Prerequisites, consequences, decision guidance | Why a field is required, how to choose between values |
| **Large (External docs)** | In-depth resources | Links opening in new tabs |

### Do's

- Display page-level help as default help panel content
- Always include a page-level info link (except service homepage)
- Include help panel in every step of multi-step create flows
- Update help panel when user triggers an info link or navigates
- Place info links next to headers, not descriptions
- Open "learn more" links in new tabs

### Don'ts

- Don't include help panel on the service homepage
- Don't display empty help panels
- Don't use standalone "learn more" links alongside a help panel (except in alerts/modals)

---

## Drag and Drop

### Complementary vs. Essential

| Type | Meaning | Requirement |
|------|---------|-------------|
| **Complementary** | Enhances UX but not required (e.g., file upload with browse fallback) | Provide alternative interaction |
| **Essential** | Required to complete a task (e.g., dashboard configuration) | Must provide clear affordance signifiers AND alternative methods |

### Do's

- Use consistent visual cues (drag handles) for affordance
- Include cursor changes on hover
- Change item appearance before, during, and after interaction
- Provide keyboard-based alternatives

### Don'ts

- Don't make drag-and-drop the only way to complete essential tasks without alternatives
- Don't omit visual feedback during drag operations

---

## Dashboard Design

### Three Primary Use Cases

1. **Monitor** — track system health and trends
2. **Investigate** — filter and drill down to identify root causes
3. **Be informed** — guide new users and communicate service updates

### Layout Selection

| Layout | Use Case |
|--------|----------|
| **Static** | Content order and importance are critical to user success |
| **Configurable** | Users benefit from customizing content and ordering |

**Don't:** Combine static and configurable layout in one dashboard — mixing causes user frustration.

---

## Writing Guidelines

These rules apply across all UI text.

### General Rules

- **Sentence case** — capitalize only proper nouns and brand names
- **End punctuation** in body text — none in headers and buttons
- **No exclamation points**
- **Present tense, active voice**
- **Device-independent language** — use "choose" or "select", never "click"
- **No directional language** — use "previous" not "above"; "following" not "below"

### Prohibited Terms

Never use: "please", "thank you", ellipsis (...), ampersand (&), "e.g.", "i.e.", "etc."

### Component-Specific Writing

| Component | Rule |
|-----------|------|
| **Breadcrumbs** | Last item must match page title exactly |
| **Form page title** | Begin with active verb: "Create distribution" |
| **Container headings** | Begin with a noun |
| **Expandable sections** | Noun describing content, not an action: "Additional settings" |
| **Cancel button** | Always "Cancel" |
| **Submit button** | "[Active verb] [resource type]": "Create distribution" |
| **Toggle labels** | Describe the outcome: "Dark mode" |
| **Checkbox labels** | Describe intent: "Enable enhanced monitoring" |
| **Loading messages** | No articles, no end punctuation |

---

## Accessibility

### Core Principles

1. **Semantic HTML** — use appropriate elements and ARIA attributes
2. **Keyboard navigable** — all interactive elements accessible in logical, predictable order
3. **Color is never the only indicator** — always pair with icons, text, or patterns
4. **WCAG contrast** — meet minimum contrast ratios for all text and interactive elements
5. **Don't over-mark** — avoid unnecessary roles and landmarks; follow component-specific guidelines

### Per-Component Requirements

- Define ARIA labels aligned with the language context of your application
- Follow alternative text guidelines for each component
- Ensure every table cell has a logical column or row header
- Tables must appear in screen reader table lists
- Set `loadingText` properties to communicate loading states
- Use ARIA live regions for dynamic content updates (timestamps, notifications)

### Drag-and-Drop Accessibility

Always provide alternative keyboard-based interaction — a series of single selections without dragging.

### Feedback Accessibility

- Make refresh buttons accessible with `aria-label`
- Use ARIA live regions for refresh timestamp announcements
- Ensure error messages receive focus when they appear

---

## Filter Patterns

### Choosing a Filter Type

| Pattern | Use Case | Operators |
|---------|----------|-----------|
| **Text filter** | Simple resources, small property sets | None — plain text match |
| **Collection select** | Simple resources, 1–2 filter properties | "And" only, single value per property |
| **Property filter** | Complex resources, large property sets | And, Or, Not, And not, Or not |

- Display operators only when at least two filters exist
- Users expect filters to operate across the **full collection**, not just visible resources

---

*Based on [Cloudscape Design System](https://cloudscape.design/) patterns and guidelines.*
