# Phase 2: Projects — Design Spec

> **Status:** Approved (2026-05-20).
> **Depends on:** Phase 0 (gallery, history.json), Phase 1 (settings v2, atomic write infra).
> **Roadmap row:** Phase 2 — *Organize Gallery entries into projects.*

## Goal

Add a single layer of grouping to the gallery: every generation belongs to exactly one project. The user can create / rename / delete projects, switch the active project in Gallery via a sidebar, and choose where new generations land at Send time.

## Non-goals

- Multiple projects per entry (no tags).
- Shared per-project defaults (no per-project checkpoint, LoRAs, style presets — that's later phase work).
- Per-deliverable tracking (timelines, shot lists, progress) — those belong to Phase 4/7.
- Nested projects / folder hierarchies.

## Design summary

Three additions:

1. **`projects.json`** — a new persistence file holding the project list.
2. **`HistoryEntry.projectId`** — required FK from each gallery entry to a project.
3. **Sidebar UI** on Gallery + a **Save-to picker** on Generate, with sticky "last used" memory.

On first boot after upgrade, a default project named **Inbox** is created and every existing entry is reassigned to it. Inbox is special: it cannot be deleted.

---

## 1. Data model & persistence

### `projects.json`

Located at `%APPDATA%/digitalassets/projects.json`. Atomic write via tmp + rename, matching `store.ts`.

```ts
export interface StoredProject {
  id: string         // UUID
  name: string       // trimmed; non-empty after trim
  createdAt: number  // epoch ms
}

export type ProjectsFile = StoredProject[]
```

The list is sorted by `createdAt asc` on read so Inbox (the first project created) is always first.

### `HistoryEntry` shape change

```ts
export interface HistoryEntry {
  // ...existing fields...
  projectId: string  // REQUIRED — FK into projects.json
}
```

### `settings.json` v3

```ts
export interface SettingsV3 extends SettingsV2 {
  version: 3
  lastProjectId: string | null  // sticky default for Generate
}
```

Bumped from v2 → v3 with the same `migrateSettings` pattern. `lastProjectId` initialized to the Inbox id during migration.

### Modules

| Path | Responsibility |
|---|---|
| `src/main/projectsStore.ts` | Project CRUD + atomic write. Mirrors `historyStore.ts`. Exports `listProjects`, `addProject`, `renameProject`, `deleteProject`, `getProject(id)`. |
| `src/main/historyStore.ts` | Gains `removeByProject(projectId)`. Existing functions unchanged except `addHistoryEntry` now requires `projectId`. |
| `src/main/store.ts` | v2 → v3 migration via extended `migrateSettings`. |

---

## 2. IPC surface

New file `src/main/ipc/projects.ts` registering:

| Channel | Args | Returns | Semantics |
|---|---|---|---|
| `projects:list` | — | `StoredProject[]` | Sorted by `createdAt asc`. |
| `projects:create` | `{ name: string }` | `StoredProject` | UUID generated, `createdAt = Date.now()`. Rejects empty/whitespace name. |
| `projects:rename` | `{ id, name }` | `StoredProject` | Rejects empty name. Renaming Inbox is allowed (it's just a name). |
| `projects:delete` | `{ id }` | `void` | **Cascade-deletes** all entries with this `projectId` via `historyStore.removeByProject`. Throws `"Inbox cannot be deleted"` if `id === inboxId`. |

Modified channels:

| Channel | Change |
|---|---|
| `history:add` | Accepts `projectId`; if absent, falls back to `getSettings().lastProjectId` then to Inbox. |
| `settings:set` | Unchanged shape; `lastProjectId` flows through `Partial<Settings>` like any other field. |

Pool/job channels (`workstations:*`, `comfy:*`) unchanged.

### Broadcast events

| Event | Payload | When |
|---|---|---|
| `projects:update` | `StoredProject[]` | After any create/rename/delete |
| `history:update` | `HistoryEntry[]` | After cascade-delete of entries (new event — history channel currently has no such broadcast; this task adds it) |

Renderer subscribes via `window.api.projects.onUpdate(cb)` and `window.api.history.onUpdate(cb)`.

### Preload bindings

```ts
window.api.projects = {
  list:    () => Promise<StoredProject[]>,
  create:  (name: string) => Promise<StoredProject>,
  rename:  (id: string, name: string) => Promise<StoredProject>,
  delete:  (id: string) => Promise<void>,
  onUpdate: (cb: (list: StoredProject[]) => void) => () => void
}
```

Mirrors `window.api.workstations.*` shape from Phase 1.

---

## 3. Renderer components

### `ProjectSidebar.tsx` (new)

Vertical column on the left of `GalleryView`. Each row:

```
<project-name>   <count>
```

Count is the number of entries with this `projectId` in the loaded history.

- **Click row** → calls `onSelect(projectId)`. Active row highlighted.
- **Right-click / ⋯ menu**: Rename, Delete. (Inbox row hides Delete.)
- **+ New** button at bottom → inline input → Enter calls `projects:create`.

Delete opens a confirm modal:

> Delete "Logos" and all 7 of its entries? This cannot be undone.
> [Cancel] [Delete]

### `GalleryView.tsx` (modified)

Layout becomes `[ProjectSidebar | grid]`. The grid filters to entries whose `projectId === selectedProjectId`. Filtering is client-side; no extra IPC fetch on project switch.

The existing "Clear gallery" button becomes "Clear this project" — same as deleting the project's entries (but keeps the project record itself).

### `GenerateView.tsx` (modified)

New row near Send button:

```
Save to: [Inbox ▼]
```

- Dropdown lists all projects.
- Initial value: `settings.lastProjectId` (or Inbox if null).
- On successful submit, if selection != `lastProjectId`, calls `settings.set({lastProjectId: <id>})`.
- The `history.add` call (when the job finishes) includes `projectId`.

### `useProjects()` hook (new)

Mirrors `useWorkstationPool()`:

```ts
const { projects, loading, create, rename, delete: deleteProject } = useProjects()
```

Subscribes to `projects:update`. Exposes wrappers around IPC. Empty deps in useCallback wrappers.

---

## 4. Data flow

### Migration (one-shot on first boot post-upgrade)

```
1. Read settings.json
2. If version === 3, skip migration
3. Read projects.json (or [] if missing)
4. If no project exists yet:
   a. Create { id: <uuid>, name: 'Inbox', createdAt: now }
   b. Write projects.json
5. Read history.json (or [] if missing)
6. For each entry where projectId is missing or invalid:
   a. Set projectId = inboxId
7. Write history.json
8. Write settings.json with version: 3, lastProjectId: inboxId
```

All three writes use the existing atomic tmp + rename. Failures partway leave the system in a recoverable state: the next boot reruns migration.

### Create entry from Generate

```
1. User clicks Send → workflow built → pool.submit(...)
2. Job reaches 'done' status
3. Renderer calls history.add({...entry, projectId: form.projectId})
4. If form.projectId !== settings.lastProjectId:
     settings.set({ lastProjectId: form.projectId })
5. Renderer adds entry to local list; Gallery sidebar count for that project increments via re-render
```

### Delete project

```
1. User picks Delete in sidebar context menu → confirm modal opens
2. User confirms → window.api.projects.delete(id)
3. Main process:
   a. If id === inboxId → throw "Inbox cannot be deleted"
   b. historyStore.removeByProject(id) — removes matching entries, writes history.json
   c. Remove from projects.json, write file
   d. If settings.lastProjectId === id → settings.set({ lastProjectId: inboxId })
   e. Emit 'projects:update' and 'history:update' events to all windows
4. Renderer: ProjectSidebar refreshes, Gallery grid refreshes, sticky default falls back to Inbox if needed
```

### Rename project

```
1. User inline-edits row → window.api.projects.rename(id, newName)
2. Main: trim + validate non-empty, write projects.json
3. Emit 'projects:update'
4. Renderer: row updates in place
```

---

## 5. Error handling

| Condition | Behavior |
|---|---|
| Create with empty/whitespace name | Main throws `'Name required'`. Renderer surfaces in the inline input (`✗ Name required`). |
| Rename to empty | Same handling as create. |
| Rename / delete with unknown id | Main throws `'Project not found'`. Renderer shows a toast and refreshes the sidebar (likely a stale UI). |
| Delete Inbox | Main throws `"Inbox cannot be deleted — it's the default"`. UI prevents this by hiding the Delete option on the Inbox row; throw is defense in depth. |
| Duplicate project name | Allowed. Folders can share names; uniqueness is by id. No warning. |
| File write failure on cascade-delete | Atomic per file. If projects.json write fails after history.json wrote: orphaned entries get cleaned up on next boot's migration (re-pointed to Inbox). |
| User opens app for the first time post-upgrade and migration runs | One-time cost of reading/writing all three files. For the seeded set (7 entries) this is sub-millisecond. |

---

## 6. Testing

### TDD (vitest, follows Phase 1 pattern)

| File | What it covers |
|---|---|
| `src/main/__tests__/projectsStore.test.ts` (new) | list / add / rename / delete; rejects empty name; cascade-delete via removeByProject hook; atomic write semantics |
| `src/main/__tests__/historyStore.test.ts` (new) | `removeByProject(projectId)` removes only matching entries, leaves others intact |
| `src/main/__tests__/store.test.ts` (modified) | v2 → v3 migration creates Inbox, assigns existing entries, sets lastProjectId |

All pure-logic tests — no Electron, no fs mocking beyond the existing patterns.

### Manual acceptance criteria (Task 22-equivalent walk-through)

1. **Migration** — open app with v2 settings + entries → Inbox appears in sidebar, all existing entries visible inside it.
2. **Create** — `+ New` → enter "Logos" → row appears, empty count.
3. **Switch active** — click Logos row → grid empties (no entries yet).
4. **Generate into project** — switch to Logos in Generate's "Save to" → submit → entry appears in Logos when job completes; Inbox count unchanged.
5. **Sticky** — close app, reopen → Generate's "Save to" still reads "Logos".
6. **Rename** — right-click row → Rename → "Logos v2" → row updates, entries remain.
7. **Delete (empty)** — delete an empty project → row disappears, no confirm needed if 0 entries (still show confirm but with "and 0 entries").
8. **Delete (cascade)** — delete a project with entries → confirm shows exact count → on confirm, project + entries gone; sticky default falls back to Inbox if it pointed to deleted project.
9. **Inbox protection** — Inbox row has no Delete option in menu; calling IPC directly throws.
10. **Renderer crash recovery** — close app mid-rename → reopen → state is consistent (either rename committed or not).

---

## 7. Files map

### New files

| Path | LOC est. | Responsibility |
|---|---|---|
| `src/main/projectsStore.ts` | ~80 | Project CRUD + atomic write |
| `src/main/ipc/projects.ts` | ~50 | IPC handlers + broadcasts |
| `src/main/__tests__/projectsStore.test.ts` | ~80 | TDD |
| `src/main/__tests__/historyStore.test.ts` | ~50 | `removeByProject` tests |
| `src/renderer/src/hooks/useProjects.ts` | ~50 | Subscribe + actions |
| `src/renderer/src/components/ProjectSidebar.tsx` | ~120 | Sidebar UI |
| `src/renderer/src/components/ProjectSidebar.module.css` | ~70 | Styles |

### Modified files

| Path | Change |
|---|---|
| `src/main/store.ts` | v3 schema + migration extension |
| `src/main/historyStore.ts` | `addHistoryEntry` requires projectId; add `removeByProject` |
| `src/main/ipc/index.ts` | Register `registerProjectHandlers()` |
| `src/main/ipc/history.ts` | Default projectId fallback; emit `history:update` on cascade-delete path |
| `src/preload/index.ts` | Add `window.api.projects.*` + onUpdate; extend Settings type for `lastProjectId` |
| `src/preload/index.d.ts` | Same |
| `src/renderer/src/types.ts` | Re-export `StoredProject` |
| `src/renderer/src/views/GalleryView.tsx` | Two-column layout + filtering |
| `src/renderer/src/views/GalleryView.module.css` | Two-column layout styles |
| `src/renderer/src/views/GenerateView.tsx` | Save-to dropdown + sticky update |

Total: ~7 new files, 10 modified. Estimated ~600 LOC.

---

## 8. Risks & open questions

| Risk | Mitigation |
|---|---|
| User has existing v1 settings (still on Phase 0) and skips Phase 1 migration | Phase 1 migrates v1→v2 already. Phase 2 migrates v2→v3. Both run on boot, so a Phase 0 user upgrading directly to Phase 2 gets both migrations in one pass. |
| Stale `lastProjectId` after the referenced project is deleted | Cascade-delete logic resets it to Inbox in the same write batch. |
| Settings file write race during cascade-delete | Files written sequentially: history, then projects, then settings. Each individually atomic. Worst case mid-failure: history orphans cleaned by next-boot migration. |
| Renderer count badges go stale after rapid create+delete | All updates broadcast `projects:update` + `history:update`. Sidebar listens to both. |

No open questions — design is internally consistent with the constraints decided in brainstorming.

---

## 9. Out of scope (intentional)

- Multi-select / drag-to-project moves (post-MVP polish, ~Phase 2.1 if needed).
- Project icons / colors.
- Per-project default model picker — that's the **checkpoint picker** feature from the same session, which can land as a small Phase 1.5 in parallel or as part of Phase 4.
- Search across projects.
- Import / export projects.

These are all reasonable future additions but adding any of them now blurs the "loose grouping" focus.
