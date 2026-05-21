# Phase 3: Characters Library — Design Spec

> **Status:** Approved (2026-05-21).
> **Depends on:** Phase 1 (settings v3, workstation pool, per-model scheduler), Phase 2 (sidebar pattern in Gallery, IPC broadcast pattern).
> **Roadmap row:** Phase 3 — *Characters library — Reusable subjects + reference images.*
> **Unblocks:** Phase 5 (360° Character consistency / multi-angle batch).

## Goal

A library of reusable Characters, each carrying identity-defining metadata (name, description, trigger word, LoRA, reference images) that can be applied to any generation. Picking a character on Generate composes its description into the prompt, swaps in its LoRA / checkpoint, and uploads its reference images into an IPAdapter chain in the workflow — so the same subject can appear consistently across many generations.

## Non-goals

- 360° multi-angle batch generation — Phase 5.
- Per-character generation defaults beyond LoRA + checkpoint (no CFG / sampler / size overrides).
- Filter Gallery by character — would require `HistoryEntry.characterIds`. Out for now; trivial future addition.
- Character versioning, branching, or training-LoRA-from-references. Out.

## Design summary

Three additions:

1. **`characters.json`** — new persistence file holding character metadata.
2. **`userData/characters/<id>/refs/`** — per-character folder for reference image files.
3. **Workflow extension** — when a character is passed to `buildImageWorkflow`, it composes prompt, swaps checkpoint, inserts LoraLoader, uploads reference images to ComfyUI, and inserts an IPAdapter chain.

Three UI surfaces:

1. **Third sidebar in Gallery** — `[Projects | grid | Characters]` three-column layout.
2. **`CharacterDetail` modal** — edit name / description / trigger / LoRA / checkpoint / weights, manage reference images.
3. **`CharacterPicker` on Generate** — compact dropdown that injects the picked character into the workflow.

---

## 1. Data model

### `characters.json`

Located at `%APPDATA%/digitalassets/characters.json`. Atomic write via tmp + rename, matching `projectsStore.ts`.

```ts
export interface StoredCharacter {
  id: string                       // UUID
  name: string                     // trimmed, non-empty after trim
  description: string              // prepended to prompt; may be empty string
  triggerWord: string | null       // inserted after description; may be null
  loraName: string | null          // ComfyUI lora filename, e.g. "aria_v1.safetensors"
  loraWeight: number               // 0.0–2.0, default 0.8
  defaultCheckpoint: string | null // optional checkpoint override
  referenceImages: string[]        // absolute paths under userData/characters/<id>/refs/
  ipAdapterWeight: number          // 0.0–1.0, default 0.6
  createdAt: number                // epoch ms
}

export type CharactersFile = StoredCharacter[]
```

The list is sorted by `name asc` on read.

### Reference image storage

```
%APPDATA%/digitalassets/characters/<character-id>/refs/<uuid>.<ext>
```

- On `addReference`: the source file is **copied** (not moved) into `refs/`, given a UUID filename, and its absolute path is appended to `referenceImages`. The original source is not touched.
- On `removeReference`: the file is deleted and the path is removed from `referenceImages`.
- On `characters:delete`: the entire `<character-id>/` folder is removed (`rm -rf`-equivalent), then the record is dropped from `characters.json`.

### Cap

Maximum **10 reference images per character**, enforced in `addReference`. The UI surfaces the cap. Phase 5 may raise this once batch generation matters.

### Modules

| Path | Responsibility |
|---|---|
| `src/main/charactersStore.ts` | CRUD + atomic write. `listCharacters`, `getCharacter`, `addCharacter`, `updateCharacter(id, patch)`, `deleteCharacter`, `addReference(id, sourcePath)`, `removeReference(id, refPath)`. |

`HistoryEntry` and `settings.json` are unchanged.

---

## 2. IPC surface

New file `src/main/ipc/characters.ts` registering:

