# Phase 2 — Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single-grouping "projects" layer to the gallery so every generation belongs to exactly one project, with an Inbox default that cannot be deleted, sidebar UI on Gallery, and a sticky "Save to" picker on Generate.

**Architecture:** A new main-process `projectsStore.ts` owns the project list in a separate `projects.json`. `HistoryEntry` gains a required `projectId` field. Settings bumps v2→v3 to remember `lastProjectId`. The renderer adds a `ProjectSidebar` component on Gallery and a "Save to" dropdown on Generate. IPC mirrors the workstations pattern from Phase 1.

**Tech Stack:** Electron + React + TypeScript + vitest (already in deps). Zero new dependencies. Atomic write via `tmp + rename` (already in `store.ts`).

**Spec:** `docs/superpowers/specs/2026-05-20-phase-2-projects-design.md`

---

## File map

### New main-process files

| Path | Responsibility |
|---|---|
| `src/main/projectsStore.ts` | Project CRUD + atomic write + getInboxId helper |
| `src/main/ipc/projects.ts` | IPC handlers: list / create / rename / delete + broadcast |
| `src/main/__tests__/projectsStore.test.ts` | TDD for projectsStore |
| `src/main/__tests__/historyStore.test.ts` | TDD for removeByProject |

### New renderer files

| Path | Responsibility |
|---|---|
| `src/renderer/src/hooks/useProjects.ts` | Subscribes to projects:update, exposes pool state + actions |
| `src/renderer/src/components/ProjectSidebar.tsx` | Sidebar list + inline create + rename + delete menu |
| `src/renderer/src/components/ProjectSidebar.module.css` | Styles |

### Modified files

| Path | Change |
|---|---|
| `src/main/store.ts` | v3 schema + `lastProjectId` field + migration |
| `src/main/historyStore.ts` | `projectId` required on add; add `removeByProject(id)` |
| `src/main/ipc/index.ts` | Register `registerProjectHandlers()` |
| `src/main/ipc/history.ts` | Default `projectId` fallback in `history:add` |
| `src/preload/index.ts` | Expose `window.api.projects.*` + onUpdate; add `lastProjectId` to Settings; add `projectId` to HistoryEntry |
| `src/preload/index.d.ts` | Mirror preload types |
| `src/renderer/src/types.ts` | Re-export `StoredProject` |
| `src/renderer/src/views/GalleryView.tsx` | Two-column layout + filter by selected project |
| `src/renderer/src/views/GalleryView.module.css` | Two-column layout styles |
| `src/renderer/src/views/GenerateView.tsx` | "Save to" dropdown + sticky update on submit |

**Total:** 7 new (4 main, 3 renderer), 10 modified. Estimated ~600 LOC.

---

## Task order

Tasks 0–4 are pure-logic main-process changes with TDD. Tasks 5–8 wire it through IPC and the renderer. Task 9 is acceptance verification. Each task leaves the codebase in a working state (typecheck passes, all existing tests still pass).

---

## Task 0: projectsStore — CRUD + atomic write (TDD)

**Files:**
- Create: `src/main/projectsStore.ts`
- Create: `src/main/__tests__/projectsStore.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/main/__tests__/projectsStore.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock electron's app.getPath to point at a tmp dir
const tmpDir = require('path').join(require('os').tmpdir(), `proj-test-${Date.now()}`)
vi.mock('electron', () => ({
  app: { getPath: () => tmpDir }
}))

import { mkdirSync, rmSync, existsSync } from 'fs'
import {
  listProjects,
  addProject,
  renameProject,
  deleteProject,
  getProject,
  ensureInbox
} from '../projectsStore'

describe('projectsStore', () => {
  beforeEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
    mkdirSync(tmpDir, { recursive: true })
  })

  it('listProjects returns [] when file is missing', () => {
    expect(listProjects()).toEqual([])
  })

  it('addProject creates a project with UUID id and createdAt', () => {
    const p = addProject('Logos')
    expect(p.id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(p.name).toBe('Logos')
    expect(typeof p.createdAt).toBe('number')
    expect(listProjects()).toHaveLength(1)
  })

  it('addProject rejects empty/whitespace name', () => {
    expect(() => addProject('')).toThrow(/name required/i)
    expect(() => addProject('   ')).toThrow(/name required/i)
  })

  it('addProject trims the name', () => {
    const p = addProject('  Logos  ')
    expect(p.name).toBe('Logos')
  })

  it('listProjects sorts by createdAt asc', async () => {
    const a = addProject('A')
    await new Promise((r) => setTimeout(r, 5))
    const b = addProject('B')
    expect(listProjects().map((p) => p.id)).toEqual([a.id, b.id])
  })

  it('getProject returns the project by id, or undefined', () => {
    const p = addProject('X')
    expect(getProject(p.id)?.name).toBe('X')
    expect(getProject('does-not-exist')).toBeUndefined()
  })

  it('renameProject updates the name and persists', () => {
    const p = addProject('Old')
    const renamed = renameProject(p.id, 'New')
    expect(renamed.name).toBe('New')
    expect(listProjects()[0].name).toBe('New')
  })

  it('renameProject rejects empty/whitespace', () => {
    const p = addProject('X')
    expect(() => renameProject(p.id, '')).toThrow(/name required/i)
    expect(() => renameProject(p.id, '   ')).toThrow(/name required/i)
  })

  it('renameProject throws on unknown id', () => {
    expect(() => renameProject('nope', 'X')).toThrow(/not found/i)
  })

  it('deleteProject removes the project', () => {
    const p = addProject('X')
    deleteProject(p.id)
    expect(listProjects()).toEqual([])
  })

  it('deleteProject throws on unknown id', () => {
    expect(() => deleteProject('nope')).toThrow(/not found/i)
  })

  it('ensureInbox creates an Inbox project if none exists, returns its id', () => {
    expect(listProjects()).toEqual([])
    const id = ensureInbox()
    expect(id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(listProjects()).toHaveLength(1)
    expect(listProjects()[0].name).toBe('Inbox')
  })

  it('ensureInbox is idempotent — returns the existing first project id', () => {
    const id1 = ensureInbox()
    const id2 = ensureInbox()
    expect(id2).toBe(id1)
    expect(listProjects()).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run the tests — expect failure**

Run: `npm test -- projectsStore`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `projectsStore`**

`src/main/projectsStore.ts`:

```ts
import { app } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'

