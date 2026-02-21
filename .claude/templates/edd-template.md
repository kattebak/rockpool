# EDD: [Feature Name]

**File**: `docs/EDD/00x_Feature_Name_Here.md` (use sequential number and PascalCase with underscores)
**Created**: [YYYY-MM-DD]
**Status**: 🚧 In Progress
**Last Updated**: [YYYY-MM-DD]
**Type**: [Frontend | Backend | Full-Stack | Infrastructure]

## SUMMARY

[2-4 sentences clearly explaining what will be built and why. Focus on WHAT will happen, not goals or criteria.]

Example:
"This implements document-level revision tracking for POS documents. When a DOCUMENT_REVIEWED webhook arrives from Limai, all feedstock lines will be rewritten as a new revision while preserving previous revisions. Each revision gets a sequential number, and the POSDocument tracks the current revision pointer."

## TECHNICAL SPECIFICATIONS

### Affected Files

**CREATE:**
- `./[path]` - [Description]

**MODIFY:**
- `./[path]` - [Description]

**DELETE:**
- `./[path]` - [Description]

### Architecture & Design

[Choose appropriate subsections based on project type]

#### For Frontend Projects:

**Component Hierarchy:**
```
[ParentComponent]
├── [ChildComponent1]
└── [ChildComponent2]
```

**State Management:**
- **Store**: [StoreName]
- **Key State**: [State properties]
- **Key Actions**: [Actions]

**Data Flow:**
[Brief description of how data flows through the system]

#### For Backend Projects:

**API Operations:**

##### 1. [Operation Name]
- **Operation ID**: `[Namespace]_[operationName]`
- **Method**: [GET|POST|PUT|DELETE]
- **Route**: `/[path]`
- **Request**: [Path/Query parameters or Request body type]
- **Response**: [Response type]
- **Logic**: [1-2 sentences on approach]

**Service Layer Approach:**
- [Service class/module names and responsibilities]
- [Key method signatures]
- [Integration points]

**Database Schema** (if applicable):
- **Table/Entity**: [Name]
- **Key fields**: [describe]

#### For Full-Stack Projects:

Include both frontend and backend sections above.

### Coding Standards

All code MUST follow project standards in `.claude/rules/`

### TypeSpec Changes

**Files to modify:**
- `./typespec/[path]`

[Show namespace and operation signatures - NOT full implementations]

### Dependencies & Prerequisites

**New Packages** (if any):
```bash
npm install [package-name]@[version]
```

**Environment Variables** (if any):
```bash
VITE_[VARIABLE_NAME]=[description]
```

## IMPLEMENTATION PHASES

### Phase 1: [Phase Name]

**Objective**: [What this phase achieves]

**Can Execute in Parallel**: ❌ No (or ✅ Yes)

**Tasks**:
- [ ] Task 1: [Specific, actionable task]
  - File: `./[path]`
  - Notes:
- [ ] Task 2: [Specific, actionable task]
  - File: `./[path]`
  - Notes:

**Validation**:
- [ ] [Validation step 1]
- [ ] [Validation step 2]
- [ ] Type-check passes (`npm run check`)
- [ ] Linting passes (`npm run lint`)

---

### Phase 2: [Phase Name]

**Objective**: [What this phase achieves]

**Can Execute in Parallel**: ✅ Yes - [reason]

**Tasks**:
- [ ] Task 1: [Specific, actionable task]
  - File: `./[path]`
  - Parallel with: Task 2, Task 3
  - Notes:
- [ ] Task 2: [Specific, actionable task]
  - File: `./[path]`
  - Parallel with: Task 1, Task 3
  - Notes:

**Validation**:
- [ ] [Validation step 1]
- [ ] [Validation step 2]
- [ ] Type-check passes
- [ ] Linting passes

---

## TESTING & VALIDATION

### Verification
- [ ] `npm run fix` auto-fixes any linting issues
- [ ] `npm run lint` passes
- [ ] `npm run check` passes (tsgo type-check)
- [ ] `npm test` passes
- [ ] Manual testing checklist:
  - [ ] [Test case 1]
  - [ ] [Test case 2]

## APPENDICES

### Data Structures (if needed)

```typescript
interface [InterfaceName] {
  [property]: [type]
}
```

### API Examples (for backend projects)

**Request:**
```bash
curl -X GET https://api.example.com/[path]
```

**Response:**
```json
{
  "[property]": "[value]"
}
```

### References

- TypeScript Standards: `.claude/rules/typescript.md`
- Development Standards: `.claude/rules/development.md`