| Channel | Args | Returns | Semantics |
|---|---|---|---|
| `characters:list` | — | `StoredCharacter[]` | Sorted by `name asc`. |
| `characters:create` | `{ name, description?, triggerWord?, loraName?, loraWeight?, defaultCheckpoint?, ipAdapterWeight? }` | `StoredCharacter` | UUID generated, defaults filled (`loraWeight=0.8`, `ipAdapterWeight=0.6`, `description=''`, `referenceImages=[]`). Folder created. Rejects empty/whitespace name. |
| `characters:update` | `{ id, patch: Partial<...> }` | `StoredCharacter` | Partial merge. Rejects empty-after-trim name. Rejects unknown id. `referenceImages` is **not** mutable via this channel — use the dedicated ref channels. |
| `characters:delete` | `{ id }` | `void` | Removes `<id>/` folder recursively, then removes record. Rejects unknown id. |
| `characters:addReference` | `{ id, sourcePath }` | `string` (the new ref path) | Validates: char exists, sourcePath exists, count < 10. Copies file into `refs/<uuid>.<ext>`, appends to `referenceImages`, persists, returns the new path. |
| `characters:removeReference` | `{ id, refPath }` | `void` | Deletes file if it's inside the character's `refs/` folder (defense against path traversal). Removes from array, persists. |

### Broadcast events

| Event | Payload | When |
|---|---|---|
| `characters:update` | `StoredCharacter[]` | After any create / update / delete / ref-image change |

### Modified files

| Path | Change |
|---|---|
| `src/main/ipc/index.ts` | Register `registerCharacterHandlers()` after `registerProjectHandlers()` |
| `src/preload/index.ts` + `.d.ts` | Expose `window.api.characters.*` + `StoredCharacter` type |

### Preload bindings

```ts
window.api.characters = {
  list:    () => Promise<StoredCharacter[]>,
  create:  (input: Partial<StoredCharacter> & { name: string }) => Promise<StoredCharacter>,
  update:  (id: string, patch: Partial<StoredCharacter>) => Promise<StoredCharacter>,
  delete:  (id: string) => Promise<void>,
  addReference:    (id: string, sourcePath: string) => Promise<string>,
  removeReference: (id: string, refPath: string) => Promise<void>,
  onUpdate: (cb: (list: StoredCharacter[]) => void) => () => void
}
```

---

## 3. Workflow integration

### `buildImageWorkflow` extension

`src/main/services/workflow.ts` — extend `BuildImageWorkflowOptions`:

```ts
export interface BuildImageWorkflowOptions {
  // ...existing fields...
  character?: StoredCharacter
  /** Set by submission flow after /upload/image: maps absolute local ref path → ComfyUI input filename. */
  uploadedReferenceFilenames?: Record<string, string>
}
```

When `character` is present, the builder applies these transforms **in order**:

1. **Prompt composition.** Final prompt = `[character.description, character.triggerWord, opts.prompt].filter(Boolean).join(', ')`. The negative prompt is unchanged.
2. **Checkpoint swap.** If `character.defaultCheckpoint` is set **and** `opts.checkpoint` was not explicitly passed, use the character's checkpoint.
3. **LoraLoader insertion.** If `character.loraName` is set, insert a `LoraLoader` node between `CheckpointLoaderSimple` (node `4`) and `KSampler` (node `3`). The KSampler's `model` input now points at the LoraLoader's output. `strength_model = strength_clip = character.loraWeight`.
4. **IPAdapter chain.** If `character.referenceImages.length > 0` **and** `uploadedReferenceFilenames` is populated for those paths:
   - Add one `LoadImage` node per reference image (using the uploaded filename from `uploadedReferenceFilenames`).
   - Add an `IPAdapterUnifiedLoader` node taking the (possibly LoRA-wrapped) model output.
   - Add `IPAdapter` nodes that wrap the unified-loader output, each taking a `LoadImage` output as the `image` input, with `weight = character.ipAdapterWeight`.
   - The KSampler's `model` input now points at the final `IPAdapter` output (chained, one per reference).
   - **Canonical node names from `ComfyUI_IPAdapter_plus`** — `IPAdapterUnifiedLoader` and `IPAdapter`. If the workstation has a different fork, the spec's node names won't match and submission fails — surfaced as a per-workstation error.

If `character` is set but `referenceImages` is empty: skip step 4. Prompt + LoRA + checkpoint still apply.

### Submission flow change

`WorkstationPool.submit` gains a pre-submit hook:

```
1. If workflow.options.character?.referenceImages?.length > 0:
   a. For each ref path, POST to ${ws.url}/upload/image (multipart, with the file bytes).
   b. ComfyUI returns the filename it stored (under its input/ folder).
   c. Build uploadedReferenceFilenames map { absolute-local-path → comfy-filename }.
   d. Pass this into the workflow builder so LoadImage nodes reference the uploaded filenames.
2. POST /prompt as before.
```