export interface StoredProject {
  id: string
  name: string
  createdAt: number
}

function getProjectsPath(): string {
  return join(app.getPath('userData'), 'projects.json')
}

function readFromDisk(): StoredProject[] {
  const p = getProjectsPath()
  if (!existsSync(p)) return []
  try {
    const raw = readFileSync(p, 'utf-8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as StoredProject[]) : []
  } catch {
    return []
  }
}

function writeToDisk(projects: StoredProject[]): void {
  const p = getProjectsPath()
  const tmp = `${p}.tmp`
  writeFileSync(tmp, JSON.stringify(projects, null, 2), 'utf-8')
  renameSync(tmp, p)
}

export function listProjects(): StoredProject[] {
  return readFromDisk().sort((a, b) => a.createdAt - b.createdAt)
}

export function getProject(id: string): StoredProject | undefined {
  return readFromDisk().find((p) => p.id === id)
}

export function addProject(name: string): StoredProject {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Name required')
  const p: StoredProject = { id: randomUUID(), name: trimmed, createdAt: Date.now() }
  const list = readFromDisk()
  list.push(p)
  writeToDisk(list)
  return p
}

export function renameProject(id: string, name: string): StoredProject {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Name required')
  const list = readFromDisk()
  const target = list.find((p) => p.id === id)
  if (!target) throw new Error('Project not found')
  target.name = trimmed
  writeToDisk(list)
  return target
}

export function deleteProject(id: string): void {
  const list = readFromDisk()
  if (!list.some((p) => p.id === id)) throw new Error('Project not found')
  writeToDisk(list.filter((p) => p.id !== id))
}

/** Returns the id of the first (oldest) project, creating an "Inbox" if none exists. */
export function ensureInbox(): string {
  const list = readFromDisk().sort((a, b) => a.createdAt - b.createdAt)
  if (list.length > 0) return list[0].id
  const inbox = addProject('Inbox')
  return inbox.id
}
```

- [ ] **Step 4: Run the tests — expect pass**

Run: `npm test -- projectsStore`
Expected: All 12 tests pass.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck:node`
Expected: clean.

- [ ] **Step 6: Commit**

```
git commit -m "$(cat <<'EOF'
feat(main): add projectsStore with CRUD + atomic write

projects.json holds the project list (id, name, createdAt). Atomic
write via tmp + rename. ensureInbox() creates a default "Inbox" if
none exists. Pure-logic; testable without Electron via app.getPath
mock.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 1: Settings v3 — `lastProjectId` + migration (TDD)

**Files:**
- Modify: `src/main/store.ts`
- Modify: `src/main/__tests__/store.test.ts`

- [ ] **Step 1: Extend tests**

Add to `src/main/__tests__/store.test.ts` (append in the existing `describe('migrateSettings', ...)`):

```ts
  it('migrates v2 to v3 — adds lastProjectId: null', () => {
    const v2: any = {
      version: 2,
      ollamaBaseUrl: 'http://x:1', ollamaModel: 'm', maxKeyframes: 8,
      outputFolder: '', comfyUrl: 'http://x:8188',
      workstations: [], schedulerMode: 'lan-pool',
      discovery: { portRange: [8188, 8190] },
      ui: { workstationsPanelOpen: true, queuePanelOpen: true }
    }
    const v3 = migrateSettings(v2)
    expect(v3.version).toBe(3)
    expect(v3.lastProjectId).toBeNull()
  })

  it('is idempotent on v3', () => {
    const v3a: any = {
      ...DEFAULT_SETTINGS,
      version: 3,
      lastProjectId: 'abc-123'
    }
    const v3b = migrateSettings(v3a)
    expect(v3b).toEqual(v3a)
  })

  it('v1 → v3 migration sets lastProjectId: null', () => {
    const v1: any = { ollamaBaseUrl: 'http://x:1', comfyUrl: '' }
    const v3 = migrateSettings(v1)
    expect(v3.version).toBe(3)
    expect(v3.lastProjectId).toBeNull()
  })
```

- [ ] **Step 2: Run — expect FAIL**

`npm test -- store` → at least the new tests fail.

- [ ] **Step 3: Modify `src/main/store.ts`**

Replace these parts of `src/main/store.ts`:

Find the `SettingsV2` interface and ADD this below it:

```ts
export interface SettingsV3 extends SettingsV2 {
  version: 3
  lastProjectId: string | null
}
```

Change the `Settings` and `DEFAULT_SETTINGS`:

```ts
/** Public type. Always v3 once `getSettings()` returns. */
export type Settings = SettingsV3

export const DEFAULT_SETTINGS: Settings = {
  version: 3,
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: 'llava',
  maxKeyframes: 8,
  outputFolder: '',
  comfyUrl: 'http://localhost:8188',
  workstations: [],
  schedulerMode: 'lan-pool',
  discovery: { portRange: [8188, 8190] },
  ui: { workstationsPanelOpen: true, queuePanelOpen: true },
  lastProjectId: null
}
```

Replace `migrateSettings`:

```ts
export function migrateSettings(
  raw: Partial<SettingsV3> & Partial<SettingsV2> & Partial<SettingsV1>
): SettingsV3 {
  if (raw.version === 3) {
    return { ...DEFAULT_SETTINGS, ...raw, version: 3 }
  }

  // First, normalize to v2 (handles v1 path inline).
  let v2: SettingsV2
  if (raw.version === 2) {
    v2 = { ...DEFAULT_SETTINGS, ...raw, version: 2 } as SettingsV2
  } else {
    const comfyUrl = (raw.comfyUrl ?? '').trim().replace(/\/$/, '')
    const workstations: StoredWorkstation[] = comfyUrl
      ? [{ id: randomUUID(), name: 'Local ComfyUI', url: comfyUrl, enabled: true }]
      : []
    v2 = {
      ...DEFAULT_SETTINGS,
      ...raw,
      version: 2,
      workstations,
      schedulerMode: 'lan-pool',
      discovery: { portRange: [8188, 8190] },
      ui: { workstationsPanelOpen: true, queuePanelOpen: true }
    } as SettingsV2
  }

  // v2 → v3: add lastProjectId field (null until first generation picks one).
  return { ...v2, version: 3, lastProjectId: null }
}
```

- [ ] **Step 4: Run — expect PASS**

`npm test -- store` → all tests pass (7 total now).

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck:node && npm run typecheck:web`
Expected: clean.

- [ ] **Step 6: Commit**

```
git commit -m "$(cat <<'EOF'
feat(store): settings v3 schema + lastProjectId

Bumps settings.json from v2 to v3, adds lastProjectId: string | null
for the sticky "Save to" default. Migration is idempotent and chains
through v1→v2→v3 in one call.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: historyStore — `projectId` required + `removeByProject` (TDD)

**Files:**
- Modify: `src/main/historyStore.ts`
- Create: `src/main/__tests__/historyStore.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/main/__tests__/historyStore.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

const tmpDir = require('path').join(require('os').tmpdir(), `hist-test-${Date.now()}`)
vi.mock('electron', () => ({
  app: { getPath: () => tmpDir }
}))

import { mkdirSync, rmSync, existsSync } from 'fs'
import {
  listHistory,
  addHistoryEntry,
  deleteHistoryEntry,
  clearHistory,
  removeByProject
} from '../historyStore'

describe('historyStore', () => {
  beforeEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
    mkdirSync(tmpDir, { recursive: true })
  })

  it('addHistoryEntry requires projectId and persists it', () => {
    const e = addHistoryEntry({
      kind: 'image',
      filePath: '/p/a.png',
      fileName: 'a.png',
      prompt: 'hi',
      createdAt: Date.now(),
      projectId: 'proj-1'
    })
    expect(e.projectId).toBe('proj-1')
    expect(listHistory()[0].projectId).toBe('proj-1')
  })

  it('removeByProject deletes only entries with the given projectId', () => {
    addHistoryEntry({
      kind: 'image', filePath: '/p/a.png', fileName: 'a.png',
      prompt: 'a', createdAt: 1, projectId: 'proj-1'
    })
    addHistoryEntry({
      kind: 'image', filePath: '/p/b.png', fileName: 'b.png',
      prompt: 'b', createdAt: 2, projectId: 'proj-2'
    })
    addHistoryEntry({
      kind: 'image', filePath: '/p/c.png', fileName: 'c.png',
      prompt: 'c', createdAt: 3, projectId: 'proj-1'
    })
    const removed = removeByProject('proj-1')
    expect(removed).toBe(2)
    expect(listHistory().map((e) => e.fileName)).toEqual(['b.png'])
  })

  it('removeByProject returns 0 when nothing matches', () => {
    addHistoryEntry({
      kind: 'image', filePath: '/p/a.png', fileName: 'a.png',
      prompt: 'a', createdAt: 1, projectId: 'proj-1'
    })
    expect(removeByProject('does-not-exist')).toBe(0)
    expect(listHistory()).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

`npm test -- historyStore` → fails (missing `removeByProject`, missing required `projectId`).

- [ ] **Step 3: Modify `src/main/historyStore.ts`**

Update the interface and `addHistoryEntry`, add `removeByProject`. Full replacement:

```ts
import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export interface HistoryEntry {
  id: string
  kind: 'image' | 'video'
  filePath: string
  fileName: string
  prompt: string
  model?: string
  durationSec?: number
  frameCount?: number
  durationMs?: number
  createdAt: number
  thumbnailPath?: string
  videoPath?: string
  projectId: string  // REQUIRED — FK into projects.json
}

const MAX_ENTRIES = 100

function getHistoryPath(): string {
  return join(app.getPath('userData'), 'history.json')
}

function readFromDisk(): HistoryEntry[] {
  const path = getHistoryPath()
  if (!existsSync(path)) return []
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : []
  } catch {
    return []
  }
}

function writeToDisk(entries: HistoryEntry[]): void {
  writeFileSync(getHistoryPath(), JSON.stringify(entries, null, 2), 'utf-8')
}

export function listHistory(): HistoryEntry[] {
  return readFromDisk()
}

export function addHistoryEntry(
  entry: Omit<HistoryEntry, 'id'> & { id?: string }
): HistoryEntry {
  const entries = readFromDisk()
  const { id: providedId, ...rest } = entry
  const newEntry: HistoryEntry = {
    ...rest,
    id: providedId ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }
  const next = [newEntry, ...entries].slice(0, MAX_ENTRIES)
  writeToDisk(next)
  return newEntry
}

export function deleteHistoryEntry(id: string): void {
  const entries = readFromDisk()
  const filtered = entries.filter((e) => e.id !== id)
  writeToDisk(filtered)
}

export function clearHistory(): void {
  writeToDisk([])
}

/** Remove all entries whose projectId matches. Returns the count removed. */
export function removeByProject(projectId: string): number {
  const entries = readFromDisk()
  const remaining = entries.filter((e) => e.projectId !== projectId)
  const removed = entries.length - remaining.length
  if (removed > 0) writeToDisk(remaining)
  return removed
}
```

- [ ] **Step 4: Run — expect PASS**

`npm test` (full suite) → 3 new historyStore tests pass; no regression elsewhere.

- [ ] **Step 5: Update `src/main/ipc/history.ts` minimally so typecheck passes**

The existing `history:add` handler passes a partial entry into `addHistoryEntry`. Since `projectId` is now required, the handler must populate it. Apply this minimal edit to the `history:add` body:

```ts
import { ensureInbox } from '../projectsStore'

// ...inside the existing history:add handler:
return addHistoryEntry({ ...entry, projectId: entry.projectId ?? ensureInbox() })
```

Task 4 enriches this with the full resolution chain (explicit > settings.lastProjectId > Inbox) and adds the broadcast.

- [ ] **Step 6: Run typecheck**

`npm run typecheck:node` → expected clean.

- [ ] **Step 7: Commit**

```
git commit -m "$(cat <<'EOF'
feat(history): require projectId; add removeByProject

HistoryEntry.projectId is now required. removeByProject(id) returns
the count of entries removed and is used by the cascade-delete path
when a project is removed. history:add gets a minimal ensureInbox()
fallback that Task 4 enriches with the full settings-first chain.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: IPC handlers — `projects:*`

**Files:**
- Create: `src/main/ipc/projects.ts`
- Modify: `src/main/ipc/index.ts`

- [ ] **Step 1: Create `src/main/ipc/projects.ts`**

```ts
import { ipcMain, BrowserWindow } from 'electron'
import {
  listProjects,
  addProject,
  renameProject,
  deleteProject,
  ensureInbox,
  type StoredProject
} from '../projectsStore'
import { removeByProject, listHistory } from '../historyStore'
import { getSettings, setSettings } from '../store'

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

export function registerProjectHandlers(): void {
  // Ensure Inbox exists at startup; if first run, also re-point any
  // entries that have no projectId (legacy v0/v1 history).
  const inboxId = ensureInbox()
  const legacy = listHistory().filter((e) => !e.projectId || e.projectId === '')
  if (legacy.length > 0) {
    const { addHistoryEntry } = require('../historyStore')
    // Rewrite history with projectId backfilled to inboxId.
    const fs = require('fs')
    const path = require('path')
    const { app } = require('electron')
    const histPath = path.join(app.getPath('userData'), 'history.json')
    const fixed = listHistory().map((e) =>
      e.projectId && e.projectId !== '' ? e : { ...e, projectId: inboxId }
    )
    fs.writeFileSync(histPath, JSON.stringify(fixed, null, 2), 'utf-8')
  }

  // If settings.lastProjectId is null, set it to inbox.
  const s = getSettings()
  if (s.lastProjectId === null) {
    setSettings({ lastProjectId: inboxId })
  }

  ipcMain.handle('projects:list', (): StoredProject[] => listProjects())

  ipcMain.handle('projects:create', (_e, args: { name: string }): StoredProject => {
    const p = addProject(args.name)
    broadcast('projects:update', listProjects())
    return p
  })

  ipcMain.handle('projects:rename', (_e, args: { id: string; name: string }): StoredProject => {
    const p = renameProject(args.id, args.name)
    broadcast('projects:update', listProjects())
    return p
  })

  ipcMain.handle('projects:delete', (_e, args: { id: string }): void => {
    if (args.id === inboxId) throw new Error("Inbox cannot be deleted — it's the default")
    // Cascade-delete entries first.
    const removedEntries = removeByProject(args.id)
    deleteProject(args.id)
    // If sticky default points to the deleted project, fall back to Inbox.
    if (getSettings().lastProjectId === args.id) {
      setSettings({ lastProjectId: inboxId })
    }
    broadcast('projects:update', listProjects())
    if (removedEntries > 0) broadcast('history:update', listHistory())
  })
}
```

- [ ] **Step 2: Register in `src/main/ipc/index.ts`**

Find the existing IPC registrations and add:

```ts
import { registerProjectHandlers } from './projects'

// ... inside the registration function, after registerWorkstationHandlers():
registerProjectHandlers()
```

- [ ] **Step 3: Typecheck**

`npm run typecheck:node` → clean.

- [ ] **Step 4: Run all tests**

`npm test` → no regressions; nothing new here is unit-tested (IPC handlers verified by Task 9 acceptance walk-through).

- [ ] **Step 5: Commit**

```
git commit -m "$(cat <<'EOF'
feat(ipc): projects:* handlers + cascade-delete plumbing

projects:list / create / rename / delete handlers wired up. Delete
cascades to history (via removeByProject) and resets sticky default
to Inbox if it pointed to the deleted project. Inbox protected from
deletion. On startup, ensureInbox() creates the default project if
none exists and backfills projectId on any legacy entries.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: history:add — real projectId fallback + broadcast

**Files:**
- Modify: `src/main/ipc/history.ts`

- [ ] **Step 1: Read current `src/main/ipc/history.ts`**

Verify the current shape. The relevant block is the `history:add` handler.

- [ ] **Step 2: Update the handler**

Replace the `history:add` handler body. The full handler now:

```ts
import { ipcMain, BrowserWindow } from 'electron'
import {
  listHistory,
  addHistoryEntry,
  deleteHistoryEntry,
  clearHistory,
  type HistoryEntry
} from '../historyStore'
import { getSettings } from '../store'
import { ensureInbox } from '../projectsStore'

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

export function registerHistoryHandlers(): void {
  ipcMain.handle('history:list', (): HistoryEntry[] => listHistory())

  ipcMain.handle(
    'history:add',
    (_e, entry: Omit<HistoryEntry, 'id' | 'projectId'> & { id?: string; projectId?: string }) => {
      // Resolve projectId: explicit > settings.lastProjectId > Inbox
      const explicit = entry.projectId
      const settingsHint = getSettings().lastProjectId
      const projectId = explicit ?? settingsHint ?? ensureInbox()
      const saved = addHistoryEntry({ ...entry, projectId })
      broadcast('history:update', listHistory())
      return saved
    }
  )

  ipcMain.handle('history:remove', (_e, id: string) => {
    deleteHistoryEntry(id)
    broadcast('history:update', listHistory())
  })

  ipcMain.handle('history:clear', () => {
    clearHistory()
    broadcast('history:update', listHistory())
  })
}
```

If the existing file uses a slightly different shape (e.g. older `history:delete` channel name), preserve channel names — only the body needs to change.

- [ ] **Step 3: Typecheck**

`npm run typecheck:node` → clean.

- [ ] **Step 4: Run all tests**

`npm test` → no regressions.

- [ ] **Step 5: Commit**

```
git commit -m "$(cat <<'EOF'
feat(history ipc): projectId fallback + history:update broadcast

history:add resolves projectId in priority order:
  explicit arg > settings.lastProjectId > Inbox (ensureInbox).
All mutating operations (add / remove / clear) now broadcast
history:update so the renderer can refresh without re-fetching.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Preload bindings

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

- [ ] **Step 1: Add `projects` namespace and `StoredProject` type**

In `src/preload/index.ts`, add these types near the existing `Workstation` / `Job` exports:

```ts
export interface StoredProject {
  id: string
  name: string
  createdAt: number
}
```

Update the `HistoryEntry` interface to include `projectId: string` (required).

Update the `Settings` interface to add `lastProjectId: string | null`.

Add to the `api` object exposed via `contextBridge.exposeInMainWorld`:

```ts
projects: {
  list:    (): Promise<StoredProject[]> =>
    ipcRenderer.invoke('projects:list'),
  create:  (name: string): Promise<StoredProject> =>
    ipcRenderer.invoke('projects:create', { name }),
  rename:  (id: string, name: string): Promise<StoredProject> =>
    ipcRenderer.invoke('projects:rename', { id, name }),
  delete:  (id: string): Promise<void> =>
    ipcRenderer.invoke('projects:delete', { id }),
  onUpdate: (cb: (list: StoredProject[]) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, list: StoredProject[]): void => cb(list)
    ipcRenderer.on('projects:update', handler)
    return () => ipcRenderer.removeListener('projects:update', handler)
  }
}
```

Also add a `history.onUpdate` subscriber alongside the existing history bindings:

```ts
onUpdate: (cb: (list: HistoryEntry[]) => void): (() => void) => {
  const handler = (_e: Electron.IpcRendererEvent, list: HistoryEntry[]): void => cb(list)
  ipcRenderer.on('history:update', handler)
  return () => ipcRenderer.removeListener('history:update', handler)
}
```

- [ ] **Step 2: Mirror in `src/preload/index.d.ts`**

Add the same `StoredProject` interface and the `projects: { ... }` block + `history.onUpdate` to the `Api` interface declaration. Also add `projectId: string` to `HistoryEntry` and `lastProjectId: string | null` to `Settings` in the `.d.ts`.

- [ ] **Step 3: Typecheck**

`npm run typecheck` (both projects).
Expected: clean.

- [ ] **Step 4: Commit**

```
git commit -m "$(cat <<'EOF'
feat(preload): expose window.api.projects.* and history.onUpdate

Mirrors the workstations.* pattern. Adds projectId (required) to
HistoryEntry, lastProjectId (string|null) to Settings, and a new
StoredProject type re-exposed to the renderer.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Renderer types + `useProjects()` hook

**Files:**
- Modify: `src/renderer/src/types.ts`
- Create: `src/renderer/src/hooks/useProjects.ts`

- [ ] **Step 1: Re-export `StoredProject` from `src/renderer/src/types.ts`**

Append:

```ts
export type { StoredProject } from '@preload/index'
```

- [ ] **Step 2: Create `src/renderer/src/hooks/useProjects.ts`**

```ts
import { useEffect, useState, useCallback } from 'react'
import type { StoredProject } from '@preload/index'

interface UseProjectsReturn {
  projects: StoredProject[]
  loading: boolean
  create: (name: string) => Promise<StoredProject>
  rename: (id: string, name: string) => Promise<StoredProject>
  delete: (id: string) => Promise<void>
}

export function useProjects(): UseProjectsReturn {
  const [projects, setProjects] = useState<StoredProject[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void window.api.projects.list().then((list) => {
      if (cancelled) return
      setProjects(list)
      setLoading(false)
    })
    const unsub = window.api.projects.onUpdate((list) => {
      setProjects(list)
    })
    return () => {
      cancelled = true
      unsub()
    }
  }, [])

  const create = useCallback((name: string) => window.api.projects.create(name), [])
  const rename = useCallback((id: string, name: string) => window.api.projects.rename(id, name), [])
  const del = useCallback((id: string) => window.api.projects.delete(id), [])

  return { projects, loading, create, rename, delete: del }
}
```

- [ ] **Step 3: Typecheck**

`npm run typecheck:web` → clean.

- [ ] **Step 4: Commit**

```
git commit -m "$(cat <<'EOF'
feat(renderer): types + useProjects() hook

useProjects() subscribes to projects:update, exposes the project list
plus create/rename/delete wrappers. Mirrors useWorkstationPool().

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: ProjectSidebar component

**Files:**
- Create: `src/renderer/src/components/ProjectSidebar.tsx`
- Create: `src/renderer/src/components/ProjectSidebar.module.css`

- [ ] **Step 1: Create the component**

`src/renderer/src/components/ProjectSidebar.tsx`:

```tsx
import { useState } from 'react'
import type { StoredProject, HistoryEntry } from '@preload/index'
import styles from './ProjectSidebar.module.css'

interface Props {
  projects: StoredProject[]
  entries: HistoryEntry[]
  selectedId: string | null
  inboxId: string | null
  onSelect: (id: string) => void
  onCreate: (name: string) => Promise<unknown>
  onRename: (id: string, name: string) => Promise<unknown>
  onDelete: (id: string) => Promise<unknown>
}

function ProjectRow({
  p, count, active, isInbox, onSelect, onRename, onDelete
}: {
  p: StoredProject
  count: number
  active: boolean
  isInbox: boolean
  onSelect: () => void
  onRename: (name: string) => Promise<unknown>
  onDelete: () => Promise<unknown>
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(p.name)
  const [menuOpen, setMenuOpen] = useState(false)

  const commitRename = async (): Promise<void> => {
    if (draft.trim() && draft.trim() !== p.name) {
      await onRename(draft.trim())
    } else {
      setDraft(p.name)
    }
    setEditing(false)
  }

  return (
    <div className={[styles.row, active ? styles.active : ''].join(' ')}>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commitRename()
            if (e.key === 'Escape') { setDraft(p.name); setEditing(false) }
          }}
          className={styles.renameInput}
        />
      ) : (
        <button className={styles.rowLabel} onClick={onSelect}>
          <span className={styles.rowName}>{p.name}</span>
          <span className={styles.rowCount}>{count}</span>
        </button>
      )}
      <button
        className={styles.menuBtn}
        title="More"
        onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v) }}
      >⋯</button>
      {menuOpen && (
        <div className={styles.menu} onMouseLeave={() => setMenuOpen(false)}>
          <button onClick={() => { setMenuOpen(false); setEditing(true) }}>Rename</button>
          {!isInbox && (
            <button onClick={() => {
              setMenuOpen(false)
              if (window.confirm(`Delete "${p.name}" and all ${count} of its entries? This cannot be undone.`)) {
                void onDelete()
              }
            }}>Delete</button>
          )}
        </div>
      )}
    </div>
  )
}

export function ProjectSidebar(props: Props): React.JSX.Element {
  const { projects, entries, selectedId, inboxId, onSelect, onCreate, onRename, onDelete } = props
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')

  const counts = new Map<string, number>()
  for (const e of entries) counts.set(e.projectId, (counts.get(e.projectId) ?? 0) + 1)

  const commitCreate = async (): Promise<void> => {
    if (newName.trim()) {
      const p = await onCreate(newName.trim())
      onSelect((p as StoredProject).id)
    }
    setNewName('')
    setAdding(false)
  }

  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>Projects</div>
      {projects.map((p) => (
        <ProjectRow
          key={p.id}
          p={p}
          count={counts.get(p.id) ?? 0}
          active={p.id === selectedId}
          isInbox={p.id === inboxId}
          onSelect={() => onSelect(p.id)}
          onRename={(name) => onRename(p.id, name)}
          onDelete={() => onDelete(p.id)}
        />
      ))}
      {adding ? (
        <input
          autoFocus
          value={newName}
          placeholder="Project name"
          onChange={(e) => setNewName(e.target.value)}
          onBlur={commitCreate}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commitCreate()
            if (e.key === 'Escape') { setNewName(''); setAdding(false) }
          }}
          className={styles.addInput}
        />
      ) : (
        <button className={styles.addBtn} onClick={() => setAdding(true)}>+ New</button>
      )}
    </div>
  )
}