A failed `/upload/image` for any single ref image fails the whole job with a clear error (`"Could not upload reference image: <reason>"`).

### Missing IPAdapter on workstation

If the workstation doesn't have `ComfyUI_IPAdapter_plus` installed, ComfyUI's `/prompt` returns 400 with a node-validation error. Pool surfaces this as the job error: `"Workstation 'X' rejected: missing node IPAdapterUnifiedLoader"`. **Phase 5** adds IPAdapter detection to the per-model scheduler so routing avoids workstations without it. For Phase 3, the error message is sufficient.

---

## 4. Renderer

### `useCharacters()` hook (new)

`src/renderer/src/hooks/useCharacters.ts`:

```ts
const { characters, loading, create, update, delete: deleteChar,
        addReference, removeReference } = useCharacters()
```

Subscribes to `characters:update`. Mirrors `useProjects()`.

### `CharactersSidebar.tsx` (new)

Third sidebar in Gallery's three-column layout. Each row:

```
[thumbnail] <name>   <ref count>
```

Thumbnail = first reference image, or a placeholder glyph if none. Click row → opens `CharacterDetail` modal. `+ New` at bottom → inline name input → Enter calls `characters.create({ name })`.

### `CharacterDetail.tsx` (new)

Modal with two columns:

**Left column — fields:**
- Name (text input)
- Description (textarea)
- Trigger word (text input, optional)
- LoRA (dropdown populated from union of all workstation `models.loras` + None option)
- LoRA weight (slider 0–2, default 0.8)
- Default checkpoint (dropdown from union of all `models.checkpoints` + None option)
- IPAdapter weight (slider 0–1, default 0.6)
- Save / Cancel

**Right column — reference images:**
- Grid of 64×64 thumbnails, each with a ✕ remove button
- "+ Add image" button → opens file picker → calls `addReference`
- Drag-drop zone surrounding the grid: `ondrop` extracts `event.dataTransfer.files[0].path` (Electron provides `.path` natively), calls `addReference`
- Disabled when count reaches 10; banner says "Cap reached".

Save button calls `characters.update(id, patch)`. Modal closes on Save success or Cancel.

### `CharacterPicker.tsx` (new)

Compact `Character: [None ▼]` dropdown shown on Generate. Options:
- None (default — no character applied)
- One option per character (sorted by name)
- `+ Manage…` at the bottom — opens the `CharacterDetail` modal for whichever character is currently picked (or a fresh create if None).

When the user picks a non-None character, GenerateView stores `selectedCharacterId`. On Send, this gets resolved to the full `StoredCharacter` and passed into the workflow build.

### Modified renderer files

| Path | Change |
|---|---|
| `src/renderer/src/views/GalleryView.tsx` | Add `<CharactersSidebar>` as third column. Layout becomes `[ProjectSidebar | grid | CharactersSidebar]`. |
| `src/renderer/src/views/GalleryView.module.css` | Three-column layout |
| `src/renderer/src/views/GenerateView.tsx` | Add `<CharacterPicker>` row above (or below) the "Save to" row. Pass character into workflow build. Wire up gallery's right-click "Use as reference for…" via context menu. |
| `src/renderer/src/views/GenerateView.module.css` | Layout adjustment for the new row |
| `src/renderer/src/types.ts` | Re-export `StoredCharacter` |
| `src/renderer/src/components/GalleryItem.tsx` (or wherever gallery entries render) | Add right-click context menu item "Use as reference for…" → submenu of characters → triggers `addReference` |

---

## 5. Data flow

### Create character

```
User clicks +New in CharactersSidebar → enters name "Aria" → Enter
→ characters.create({ name: 'Aria' }) IPC
→ Main: charactersStore.addCharacter({ name }) → mkdir refs folder
→ Broadcast characters:update
→ Renderer: useCharacters() re-renders; row appears
```

### Add reference (drag-drop)

```
User drops aria.png onto CharacterDetail's ref area
→ ondrop reads file.path
→ characters.addReference({ id, sourcePath: file.path })
→ Main: validate count<10, copy file → refs/<uuid>.png, append to array, persist
→ Returns the new ref path; broadcast characters:update
→ Renderer: grid re-renders with the new thumb
```

### Generate with character

```
User in Generate picks Aria → selectedCharacterId='aria-id' → types "in a forest" → clicks Send
→ Resolve character from useCharacters().characters
→ Call pool.submit({ workflow: buildImageWorkflow({prompt, character}), hints: {...} })
→ WorkstationPool.submit:
   a. Sees workflow.character.referenceImages.length > 0
   b. POSTs each ref to ws.url/upload/image
   c. Rebuilds the workflow with the returned ComfyUI input filenames in LoadImage nodes
   d. POSTs to /prompt
→ Pool tracks the job, output image flows back as normal
→ history.add({...entry, projectId: form.projectId}) — no characterId stored
```

### Delete character

```
User → right-click row → Delete → confirm modal "Delete 'Aria' and 5 ref images?"
→ characters.delete({ id }) IPC
→ Main: rm -rf refs folder, remove record, persist, broadcast
→ Renderer: row gone
```

---

## 6. Error handling

| Condition | Behavior |
|---|---|
| Create / rename to empty | Main throws `'Name required'`. UI surfaces in input. |
| Update or delete with unknown id | Main throws `'Character not found'`. UI shows toast + refreshes list. |
| `addReference` over the 10 cap | Main throws `'Reference image cap reached (10)'`. UI disables the +Add button proactively. |
| `addReference` with sourcePath that doesn't exist | Main throws `'Source file not found'`. |
| `removeReference` with refPath outside the character's folder | Main throws `'Invalid reference path'` (path traversal defense). |
| File copy failure (disk full, permissions) | Main throws the OS error; UI surfaces it. |
| `/upload/image` to ComfyUI fails | `pool.submit` fails the job with `'Could not upload reference image: <reason>'`. Job status = error, visible in QueuePanel. |
| ComfyUI doesn't have `IPAdapterUnifiedLoader` node | `/prompt` returns 400; pool surfaces `"Workstation 'X' rejected: missing node IPAdapterUnifiedLoader"`. |
| LoRA filename specified but not on any workstation | Per-model scheduler returns no workstation; pool fails the job with `"No workstation has this checkpoint/LoRA"` (existing Phase 1 behavior). |

---

## 7. Testing

### TDD (vitest, mirrors Phase 1+2 patterns)

| File | What it covers |
|---|---|
| `src/main/__tests__/charactersStore.test.ts` (new) | list / add / update / delete; addReference happy path + cap + missing source + path traversal; removeReference happy path + outside-folder rejection; cascade delete removes folder |
| `src/main/__tests__/workflow.test.ts` (extended) | New cases: prompt composition with character (description + trigger + user prompt); LoraLoader insertion; checkpoint swap; IPAdapter node injection given uploaded filenames; no-character path still works (regression) |

All pure-logic. No Electron, no real fs in tests beyond a tmp dir.

### Manual acceptance walk-through

See §8 below — 10 criteria.

---

## 8. Acceptance criteria

1. **Create** — Characters sidebar starts empty → click `+ New` → enter "Aria" → row appears with placeholder thumbnail.
2. **Edit fields** — Click row → modal opens → set description, trigger word, pick LoRA + weight → Save → values persist.
3. **Add ref images (upload)** — In modal, "+ Add image" → file picker → pick PNG → thumbnail appears, file lands at `userData/characters/<id>/refs/`.
4. **Add ref images (drag-drop)** — Drop file onto ref area → same result.
5. **Add ref from gallery** — Right-click a gallery entry → "Use as reference for…" → submenu → pick Aria → file copied; modal/sidebar reflect the addition.
6. **Remove ref image** — Click ✕ on a ref thumbnail → file deleted from disk, removed from array.
7. **10-image cap** — Add 10 refs → "+ Add image" disabled with "Cap reached" banner.
8. **Use in Generate (no refs)** — Pick a character without ref images → prompt = description + trigger + user prompt; LoRA loaded if set; checkpoint swapped if set. Output reflects the LoRA.
9. **Use in Generate (with refs)** — Pick a character with 2 refs → submission uploads both to ComfyUI, workflow has 2 LoadImage + IPAdapter chain; output reflects character likeness.
10. **Delete character** — ⋯ menu → Delete → confirm → sidebar row gone, folder gone, characters.json no longer lists the record.