export default ProjectSidebar
```

- [ ] **Step 2: Create the CSS module**

`src/renderer/src/components/ProjectSidebar.module.css`:

```css
.sidebar {
  width: 200px;
  flex-shrink: 0;
  border-right: 1px solid var(--border, #2a2a2a);
  padding: 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: var(--bg-card, #1a1a1a);
}

.header {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  opacity: 0.6;
  padding: 0 8px 6px;
}

.row {
  position: relative;
  display: flex;
  align-items: center;
  border-radius: 4px;
}
.row:hover { background: var(--bg-elevated, #222); }
.active { background: var(--bg-elevated, #2a2a2a); }

.rowLabel {
  flex: 1;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 8px;
  background: none;
  border: none;
  color: inherit;
  text-align: left;
  cursor: pointer;
  font-size: 13px;
}

.rowName { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rowCount { opacity: 0.55; font-variant-numeric: tabular-nums; font-size: 11px; }

.menuBtn {
  width: 24px; height: 24px;
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.1s;
}
.row:hover .menuBtn { opacity: 0.7; }
.menuBtn:hover { opacity: 1; }

.menu {
  position: absolute;
  top: 100%;
  right: 0;
  background: var(--bg-card, #1f1f1f);
  border: 1px solid var(--border, #333);
  border-radius: 4px;
  z-index: 10;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
}
.menu button {
  display: block;
  width: 100%;
  padding: 6px 14px;
  background: none;
  border: none;
  color: inherit;
  text-align: left;
  cursor: pointer;
  font-size: 13px;
}
.menu button:hover { background: var(--bg-elevated, #2a2a2a); }

.renameInput, .addInput {
  flex: 1;
  padding: 4px 8px;
  background: var(--bg-elevated, #222);
  border: 1px solid var(--accent, #4ade80);
  border-radius: 4px;
  color: inherit;
  font-size: 13px;
}

.addBtn {
  margin-top: 6px;
  padding: 6px 8px;
  background: none;
  border: 1px dashed var(--border, #333);
  border-radius: 4px;
  color: inherit;
  cursor: pointer;
  font-size: 12px;
  opacity: 0.7;
}
.addBtn:hover { opacity: 1; }
```

- [ ] **Step 3: Typecheck**

`npm run typecheck:web` → clean.

- [ ] **Step 4: Commit**

```
git commit -m "$(cat <<'EOF'
feat(renderer): ProjectSidebar component

Vertical list of projects with entry counts, inline rename, ⋯ menu
for delete (hidden on Inbox row), + New inline create.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: GalleryView refactor — two-column + filter

**Files:**
- Modify: `src/renderer/src/views/GalleryView.tsx`
- Modify: `src/renderer/src/views/GalleryView.module.css`

- [ ] **Step 1: Read current `GalleryView.tsx`**

Note the current top-level render block (single column of entries).

- [ ] **Step 2: Wire in `ProjectSidebar` and filtering**

Add imports at top of `GalleryView.tsx`:

```tsx
import { useProjects } from '../hooks/useProjects'
import { ProjectSidebar } from '../components/ProjectSidebar'
```

Inside the `GalleryView` component, after the existing state declarations, add:

```tsx
const { projects, create, rename, delete: deleteProject } = useProjects()
const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)

// On project list change, default-select the first (Inbox) if nothing selected.
useEffect(() => {
  if (!selectedProjectId && projects.length > 0) {
    setSelectedProjectId(projects[0].id)
  }
}, [projects, selectedProjectId])

// Subscribe to history:update so cascade-deletes refresh the grid.
useEffect(() => {
  const unsub = window.api.history.onUpdate((list) => setEntries(list))
  return unsub
}, [])

const inboxId = projects[0]?.id ?? null
const visibleEntries = entries.filter((e) => e.projectId === selectedProjectId)
```

Update the existing `handleClear` to scope to the selected project:

```tsx
const handleClear = useCallback(async () => {
  if (!selectedProjectId) return
  const name = projects.find((p) => p.id === selectedProjectId)?.name ?? 'this project'
  const count = visibleEntries.length
  if (!window.confirm(`Remove all ${count} entries from "${name}"? This cannot be undone.`)) return
  // Remove each entry; broadcast will refresh.
  for (const e of visibleEntries) {
    await window.api.history.remove(e.id)
  }
}, [selectedProjectId, projects, visibleEntries])
```

Replace the return JSX. The new outer layout:

```tsx
return (
  <div className={styles.wrap}>
    <div className={styles.layout}>
      <ProjectSidebar
        projects={projects}
        entries={entries}
        selectedId={selectedProjectId}
        inboxId={inboxId}
        onSelect={setSelectedProjectId}
        onCreate={create}
        onRename={rename}
        onDelete={deleteProject}
      />
      <div className={styles.gridColumn}>
        {/* Existing header / clear button / grid markup — but iterate over
            visibleEntries instead of entries. */}
        {/* If your existing markup binds to `entries`, change to `visibleEntries`. */}
      </div>
    </div>
  </div>
)
```

**Important:** the existing render-loop probably says something like `{entries.map(...)}`. Change it to `{visibleEntries.map(...)}`. Everything else inside the grid column stays the same.

- [ ] **Step 3: Update CSS**

In `src/renderer/src/views/GalleryView.module.css`, add:

```css
.layout {
  display: flex;
  flex: 1;
  min-height: 0;
}
.gridColumn {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 0 12px;
}
```

If `.wrap` has `display: flex; flex-direction: column` already, keep it. The `.layout` row sits inside.

- [ ] **Step 4: Typecheck**

`npm run typecheck:web` → clean.

- [ ] **Step 5: Commit**

```
git commit -m "$(cat <<'EOF'
refactor(GalleryView): two-column with ProjectSidebar + filtering

Wires useProjects() + history:update subscription. Entries filter
client-side by selectedProjectId. "Clear gallery" is now scoped to
the active project. Inbox auto-selected when none chosen.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: GenerateView — "Save to" picker + sticky update

**Files:**
- Modify: `src/renderer/src/views/GenerateView.tsx`

- [ ] **Step 1: Wire in projects + state**

Add to imports at top:

```tsx
import { useProjects } from '../hooks/useProjects'
```

In the `GenerateView` component, add:

```tsx
const { projects } = useProjects()
const [saveTo, setSaveTo] = useState<string>('')

// Initialize saveTo from settings.lastProjectId (or first project if null).
useEffect(() => {
  void window.api.settings.get().then((s) => {
    if (s.lastProjectId) setSaveTo(s.lastProjectId)
    else if (projects.length > 0) setSaveTo(projects[0].id)
  })
}, [projects])
```

Add a Save-to row in the JSX near the Send button (before or after the Run-on row):

```tsx
<div className={styles.runOnRow}>
  <span>Save to:</span>
  <select
    value={saveTo}
    onChange={(e) => setSaveTo(e.target.value)}
    className={styles.select}
  >
    {projects.map((p) => (
      <option key={p.id} value={p.id}>{p.name}</option>
    ))}
  </select>
</div>
```

- [ ] **Step 2: Update the history.add call**

Find the existing `window.api.history.add(...)` call (fires when a job completes) and add `projectId: saveTo` to the entry. Then bump sticky:

```tsx
await window.api.history.add({
  // ...existing fields...
  projectId: saveTo
})
// Bump sticky default if changed.
const current = await window.api.settings.get()
if (current.lastProjectId !== saveTo) {
  await window.api.settings.set({ lastProjectId: saveTo })
}
```

- [ ] **Step 3: Typecheck**

`npm run typecheck:web` → clean.

- [ ] **Step 4: Commit**

```
git commit -m "$(cat <<'EOF'
feat(GenerateView): Save to picker + sticky lastProjectId

Dropdown next to Send chooses which project the resulting entry lands
in. Initial value reads settings.lastProjectId; on each submit, if
the selection changed, settings.lastProjectId is bumped for next time.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Acceptance walk-through

**Files:** none modified.

- [ ] **Step 1: Run the full test suite**

`npm test`
Expected: all suites pass (existing 49 + new projectsStore (12) + new historyStore (3) + updated store (3 new) = 67 total).

- [ ] **Step 2: Typecheck**

`npm run typecheck` (both projects).
Expected: clean.

- [ ] **Step 3: Boot the app**

```
unset ELECTRON_RUN_AS_NODE
npm run dev
```

Verify:
- App boots without renderer-console errors.
- Gallery view shows the ProjectSidebar with Inbox on top.
- Existing seeded entries appear inside Inbox.

- [ ] **Step 4: Verify spec §6 acceptance criteria**

1. **Migration** — open app → Inbox appears in sidebar, all existing entries visible inside it. ✓
2. **Create** — `+ New` → enter "Logos" → row appears, empty count. ✓
3. **Switch active** — click Logos → grid empties. ✓
4. **Generate into project** — switch to Logos in Generate's "Save to" → submit → entry appears in Logos when job completes; Inbox count unchanged. ✓
5. **Sticky** — close app, reopen → Generate's "Save to" still reads "Logos". ✓
6. **Rename** — ⋯ menu → Rename → "Logos v2" → row updates, entries remain. ✓
7. **Delete (empty)** — delete an empty project → confirm shows 0 → row disappears. ✓
8. **Delete (cascade)** — delete a project with entries → confirm shows exact count → on confirm, project + entries gone; sticky default falls back to Inbox if it pointed to deleted project. ✓
9. **Inbox protection** — Inbox row has no Delete in menu; calling the IPC channel directly throws. ✓
10. **Renderer crash recovery** — close app mid-rename → reopen → state is consistent. ✓

For each: perform the action, visually confirm.

- [ ] **Step 5: Final commit (if bug fixes were needed)**

```
git commit -m "fix(phase-2): <describe>

Resolved during acceptance walk-through."
```

- [ ] **Step 6: Update roadmap**

Edit `docs/superpowers/specs/2026-05-19-flova-clone-roadmap.md`. Change the Phase 2 row:

```
| 2 | Projects | ✅ Shipped | 1 | <latest hash> |
```

Commit:

```
git commit -m "docs(roadmap): mark Phase 2 shipped"
```

---

## Final checklist

- [ ] All 10 tasks above completed
- [ ] `npm test` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run dev` boots without renderer-console errors
- [ ] All 10 spec §6 acceptance criteria pass
- [ ] Roadmap updated

## Notes for the executor

- **Do not skip the TDD steps.** Tasks 0, 1, 2 are pure-logic with full TDD — write tests first.
- **Each task is a self-contained commit.** Don't bundle tasks.
- **If a test fails after your implementation matches the plan verbatim, the plan has a bug — push back rather than tweak the test.** Likely sources: missing `await`, mock setup, or a Map/Set ordering assumption.
- **The Task 2 typecheck-fix-now / Task 4 real-fix sequence is intentional.** Task 2 stages a placeholder so the commit can land cleanly; Task 4 replaces it with the real resolution chain.