11. **Missing IPAdapter graceful error** — On a workstation without `ComfyUI_IPAdapter_plus`, submit a character with ref images → job errors with a message naming the missing node. The character itself is unaffected.

12. **Renderer crash recovery** — Close app mid-edit → reopen → state is consistent (either save committed or not; no half-written file).

---

## 9. Files map

### New files

| Path | LOC est. | Responsibility |
|---|---|---|
| `src/main/charactersStore.ts` | ~140 | CRUD + atomic write + ref-image folder ops |
| `src/main/ipc/characters.ts` | ~80 | IPC handlers + broadcast |
| `src/main/__tests__/charactersStore.test.ts` | ~150 | TDD |
| `src/renderer/src/hooks/useCharacters.ts` | ~55 | Subscribe + actions |
| `src/renderer/src/components/CharactersSidebar.tsx` | ~120 | Sidebar UI |
| `src/renderer/src/components/CharactersSidebar.module.css` | ~70 | Styles |
| `src/renderer/src/components/CharacterDetail.tsx` | ~220 | Modal: fields + ref grid + DnD |
| `src/renderer/src/components/CharacterDetail.module.css` | ~120 | Styles |
| `src/renderer/src/components/CharacterPicker.tsx` | ~70 | Dropdown for Generate |
| `src/renderer/src/components/CharacterPicker.module.css` | ~30 | Styles |

### Modified files

| Path | Change |
|---|---|
| `src/main/services/workflow.ts` | `BuildImageWorkflowOptions.character`; prompt composition; LoraLoader; IPAdapter chain |
| `src/main/services/workstationPool.ts` | `submit()` uploads ref images via `/upload/image` before POSTing `/prompt` |
| `src/main/__tests__/workflow.test.ts` (or new) | TDD for the workflow extension |
| `src/main/ipc/index.ts` | Register `registerCharacterHandlers()` |
| `src/preload/index.ts` + `index.d.ts` | Expose `window.api.characters.*` + `StoredCharacter` |
| `src/renderer/src/types.ts` | Re-export `StoredCharacter` |
| `src/renderer/src/views/GalleryView.tsx` | Add third column (CharactersSidebar) |
| `src/renderer/src/views/GalleryView.module.css` | Three-column layout |
| `src/renderer/src/views/GenerateView.tsx` | Add CharacterPicker; pass character to workflow build |
| `src/renderer/src/views/GenerateView.module.css` | Layout adjustment |
| `src/renderer/src/views/GalleryView.tsx` (gallery item) | Add right-click "Use as reference for…" context menu (or extract `GalleryItem` if cleaner) |

Total: 10 new files, 11 modified. Estimated ~1100 LOC.

---

## 10. Risks & open questions

| Risk | Mitigation |
|---|---|
| IPAdapter node names vary across forks | Spec locks to `ComfyUI_IPAdapter_plus` canonical names (`IPAdapterUnifiedLoader`, `IPAdapter`). User installs that fork to match. Phase 5 can add detection-based routing. |
| Reference image uploads race when adding multiple files at once | `addReference` is naturally sequential per character (single JSON write at a time). UI shows spinner during upload. |
| 3-column Gallery layout cramped on narrow windows | CharactersSidebar is collapsible (header click hides body). Same toggle pattern as WorkstationPanel. Defaults to open. |
| Reference image format / size | ComfyUI accepts PNG / JPG / WebP up to its internal limits. No additional client-side validation in Phase 3. Phase 5 can add resize-on-upload if it matters. |
| `file.path` only works for native Electron drag-drop, not browser file inputs | The file picker uses `dialog.showOpenDialog` from main (already used elsewhere), which returns absolute paths. DnD uses Electron's `file.path` extension to `File`. |

No open questions blocking implementation — all decisions made.

---

## 11. Out of scope (intentional)

- 360° multi-angle batch (Phase 5).
- Filter Gallery by character — would require `HistoryEntry.characterIds: string[]`. Trivial future addition; not needed yet.
- IPAdapter node detection in the per-model scheduler — Phase 5.
- Character export / import (`.json` sharing). Future.
- Auto-train LoRA from reference images. Out of scope.
- Multiple description variants per character (e.g. "smiling", "stern"). Use trigger word + manual prompt for now.
- Character grouping / tags. Use naming for now.
