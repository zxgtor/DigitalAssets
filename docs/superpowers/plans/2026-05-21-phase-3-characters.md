# Phase 3 — Characters Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable Characters library — each character has metadata (name, description, trigger word, LoRA, default checkpoint, reference images) and can be applied to any generation, with the workflow extending to upload reference images and inject an IPAdapter chain on the ComfyUI workstation.

**Architecture:** New `charactersStore.ts` over `characters.json` with per-character folders under `userData/characters/<id>/refs/`. Workflow builder gets a `character` option that composes prompt, swaps checkpoint, inserts LoraLoader, and injects an IPAdapter chain. `WorkstationPool.submit` gains a pre-hook that uploads ref images to ComfyUI's `/upload/image` before POSTing `/prompt`. Renderer adds a third sidebar in Gallery + picker on Generate.

**Tech Stack:** Electron + React + TypeScript + vitest. Zero new dependencies. IPAdapter integration locked to the `ComfyUI_IPAdapter_plus` fork's canonical node names (`IPAdapterUnifiedLoader`, `IPAdapter`).

**Spec:** `docs/superpowers/specs/2026-05-21-phase-3-characters-design.md`

---

## File map

### New main-process files

| Path | Responsibility |
|---|---|
| `src/main/charactersStore.ts` | CRUD + atomic write + ref-image folder ops |
| `src/main/ipc/characters.ts` | IPC handlers + broadcast |
| `src/main/__tests__/charactersStore.test.ts` | TDD |
| `src/main/__tests__/workflow.character.test.ts` | TDD for the workflow extension |

### New renderer files

| Path | Responsibility |
|---|---|
| `src/renderer/src/hooks/useCharacters.ts` | Subscribes to `characters:update`, exposes state + actions |
| `src/renderer/src/components/CharactersSidebar.tsx` | Sidebar UI |
| `src/renderer/src/components/CharactersSidebar.module.css` | Styles |
| `src/renderer/src/components/CharacterDetail.tsx` | Modal: fields + ref grid + drag-and-drop |
| `src/renderer/src/components/CharacterDetail.module.css` | Styles |
| `src/renderer/src/components/CharacterPicker.tsx` | Dropdown for Generate |
| `src/renderer/src/components/CharacterPicker.module.css` | Styles |

### Modified files

| Path | Change |
|---|---|
| `src/main/services/workflow.ts` | `BuildImageWorkflowOptions.character`; prompt composition; LoraLoader; IPAdapter chain |
| `src/main/services/workstationPool.ts` | `submit()` uploads ref images via `/upload/image` before `/prompt` |
| `src/main/ipc/index.ts` | Register `registerCharacterHandlers()` |
| `src/preload/index.ts` | Expose `window.api.characters.*` + `StoredCharacter` type |
| `src/preload/index.d.ts` | Mirror preload types |
| `src/renderer/src/types.ts` | Re-export `StoredCharacter` |
| `src/renderer/src/views/GalleryView.tsx` | Add third column (CharactersSidebar) + right-click "Use as reference for…" |
| `src/renderer/src/views/GalleryView.module.css` | Three-column layout |
| `src/renderer/src/views/GenerateView.tsx` | Add CharacterPicker row; pass character into workflow build |
| `src/renderer/src/views/GenerateView.module.css` | Layout adjustment |

**Total:** 10 new (4 main, 6 renderer), 9 modified. Estimated ~1100 LOC.

---

## Task order

Tasks 0–1 are pure-logic main-process work with TDD (no Electron). Task 2 wires the submit pre-hook. Tasks 3–4 IPC + preload. Tasks 5–10 renderer. Task 11 acceptance walk-through. Each task leaves the codebase in a working state (typecheck + tests pass).

---

## Task 0: charactersStore — CRUD + ref image folder ops (TDD)

**Files:**
- Create: `src/main/charactersStore.ts`
- Create: `src/main/__tests__/charactersStore.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/main/__tests__/charactersStore.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

const tmpDir = require('path').join(require('os').tmpdir(), `char-test-${Date.now()}`)
vi.mock('electron', () => ({
  app: { getPath: () => tmpDir }
}))

import { mkdirSync, rmSync, existsSync, writeFileSync, readdirSync } from 'fs'
import { join } from 'path'
import {
  listCharacters,
  getCharacter,
  addCharacter,
  updateCharacter,
  deleteCharacter,
  addReference,
  removeReference,
  REF_CAP
} from '../charactersStore'

const sourceImage = join(tmpDir, 'source.png')

describe('charactersStore', () => {
  beforeEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
    mkdirSync(tmpDir, { recursive: true })
    writeFileSync(sourceImage, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  })

  it('listCharacters returns [] when file is missing', () => {
    expect(listCharacters()).toEqual([])
  })

  it('addCharacter creates a record with UUID + defaults + folder', () => {
    const c = addCharacter({ name: 'Aria' })
    expect(c.id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(c.name).toBe('Aria')
    expect(c.description).toBe('')
    expect(c.triggerWord).toBeNull()
    expect(c.loraName).toBeNull()
    expect(c.loraWeight).toBe(0.8)
    expect(c.defaultCheckpoint).toBeNull()
    expect(c.referenceImages).toEqual([])
    expect(c.ipAdapterWeight).toBe(0.6)
    expect(typeof c.createdAt).toBe('number')
    expect(existsSync(join(tmpDir, 'characters', c.id, 'refs'))).toBe(true)
  })

  it('addCharacter rejects empty/whitespace name', () => {
    expect(() => addCharacter({ name: '' })).toThrow(/name required/i)
    expect(() => addCharacter({ name: '   ' })).toThrow(/name required/i)
  })

  it('addCharacter accepts overrides for optional fields', () => {
    const c = addCharacter({
      name: 'Cyrus',
      description: 'tall warrior',
      triggerWord: 'cyrusx',
      loraName: 'cyrus.safetensors',
      loraWeight: 1.0,
      defaultCheckpoint: 'turbo.safetensors',
      ipAdapterWeight: 0.4
    })
    expect(c.description).toBe('tall warrior')
    expect(c.triggerWord).toBe('cyrusx')
    expect(c.loraName).toBe('cyrus.safetensors')
    expect(c.loraWeight).toBe(1.0)
    expect(c.defaultCheckpoint).toBe('turbo.safetensors')
    expect(c.ipAdapterWeight).toBe(0.4)
  })

  it('listCharacters sorts by name asc', () => {
    addCharacter({ name: 'Cyrus' })
    addCharacter({ name: 'Aria' })
    addCharacter({ name: 'Mira' })
    expect(listCharacters().map((c) => c.name)).toEqual(['Aria', 'Cyrus', 'Mira'])
  })

  it('getCharacter by id, or undefined', () => {
    const c = addCharacter({ name: 'Aria' })
    expect(getCharacter(c.id)?.name).toBe('Aria')
    expect(getCharacter('nope')).toBeUndefined()
  })

  it('updateCharacter patches fields and persists', () => {
    const c = addCharacter({ name: 'Aria' })
    const updated = updateCharacter(c.id, {
      description: 'updated',
      loraWeight: 1.2
    })
    expect(updated.description).toBe('updated')
    expect(updated.loraWeight).toBe(1.2)
    expect(updated.name).toBe('Aria') // unchanged
    expect(listCharacters()[0].description).toBe('updated')
  })

  it('updateCharacter rejects empty-after-trim name', () => {
    const c = addCharacter({ name: 'Aria' })
    expect(() => updateCharacter(c.id, { name: '   ' })).toThrow(/name required/i)
  })

  it('updateCharacter throws on unknown id', () => {
    expect(() => updateCharacter('nope', { description: 'x' })).toThrow(/not found/i)
  })

  it('updateCharacter ignores referenceImages in patch (must use addReference)', () => {
    const c = addCharacter({ name: 'Aria' })
    const after = updateCharacter(c.id, { referenceImages: ['/hack/path.png'] } as never)
    expect(after.referenceImages).toEqual([])
  })

  it('deleteCharacter removes record + folder', () => {
    const c = addCharacter({ name: 'Aria' })
    const folder = join(tmpDir, 'characters', c.id)
    expect(existsSync(folder)).toBe(true)
    deleteCharacter(c.id)
    expect(listCharacters()).toEqual([])
    expect(existsSync(folder)).toBe(false)
  })

  it('deleteCharacter throws on unknown id', () => {
    expect(() => deleteCharacter('nope')).toThrow(/not found/i)
  })

  it('addReference copies file into refs folder and appends path', () => {
    const c = addCharacter({ name: 'Aria' })
    const refPath = addReference(c.id, sourceImage)
    expect(refPath).toContain(join('characters', c.id, 'refs'))
    expect(refPath).toMatch(/\.png$/)
    expect(existsSync(refPath)).toBe(true)
    expect(getCharacter(c.id)?.referenceImages).toEqual([refPath])
  })

  it('addReference throws on unknown character id', () => {
    expect(() => addReference('nope', sourceImage)).toThrow(/not found/i)
  })

  it('addReference throws on missing source file', () => {
    const c = addCharacter({ name: 'Aria' })
    expect(() => addReference(c.id, join(tmpDir, 'nope.png'))).toThrow(/source file not found/i)
  })

  it('addReference enforces 10-image cap', () => {
    const c = addCharacter({ name: 'Aria' })
    for (let i = 0; i < REF_CAP; i++) addReference(c.id, sourceImage)
    expect(() => addReference(c.id, sourceImage)).toThrow(/cap reached/i)
    expect(getCharacter(c.id)?.referenceImages.length).toBe(REF_CAP)
  })

  it('removeReference deletes file and removes path', () => {
    const c = addCharacter({ name: 'Aria' })
    const refPath = addReference(c.id, sourceImage)
    expect(existsSync(refPath)).toBe(true)
    removeReference(c.id, refPath)
    expect(existsSync(refPath)).toBe(false)
    expect(getCharacter(c.id)?.referenceImages).toEqual([])
  })

  it('removeReference rejects path outside the character folder', () => {
    const c = addCharacter({ name: 'Aria' })
    const malicious = join(tmpDir, 'outside.png')
    writeFileSync(malicious, Buffer.from([0x89, 0x50]))
    expect(() => removeReference(c.id, malicious)).toThrow(/invalid reference path/i)
    // The malicious file is untouched.
    expect(existsSync(malicious)).toBe(true)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -- charactersStore`
Expected: module not found.

- [ ] **Step 3: Implement `src/main/charactersStore.ts`**

```ts
import { app } from 'electron'
import {
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  unlinkSync,
  rmSync
} from 'fs'
import { join, extname, resolve } from 'path'
import { randomUUID } from 'crypto'

export const REF_CAP = 10

export interface StoredCharacter {
  id: string
  name: string
  description: string
  triggerWord: string | null
  loraName: string | null
  loraWeight: number
  defaultCheckpoint: string | null
  referenceImages: string[]
  ipAdapterWeight: number
  createdAt: number
}

function getCharactersPath(): string {
  return join(app.getPath('userData'), 'characters.json')
}

function getCharFolder(id: string): string {
  return join(app.getPath('userData'), 'characters', id)
}

function getRefsFolder(id: string): string {
  return join(getCharFolder(id), 'refs')
}

function readFromDisk(): StoredCharacter[] {
  const p = getCharactersPath()
  if (!existsSync(p)) return []
  try {
    const raw = readFileSync(p, 'utf-8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as StoredCharacter[]) : []
  } catch {
    return []
  }
}

function writeToDisk(list: StoredCharacter[]): void {
  const p = getCharactersPath()
  const tmp = `${p}.tmp`
  writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf-8')
  renameSync(tmp, p)
}

export function listCharacters(): StoredCharacter[] {
  return readFromDisk().sort((a, b) => a.name.localeCompare(b.name))
}

export function getCharacter(id: string): StoredCharacter | undefined {
  return readFromDisk().find((c) => c.id === id)
}

export interface AddCharacterInput {
  name: string
  description?: string
  triggerWord?: string | null
  loraName?: string | null
  loraWeight?: number
  defaultCheckpoint?: string | null
  ipAdapterWeight?: number
}

export function addCharacter(input: AddCharacterInput): StoredCharacter {
  const name = input.name.trim()
  if (!name) throw new Error('Name required')
  const id = randomUUID()
  const c: StoredCharacter = {
    id,
    name,
    description: input.description ?? '',
    triggerWord: input.triggerWord ?? null,
    loraName: input.loraName ?? null,
    loraWeight: input.loraWeight ?? 0.8,
    defaultCheckpoint: input.defaultCheckpoint ?? null,
    ipAdapterWeight: input.ipAdapterWeight ?? 0.6,
    referenceImages: [],
    createdAt: Date.now()
  }
  mkdirSync(getRefsFolder(id), { recursive: true })
  const list = readFromDisk()
  list.push(c)
  writeToDisk(list)
  return c
}

type UpdatablePatch = Partial<Omit<StoredCharacter, 'id' | 'createdAt' | 'referenceImages'>>

export function updateCharacter(id: string, patch: UpdatablePatch): StoredCharacter {
  const list = readFromDisk()
  const idx = list.findIndex((c) => c.id === id)
  if (idx < 0) throw new Error('Character not found')
  const next = { ...list[idx] }
  if (patch.name !== undefined) {
    const trimmed = patch.name.trim()
    if (!trimmed) throw new Error('Name required')
    next.name = trimmed
  }
  if (patch.description !== undefined) next.description = patch.description
  if (patch.triggerWord !== undefined) next.triggerWord = patch.triggerWord
  if (patch.loraName !== undefined) next.loraName = patch.loraName
  if (patch.loraWeight !== undefined) next.loraWeight = patch.loraWeight
  if (patch.defaultCheckpoint !== undefined) next.defaultCheckpoint = patch.defaultCheckpoint
  if (patch.ipAdapterWeight !== undefined) next.ipAdapterWeight = patch.ipAdapterWeight
  // referenceImages intentionally NOT updatable via this channel
  list[idx] = next
  writeToDisk(list)
  return next
}

export function deleteCharacter(id: string): void {
  const list = readFromDisk()
  if (!list.some((c) => c.id === id)) throw new Error('Character not found')
  // Remove folder (cascade ref files).
  rmSync(getCharFolder(id), { recursive: true, force: true })
  writeToDisk(list.filter((c) => c.id !== id))
}

export function addReference(id: string, sourcePath: string): string {
  const list = readFromDisk()
  const idx = list.findIndex((c) => c.id === id)
  if (idx < 0) throw new Error('Character not found')
  if (!existsSync(sourcePath)) throw new Error('Source file not found')
  if (list[idx].referenceImages.length >= REF_CAP) {
    throw new Error(`Reference image cap reached (${REF_CAP})`)
  }
  const ext = extname(sourcePath) || '.png'
  const refsFolder = getRefsFolder(id)
  mkdirSync(refsFolder, { recursive: true })
  const refPath = join(refsFolder, `${randomUUID()}${ext}`)
  copyFileSync(sourcePath, refPath)
  list[idx] = { ...list[idx], referenceImages: [...list[idx].referenceImages, refPath] }
  writeToDisk(list)
  return refPath
}

export function removeReference(id: string, refPath: string): void {
  const list = readFromDisk()
  const idx = list.findIndex((c) => c.id === id)
  if (idx < 0) throw new Error('Character not found')
  // Defense against path traversal: refPath must be inside the character's refs folder.
  const refsFolder = resolve(getRefsFolder(id))
  const resolvedRef = resolve(refPath)
  if (!resolvedRef.startsWith(refsFolder)) {
    throw new Error('Invalid reference path')
  }
  if (existsSync(resolvedRef)) unlinkSync(resolvedRef)
  list[idx] = {
    ...list[idx],
    referenceImages: list[idx].referenceImages.filter((p) => p !== refPath)
  }
  writeToDisk(list)
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npm test -- charactersStore`
Expected: all 17 tests pass.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck:node`
Expected: clean.

- [ ] **Step 6: Commit**

```
git commit -m "$(cat <<'EOF'
feat(main): add charactersStore with CRUD + ref-image folder ops

characters.json holds the list (id, name, description, triggerWord,
loraName, loraWeight, defaultCheckpoint, referenceImages,
ipAdapterWeight, createdAt). Per-character refs/ folder under
userData/characters/<id>. addReference enforces a 10-image cap and
defends against path traversal in removeReference. Pure-logic;
testable without Electron via app.getPath mock.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 1: workflow.ts — character composition + LoraLoader + IPAdapter chain (TDD)

**Files:**
- Modify: `src/main/services/workflow.ts`
- Create: `src/main/__tests__/workflow.character.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/main/__tests__/workflow.character.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildImageWorkflow } from '../services/workflow'
import type { StoredCharacter } from '../charactersStore'

const baseChar: StoredCharacter = {
  id: 'c-1',
  name: 'Aria',
  description: 'tall warrior',
  triggerWord: 'ariax',
  loraName: null,
  loraWeight: 0.8,
  defaultCheckpoint: null,
  ipAdapterWeight: 0.6,
  referenceImages: [],
  createdAt: 0
}

describe('buildImageWorkflow with character (no refs)', () => {
  it('prepends description + trigger word to the prompt', () => {
    const wf = buildImageWorkflow({
      prompt: 'in a forest',
      character: baseChar
    })
    // The positive-prompt node is `6` (CLIPTextEncode).
    expect((wf['6'].inputs as { text: string }).text).toBe(
      'tall warrior, ariax, in a forest'
    )
  })

  it('omits trigger word when null', () => {
    const wf = buildImageWorkflow({
      prompt: 'in a forest',
      character: { ...baseChar, triggerWord: null }
    })
    expect((wf['6'].inputs as { text: string }).text).toBe('tall warrior, in a forest')
  })

  it('omits description when empty', () => {
    const wf = buildImageWorkflow({
      prompt: 'in a forest',
      character: { ...baseChar, description: '' }
    })
    expect((wf['6'].inputs as { text: string }).text).toBe('ariax, in a forest')
  })

  it('uses character.defaultCheckpoint when opts.checkpoint not passed', () => {
    const wf = buildImageWorkflow({
      prompt: 'x',
      character: { ...baseChar, defaultCheckpoint: 'aria_turbo.safetensors' }
    })
    expect((wf['4'].inputs as { ckpt_name: string }).ckpt_name).toBe(
      'aria_turbo.safetensors'
    )
  })

  it('opts.checkpoint overrides character.defaultCheckpoint when both set', () => {
    const wf = buildImageWorkflow({
      prompt: 'x',
      checkpoint: 'explicit.safetensors',
      character: { ...baseChar, defaultCheckpoint: 'aria.safetensors' }
    })
    expect((wf['4'].inputs as { ckpt_name: string }).ckpt_name).toBe('explicit.safetensors')
  })

  it('inserts LoraLoader node when character.loraName is set', () => {
    const wf = buildImageWorkflow({
      prompt: 'x',
      character: { ...baseChar, loraName: 'aria.safetensors', loraWeight: 0.7 }
    })
    // Find the LoraLoader by class_type
    const lora = Object.entries(wf).find(([, n]) => n.class_type === 'LoraLoader')
    expect(lora).toBeDefined()
    const [loraId, loraNode] = lora!
    expect((loraNode.inputs as { lora_name: string }).lora_name).toBe('aria.safetensors')
    expect((loraNode.inputs as { strength_model: number }).strength_model).toBe(0.7)
    expect((loraNode.inputs as { strength_clip: number }).strength_clip).toBe(0.7)
    // KSampler (node 3) now references the LoraLoader
    expect((wf['3'].inputs as { model: [string, number] }).model).toEqual([loraId, 0])
  })
})

describe('buildImageWorkflow with character (with refs)', () => {
  const charWithRefs: StoredCharacter = {
    ...baseChar,
    referenceImages: ['C:\\u\\refs\\a.png', 'C:\\u\\refs\\b.png']
  }
  const uploadedMap = {
    'C:\\u\\refs\\a.png': 'aria_ref_a.png',
    'C:\\u\\refs\\b.png': 'aria_ref_b.png'
  }

  it('inserts LoadImage nodes per uploaded reference', () => {
    const wf = buildImageWorkflow({
      prompt: 'x',
      character: charWithRefs,
      uploadedReferenceFilenames: uploadedMap
    })
    const loads = Object.values(wf).filter((n) => n.class_type === 'LoadImage')
    expect(loads).toHaveLength(2)
    const filenames = loads.map((n) => (n.inputs as { image: string }).image)
    expect(filenames.sort()).toEqual(['aria_ref_a.png', 'aria_ref_b.png'])
  })

  it('inserts IPAdapterUnifiedLoader + IPAdapter chain', () => {
    const wf = buildImageWorkflow({
      prompt: 'x',
      character: charWithRefs,
      uploadedReferenceFilenames: uploadedMap
    })
    const unifiedLoader = Object.entries(wf).find(
      ([, n]) => n.class_type === 'IPAdapterUnifiedLoader'
    )
    const ipAdapters = Object.entries(wf).filter(
      ([, n]) => n.class_type === 'IPAdapter'
    )
    expect(unifiedLoader).toBeDefined()
    expect(ipAdapters).toHaveLength(2)
    // Last IPAdapter feeds KSampler.model
    const lastIpAdapterId = ipAdapters[ipAdapters.length - 1][0]
    expect((wf['3'].inputs as { model: [string, number] }).model).toEqual([lastIpAdapterId, 0])
    // Each IPAdapter has the configured weight
    for (const [, n] of ipAdapters) {
      expect((n.inputs as { weight: number }).weight).toBe(0.6)
    }
  })

  it('skips IPAdapter chain when uploadedReferenceFilenames is missing', () => {
    const wf = buildImageWorkflow({
      prompt: 'x',
      character: charWithRefs
      // No uploadedReferenceFilenames provided
    })
    expect(Object.values(wf).some((n) => n.class_type === 'IPAdapter')).toBe(false)
    expect(Object.values(wf).some((n) => n.class_type === 'LoadImage')).toBe(false)
  })
})

describe('buildImageWorkflow without character (regression)', () => {
  it('still produces the basic txt2img workflow', () => {
    const wf = buildImageWorkflow({ prompt: 'plain' })
    expect(wf['3'].class_type).toBe('KSampler')
    expect(wf['4'].class_type).toBe('CheckpointLoaderSimple')
    expect((wf['6'].inputs as { text: string }).text).toBe('plain')
    expect(Object.values(wf).some((n) => n.class_type === 'IPAdapter')).toBe(false)
    expect(Object.values(wf).some((n) => n.class_type === 'LoraLoader')).toBe(false)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -- workflow.character`
Expected: tests reference `character` option that doesn't exist yet.

- [ ] **Step 3: Modify `src/main/services/workflow.ts`**

Add imports at top:

```ts
import type { StoredCharacter } from '../charactersStore'
```

Extend the `BuildImageWorkflowOptions` interface:

```ts
export interface BuildImageWorkflowOptions {
  prompt: string
  negativePrompt?: string
  seed?: number
  steps?: number
  cfg?: number
  checkpoint?: string
  width?: number
  height?: number
  character?: StoredCharacter
  /** Set by submission flow after /upload/image: maps absolute local ref path → ComfyUI input filename. */
  uploadedReferenceFilenames?: Record<string, string>
}
```

Replace the body of `buildImageWorkflow`:

```ts
export function buildImageWorkflow(opts: BuildImageWorkflowOptions): WorkflowJSON {
  // ── Compose prompt with character ─────────────────────────────────────────
  const character = opts.character
  const composedPrompt = character
    ? [character.description, character.triggerWord, opts.prompt].filter(Boolean).join(', ')
    : opts.prompt

  // ── Resolve checkpoint (character default unless explicit) ────────────────
  const ckptName =
    opts.checkpoint ?? character?.defaultCheckpoint ?? DEFAULT_CHECKPOINT

  const {
    negativePrompt = DEFAULT_NEGATIVE,
    seed = randomSeed(),
    steps = DEFAULT_STEPS,
    cfg = DEFAULT_CFG,
    width = 1024,
    height = 1024
  } = opts

  // ── Base graph ───────────────────────────────────────────────────────────
  // Node ids: 3=KSampler, 4=CheckpointLoaderSimple, 5=EmptyLatentImage,
  // 6=CLIPTextEncode (positive), 7=CLIPTextEncode (negative),
  // 8=VAEDecode, 9=SaveImage.
  const wf: WorkflowJSON = {
    '3': {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps,
        cfg,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1,
        model: ['4', 0],            // overwritten below if Lora/IPAdapter inserted
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['5', 0]
      }
    },
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckptName } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: composedPrompt, clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: negativePrompt, clip: ['4', 1] } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'DigitalAssets' } }
  }

  // Track which node provides the "model" link into KSampler.
  let modelSource: [string, number] = ['4', 0]
  let nextId = 10

  // ── LoraLoader (if character has a LoRA) ──────────────────────────────────
  if (character?.loraName) {
    const loraId = String(nextId++)
    wf[loraId] = {
      class_type: 'LoraLoader',
      inputs: {
        lora_name: character.loraName,
        strength_model: character.loraWeight,
        strength_clip: character.loraWeight,
        model: modelSource,
        clip: ['4', 1]
      }
    }
    modelSource = [loraId, 0]
  }

  // ── IPAdapter chain (only when refs were uploaded) ────────────────────────
  const refs = character?.referenceImages ?? []
  const uploaded = opts.uploadedReferenceFilenames
  if (refs.length > 0 && uploaded) {
    // LoadImage nodes
    const loadIds: string[] = []
    for (const refPath of refs) {
      const comfyName = uploaded[refPath]
      if (!comfyName) continue
      const id = String(nextId++)
      wf[id] = {
        class_type: 'LoadImage',
        inputs: { image: comfyName }
      }
      loadIds.push(id)
    }
    if (loadIds.length > 0) {
      // Single UnifiedLoader
      const unifiedId = String(nextId++)
      wf[unifiedId] = {
        class_type: 'IPAdapterUnifiedLoader',
        inputs: { model: modelSource, preset: 'PLUS (high strength)' }
      }
      let chainModel: [string, number] = [unifiedId, 0]
      const ipAdapterPipe: [string, number] = [unifiedId, 1]
      // One IPAdapter per ref, chained
      for (const loadId of loadIds) {
        const ipaId = String(nextId++)
        wf[ipaId] = {
          class_type: 'IPAdapter',
          inputs: {
            model: chainModel,
            ipadapter: ipAdapterPipe,
            image: [loadId, 0],
            weight: character!.ipAdapterWeight,
            start_at: 0,
            end_at: 1
          }
        }
        chainModel = [ipaId, 0]
      }
      modelSource = chainModel
    }
  }

  // Final wiring: KSampler.model points at the last node in the chain.
  ;(wf['3'].inputs as Record<string, unknown>).model = modelSource

  return wf
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npm test -- workflow.character`
Expected: all 10 tests pass.

- [ ] **Step 5: Full test run**

Run: `npm test`
Expected: 68 prior tests + 17 (charactersStore) + 10 (workflow.character) = 95 total, all pass.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck:node`
Expected: clean.

- [ ] **Step 7: Commit**

```
git commit -m "$(cat <<'EOF'
feat(workflow): character-aware build (prompt, LoRA, IPAdapter chain)

buildImageWorkflow accepts an optional StoredCharacter. When present:
- description + triggerWord prepend to the prompt
- character.defaultCheckpoint takes effect unless opts.checkpoint is set
- character.loraName inserts a LoraLoader between Checkpoint and KSampler
- character.referenceImages (with uploadedReferenceFilenames mapping)
  inject an IPAdapterUnifiedLoader + per-ref IPAdapter chain feeding
  KSampler.model. Without uploaded filenames, the chain is skipped
  (caller hasn't run /upload/image yet).

ComfyUI_IPAdapter_plus canonical node names: IPAdapterUnifiedLoader,
IPAdapter, LoadImage. Other forks need workflow adapter (out of scope).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: workstationPool — submit pre-hook for /upload/image

**Files:**
- Modify: `src/main/services/workstationPool.ts`

- [ ] **Step 1: Locate the existing `submit` method**

Read `src/main/services/workstationPool.ts` and find the `submit` method (added in Phase 1). Note the location of the `axios.post(\`${ws.url}/prompt\`, ...)` call inside the retry loop.

- [ ] **Step 2: Add the upload helper**

At module scope (after the existing helpers, before `class WorkstationPool`), add:

```ts
import { existsSync, readFileSync } from 'fs'
import { basename } from 'path'
import FormData from 'form-data'

/**
 * Upload one local image file to ComfyUI's /upload/image endpoint.
 * Returns the filename ComfyUI assigned (under its input/ folder).
 */
async function uploadImageToComfy(wsUrl: string, localPath: string): Promise<string> {
  if (!existsSync(localPath)) throw new Error(`Reference image missing: ${localPath}`)
  const form = new FormData()
  form.append('image', readFileSync(localPath), { filename: basename(localPath) })
  const res = await axios.post(`${wsUrl}/upload/image`, form, {
    headers: form.getHeaders(),
    timeout: 30_000,
    maxBodyLength: 50_000_000
  })
  const data = res.data as { name?: string }
  if (!data?.name) throw new Error('ComfyUI did not return a filename for the uploaded image')
  return data.name
}
```

**Important:** `form-data` is already a transitive dependency of axios; no `npm install` needed. Confirm with `node -e "console.log(require('form-data'))"` before relying on it. If it isn't resolvable as a top-level import, install it as a direct dep: `npm install --save form-data`.

- [ ] **Step 3: Modify the submit method**

Inside `submit()`, after the `requireModel` extraction and BEFORE the retry loop's `axios.post(\`${ws.url}/prompt\`...)`, add a per-workstation pre-hook. Find the existing block that looks like:

```ts
try {
  job.status = 'submitting'
  this.emit('jobs:update', this.getJobs())
  await submitGate.run(async () => {
    const res = await axios.post(`${ws.url}/prompt`, { prompt: workflow, client_id: ...
```

Replace the `await submitGate.run(...)` body so the workflow is rebuilt with uploaded filenames just before submission:

```ts
await submitGate.run(async () => {
  // ── Phase 3: upload reference images to this workstation, if any ─────
  let finalWorkflow = workflow
  const char = args.hints.character
  if (char && char.referenceImages.length > 0) {
    const uploaded: Record<string, string> = {}
    for (const refPath of char.referenceImages) {
      uploaded[refPath] = await uploadImageToComfy(ws.url, refPath)
    }
    // Rebuild the workflow now that we know the comfy-side filenames.
    finalWorkflow = buildImageWorkflow({
      ...args.buildOptions,
      character: char,
      uploadedReferenceFilenames: uploaded
    })
  }

  const res = await axios.post(`${ws.url}/prompt`, {
    prompt: finalWorkflow,
    client_id: this.clientId
  }, { timeout: 30_000 })
  // ... existing handling of res
})
```

Update `submit`'s `args` type to accept `character` in hints and `buildOptions` (so we can rebuild the workflow):

```ts
export interface SubmitArgs {
  workflow: WorkflowJSON
  hints: {
    requireModel?: { checkpoints: string[]; loras: string[]; vae: string[] }
    preferWorkstation?: string
    character?: StoredCharacter
  }
  buildOptions?: BuildImageWorkflowOptions  // needed to rebuild after upload
}
```

Import `buildImageWorkflow` and types at the top of the file:

```ts
import { buildImageWorkflow, type BuildImageWorkflowOptions } from './workflow'
import type { StoredCharacter } from '../charactersStore'
```

**Note:** the callers of `pool.submit` will be updated in Task 10 to pass `character` + `buildOptions`. For now, the change is backward-compatible because both new fields are optional.

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: all 95 tests still pass. (No new unit tests for the submit pre-hook — covered by acceptance walk-through Task 11.)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck:node`
Expected: clean.

- [ ] **Step 6: Commit**

```
git commit -m "$(cat <<'EOF'
feat(pool): upload character refs to /upload/image before submit

When SubmitArgs carries a character with referenceImages, submit()
POSTs each local file to the picked workstation's /upload/image
endpoint, then rebuilds the workflow with the comfy-side filenames
in LoadImage nodes via buildImageWorkflow's uploadedReferenceFilenames
option. Upload errors fail the job with a clear message; existing
retry logic is unchanged.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: IPC handlers — `characters:*`

**Files:**
- Create: `src/main/ipc/characters.ts`
- Modify: `src/main/ipc/index.ts`

- [ ] **Step 1: Create `src/main/ipc/characters.ts`**

```ts
import { ipcMain, BrowserWindow } from 'electron'
import {
  listCharacters,
  addCharacter,
  updateCharacter,
  deleteCharacter,
  addReference,
  removeReference,
  type StoredCharacter,
  type AddCharacterInput
} from '../charactersStore'

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

type UpdatablePatch = Partial<
  Omit<StoredCharacter, 'id' | 'createdAt' | 'referenceImages'>
>

export function registerCharacterHandlers(): void {
  ipcMain.handle('characters:list', (): StoredCharacter[] => listCharacters())

  ipcMain.handle(
    'characters:create',
    (_e, input: AddCharacterInput): StoredCharacter => {
      const c = addCharacter(input)
      broadcast('characters:update', listCharacters())
      return c
    }
  )

  ipcMain.handle(
    'characters:update',
    (_e, args: { id: string; patch: UpdatablePatch }): StoredCharacter => {
      const c = updateCharacter(args.id, args.patch)
      broadcast('characters:update', listCharacters())
      return c
    }
  )

  ipcMain.handle('characters:delete', (_e, args: { id: string }): void => {
    deleteCharacter(args.id)
    broadcast('characters:update', listCharacters())
  })

  ipcMain.handle(
    'characters:addReference',
    (_e, args: { id: string; sourcePath: string }): string => {
      const refPath = addReference(args.id, args.sourcePath)
      broadcast('characters:update', listCharacters())
      return refPath
    }
  )

  ipcMain.handle(
    'characters:removeReference',
    (_e, args: { id: string; refPath: string }): void => {
      removeReference(args.id, args.refPath)
      broadcast('characters:update', listCharacters())
    }
  )
}
```

- [ ] **Step 2: Register in `src/main/ipc/index.ts`**

Find the existing IPC registrations and add after `registerProjectHandlers()`:

```ts
import { registerCharacterHandlers } from './characters'

// ...inside the registration function, after registerProjectHandlers():
registerCharacterHandlers()
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck:node`
Expected: clean.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: no regressions, 95/95 pass.

- [ ] **Step 5: Commit**

```
git commit -m "$(cat <<'EOF'
feat(ipc): characters:* handlers + broadcast

Six channels: list / create / update / delete / addReference /
removeReference. Every mutation broadcasts characters:update with
the full sorted list. Mirrors the projects:* IPC pattern.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Preload bindings

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

- [ ] **Step 1: Update `src/preload/index.ts`**

Add `StoredCharacter` type near the existing exports:

```ts
export interface StoredCharacter {
  id: string
  name: string
  description: string
  triggerWord: string | null
  loraName: string | null
  loraWeight: number
  defaultCheckpoint: string | null
  referenceImages: string[]
  ipAdapterWeight: number
  createdAt: number
}
```

Add to the `api` object exposed via `contextBridge.exposeInMainWorld` (after `projects`):

```ts
characters: {
  list: (): Promise<StoredCharacter[]> =>
    ipcRenderer.invoke('characters:list'),
  create: (input: { name: string } & Partial<Omit<StoredCharacter, 'id' | 'createdAt' | 'referenceImages'>>): Promise<StoredCharacter> =>
    ipcRenderer.invoke('characters:create', input),
  update: (id: string, patch: Partial<Omit<StoredCharacter, 'id' | 'createdAt' | 'referenceImages'>>): Promise<StoredCharacter> =>
    ipcRenderer.invoke('characters:update', { id, patch }),
  delete: (id: string): Promise<void> =>
    ipcRenderer.invoke('characters:delete', { id }),
  addReference: (id: string, sourcePath: string): Promise<string> =>
    ipcRenderer.invoke('characters:addReference', { id, sourcePath }),
  removeReference: (id: string, refPath: string): Promise<void> =>
    ipcRenderer.invoke('characters:removeReference', { id, refPath }),
  onUpdate: (cb: (list: StoredCharacter[]) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, list: StoredCharacter[]): void => cb(list)
    ipcRenderer.on('characters:update', handler)
    return () => ipcRenderer.removeListener('characters:update', handler)
  }
}
```

- [ ] **Step 2: Mirror in `src/preload/index.d.ts`**

Add the same `StoredCharacter` interface and the `characters: { ... }` block to the `Api` interface declaration.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean (both projects).

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: 95/95 pass.

- [ ] **Step 5: Commit**

```
git commit -m "$(cat <<'EOF'
feat(preload): expose window.api.characters.*

Mirrors window.api.projects shape with two extra channels for
reference image management (addReference, removeReference).
StoredCharacter type re-exposed to the renderer.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Renderer types + `useCharacters()` hook

**Files:**
- Modify: `src/renderer/src/types.ts`
- Create: `src/renderer/src/hooks/useCharacters.ts`

- [ ] **Step 1: Re-export `StoredCharacter`**

Append to `src/renderer/src/types.ts`:

```ts
export type { StoredCharacter } from '@preload/index'
```

- [ ] **Step 2: Create `src/renderer/src/hooks/useCharacters.ts`**

```ts
import { useEffect, useState, useCallback } from 'react'
import type { StoredCharacter } from '@preload/index'

interface UseCharactersReturn {
  characters: StoredCharacter[]
  loading: boolean
  create: (
    input: { name: string } & Partial<
      Omit<StoredCharacter, 'id' | 'createdAt' | 'referenceImages'>
    >
  ) => Promise<StoredCharacter>
  update: (
    id: string,
    patch: Partial<Omit<StoredCharacter, 'id' | 'createdAt' | 'referenceImages'>>
  ) => Promise<StoredCharacter>
  delete: (id: string) => Promise<void>
  addReference: (id: string, sourcePath: string) => Promise<string>
  removeReference: (id: string, refPath: string) => Promise<void>
}

export function useCharacters(): UseCharactersReturn {
  const [characters, setCharacters] = useState<StoredCharacter[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void window.api.characters.list().then((list) => {
      if (cancelled) return
      setCharacters(list)
      setLoading(false)
    })
    const unsub = window.api.characters.onUpdate((list) => {
      setCharacters(list)
    })
    return () => {
      cancelled = true
      unsub()
    }
  }, [])

  const create = useCallback(
    (input: Parameters<UseCharactersReturn['create']>[0]) =>
      window.api.characters.create(input),
    []
  )
  const update = useCallback(
    (id: string, patch: Parameters<UseCharactersReturn['update']>[1]) =>
      window.api.characters.update(id, patch),
    []
  )
  const del = useCallback((id: string) => window.api.characters.delete(id), [])
  const addReference = useCallback(
    (id: string, sourcePath: string) =>
      window.api.characters.addReference(id, sourcePath),
    []
  )
  const removeReference = useCallback(
    (id: string, refPath: string) =>
      window.api.characters.removeReference(id, refPath),
    []
  )

  return {
    characters,
    loading,
    create,
    update,
    delete: del,
    addReference,
    removeReference
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck:web`
Expected: clean.

- [ ] **Step 4: Commit**

```
git commit -m "$(cat <<'EOF'
feat(renderer): types + useCharacters() hook

useCharacters() subscribes to characters:update and exposes
list + CRUD + reference image actions. Mirrors useProjects().

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: CharacterPicker component

**Files:**
- Create: `src/renderer/src/components/CharacterPicker.tsx`
- Create: `src/renderer/src/components/CharacterPicker.module.css`

- [ ] **Step 1: Create the component**

`src/renderer/src/components/CharacterPicker.tsx`:

```tsx
import type { StoredCharacter } from '@preload/index'
import styles from './CharacterPicker.module.css'

interface Props {
  characters: StoredCharacter[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onManage: () => void
}

export function CharacterPicker(props: Props): React.JSX.Element {
  const { characters, selectedId, onSelect, onManage } = props
  return (
    <div className={styles.row}>
      <span className={styles.label}>Character:</span>
      <select
        className={styles.select}
        value={selectedId ?? ''}
        onChange={(e) => onSelect(e.target.value === '' ? null : e.target.value)}
      >
        <option value="">None</option>
        {characters.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      <button className={styles.manageBtn} onClick={onManage} title="Manage characters">
        Manage…
      </button>
    </div>
  )
}

export default CharacterPicker
```

- [ ] **Step 2: Create the CSS module**

`src/renderer/src/components/CharacterPicker.module.css`:

```css
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}
.label {
  font-size: 12px;
  opacity: 0.75;
}
.select {
  flex: 1;
  padding: 4px 8px;
  background: var(--bg-elevated, #222);
  border: 1px solid var(--border, #333);
  border-radius: 4px;
  color: inherit;
  font-size: 13px;
}
.manageBtn {
  padding: 4px 10px;
  background: none;
  border: 1px solid var(--border, #333);
  border-radius: 4px;
  color: inherit;
  cursor: pointer;
  font-size: 12px;
}
.manageBtn:hover {
  background: var(--bg-elevated, #2a2a2a);
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck:web`
Expected: clean.

- [ ] **Step 4: Commit**

```
git commit -m "$(cat <<'EOF'
feat(renderer): CharacterPicker dropdown component

Compact `Character: [None ▼] [Manage…]` row used in GenerateView.
Controlled component — selectedId + onSelect flow in/out.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: CharacterDetail modal

**Files:**
- Create: `src/renderer/src/components/CharacterDetail.tsx`
- Create: `src/renderer/src/components/CharacterDetail.module.css`

- [ ] **Step 1: Create the modal component**

`src/renderer/src/components/CharacterDetail.tsx`:

```tsx
import { useState, useEffect, useRef, useCallback } from 'react'
import type { StoredCharacter } from '@preload/index'
import { useWorkstationPool } from '../hooks/useWorkstationPool'
import styles from './CharacterDetail.module.css'

const REF_CAP = 10

interface Props {
  open: boolean
  character: StoredCharacter | null
  onClose: () => void
  onSave: (patch: Partial<Omit<StoredCharacter, 'id' | 'createdAt' | 'referenceImages'>>) => Promise<void>
  onAddReference: (sourcePath: string) => Promise<void>
  onRemoveReference: (refPath: string) => Promise<void>
}

export function CharacterDetail(props: Props): React.JSX.Element | null {
  const { open, character, onClose, onSave, onAddReference, onRemoveReference } = props
  const pool = useWorkstationPool()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [triggerWord, setTriggerWord] = useState('')
  const [loraName, setLoraName] = useState<string>('')
  const [loraWeight, setLoraWeight] = useState(0.8)
  const [defaultCheckpoint, setDefaultCheckpoint] = useState<string>('')
  const [ipAdapterWeight, setIpAdapterWeight] = useState(0.6)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Seed state when the character changes.
  useEffect(() => {
    if (!character) return
    setName(character.name)
    setDescription(character.description)
    setTriggerWord(character.triggerWord ?? '')
    setLoraName(character.loraName ?? '')
    setLoraWeight(character.loraWeight)
    setDefaultCheckpoint(character.defaultCheckpoint ?? '')
    setIpAdapterWeight(character.ipAdapterWeight)
    setError(null)
  }, [character])

  // Union of all workstation models for dropdowns.
  const allLoras = Array.from(new Set(pool.workstations.flatMap((w) => w.models.loras))).sort()
  const allCheckpoints = Array.from(new Set(pool.workstations.flatMap((w) => w.models.checkpoints))).sort()

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      setError('Name required')
      return
    }
    setSaving(true)
    try {
      await onSave({
        name: name.trim(),
        description,
        triggerWord: triggerWord.trim() === '' ? null : triggerWord.trim(),
        loraName: loraName === '' ? null : loraName,
        loraWeight,
        defaultCheckpoint: defaultCheckpoint === '' ? null : defaultCheckpoint,
        ipAdapterWeight
      })
      onClose()
    } catch (e) {
      setError((e as Error).message ?? String(e))
    } finally {
      setSaving(false)
    }
  }, [name, description, triggerWord, loraName, loraWeight, defaultCheckpoint, ipAdapterWeight, onSave, onClose])

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || !character) return
      for (let i = 0; i < files.length; i++) {
        const file = files[i] as File & { path?: string }
        if (!file.path) continue // skip drag-drop entries without path
        if (character.referenceImages.length + i >= REF_CAP) {
          setError(`Reference image cap reached (${REF_CAP})`)
          break
        }
        try {
          await onAddReference(file.path)
        } catch (e) {
          setError((e as Error).message)
          break
        }
      }
    },
    [character, onAddReference]
  )

  if (!open || !character) return null

  const atCap = character.referenceImages.length >= REF_CAP

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>Edit character</div>
        <div className={styles.body}>
          {/* Left column: fields */}
          <div className={styles.fields}>
            <label className={styles.field}>
              <span>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className={styles.field}>
              <span>Description</span>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. tall warrior, silver hair, blue cloak"
              />
            </label>
            <label className={styles.field}>
              <span>Trigger word</span>
              <input
                value={triggerWord}
                onChange={(e) => setTriggerWord(e.target.value)}
                placeholder="optional, e.g. ariax"
              />
            </label>
            <label className={styles.field}>
              <span>LoRA</span>
              <select value={loraName} onChange={(e) => setLoraName(e.target.value)}>
                <option value="">None</option>
                {allLoras.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>LoRA weight: {loraWeight.toFixed(2)}</span>
              <input
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={loraWeight}
                onChange={(e) => setLoraWeight(Number(e.target.value))}
              />
            </label>
            <label className={styles.field}>
              <span>Default checkpoint</span>
              <select
                value={defaultCheckpoint}
                onChange={(e) => setDefaultCheckpoint(e.target.value)}
              >
                <option value="">None</option>
                {allCheckpoints.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>IPAdapter weight: {ipAdapterWeight.toFixed(2)}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={ipAdapterWeight}
                onChange={(e) => setIpAdapterWeight(Number(e.target.value))}
              />
            </label>
            {error && <div className={styles.error}>✗ {error}</div>}
          </div>

          {/* Right column: reference images */}
          <div className={styles.refs}>
            <div className={styles.refsHeader}>
              Reference images ({character.referenceImages.length}/{REF_CAP})
            </div>
            <div
              className={[styles.refGrid, dragOver ? styles.dragOver : ''].join(' ')}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(false)
                void handleFiles(e.dataTransfer.files)
              }}
            >
              {character.referenceImages.map((p) => (
                <div key={p} className={styles.refItem}>
                  <img src={`file:///${p.replace(/\\/g, '/')}`} alt="ref" />
                  <button
                    className={styles.refRemove}
                    title="Remove"
                    onClick={() => void onRemoveReference(p)}
                  >✕</button>
                </div>
              ))}
              {character.referenceImages.length === 0 && (
                <div className={styles.refEmpty}>
                  Drag images here, or click + Add image
                </div>
              )}
            </div>
            <button
              className={styles.addBtn}
              disabled={atCap}
              onClick={() => fileInputRef.current?.click()}
            >
              {atCap ? 'Cap reached' : '+ Add image'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                void handleFiles(e.target.files)
                e.target.value = ''
              }}
            />
          </div>
        </div>
        <div className={styles.footer}>
          <button onClick={onClose}>Cancel</button>
          <button
            className={styles.saveBtn}
            disabled={saving || !name.trim()}
            onClick={() => void handleSave()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default CharacterDetail
```

- [ ] **Step 2: Create the CSS module**

`src/renderer/src/components/CharacterDetail.module.css`:

```css
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.modal {
  width: 720px;
  max-height: 80vh;
  background: var(--bg-card, #1a1a1a);
  border: 1px solid var(--border, #333);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.header {
  padding: 12px 16px;
  font-size: 14px;
  font-weight: 600;
  border-bottom: 1px solid var(--border, #2a2a2a);
}
.body {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  padding: 16px;
  overflow: auto;
}
.fields {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}
.field span {
  opacity: 0.75;
}
.field input, .field textarea, .field select {
  padding: 6px 8px;
  background: var(--bg-elevated, #222);
  border: 1px solid var(--border, #333);
  border-radius: 4px;
  color: inherit;
  font-size: 13px;
}
.field textarea {
  resize: vertical;
  min-height: 48px;
}
.field input[type="range"] {
  padding: 0;
  background: none;
  border: none;
}
.error {
  padding: 6px 8px;
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.35);
  border-radius: 4px;
  color: #ef4444;
  font-size: 12px;
}
.refs {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.refsHeader {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  opacity: 0.65;
}
.refGrid {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  padding: 8px;
  border: 1px dashed var(--border, #333);
  border-radius: 6px;
  min-height: 120px;
  align-content: start;
}
.dragOver {
  border-color: var(--accent, #4ade80);
  background: rgba(74, 222, 128, 0.06);
}
.refEmpty {
  grid-column: 1 / -1;
  text-align: center;
  font-size: 12px;
  opacity: 0.55;
  padding: 20px;
}
.refItem {
  position: relative;
  aspect-ratio: 1;
  border-radius: 4px;
  overflow: hidden;
  background: var(--bg-elevated, #222);
}
.refItem img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.refRemove {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  background: rgba(0, 0, 0, 0.6);
  border: none;
  border-radius: 50%;
  color: white;
  cursor: pointer;
  font-size: 11px;
  line-height: 1;
}
.refRemove:hover {
  background: rgba(239, 68, 68, 0.85);
}
.addBtn {
  padding: 8px;
  background: none;
  border: 1px solid var(--border, #333);
  border-radius: 4px;
  color: inherit;
  cursor: pointer;
  font-size: 13px;
}
.addBtn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border, #2a2a2a);
}
.footer button {
  padding: 6px 14px;
  background: var(--bg-elevated, #222);
  border: 1px solid var(--border, #333);
  border-radius: 4px;
  color: inherit;
  cursor: pointer;
  font-size: 13px;
}
.saveBtn {
  background: var(--accent, #4ade80) !important;
  border-color: var(--accent, #4ade80) !important;
  color: #0c1a10 !important;
}
.saveBtn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck:web`
Expected: clean.

- [ ] **Step 4: Commit**

```
git commit -m "$(cat <<'EOF'
feat(renderer): CharacterDetail modal component

Two-column edit modal: fields (name, description, trigger, LoRA,
weights, default checkpoint) on the left; reference image grid with
drag-and-drop + file picker on the right. Honors the 10-image cap;
LoRA + checkpoint dropdowns populated from the union of workstation
models.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: CharactersSidebar component

**Files:**
- Create: `src/renderer/src/components/CharactersSidebar.tsx`
- Create: `src/renderer/src/components/CharactersSidebar.module.css`

- [ ] **Step 1: Create the component**

`src/renderer/src/components/CharactersSidebar.tsx`:

```tsx
import { useState } from 'react'
import type { StoredCharacter } from '@preload/index'
import styles from './CharactersSidebar.module.css'

interface Props {
  characters: StoredCharacter[]
  onOpenDetail: (char: StoredCharacter | null) => void
  onCreate: (name: string) => Promise<StoredCharacter>
  onDelete: (id: string) => Promise<void>
}

export function CharactersSidebar(props: Props): React.JSX.Element {
  const { characters, onOpenDetail, onCreate, onDelete } = props
  const [collapsed, setCollapsed] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  const commitCreate = async (): Promise<void> => {
    if (creating || !newName.trim()) {
      setNewName('')
      setAdding(false)
      return
    }
    setCreating(true)
    try {
      const c = await onCreate(newName.trim())
      setNewName('')
      setAdding(false)
      onOpenDetail(c) // open detail for the new character
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className={styles.sidebar}>
      <button className={styles.header} onClick={() => setCollapsed((v) => !v)}>
        Characters <span>{collapsed ? '▶' : '▼'}</span>
      </button>
      {!collapsed && (
        <>
          {characters.length === 0 && !adding && (
            <div className={styles.empty}>No characters yet.</div>
          )}
          {characters.map((c) => (
            <div key={c.id} className={styles.row}>
              <button className={styles.rowLabel} onClick={() => onOpenDetail(c)}>
                {c.referenceImages[0] ? (
                  <img
                    src={`file:///${c.referenceImages[0].replace(/\\/g, '/')}`}
                    className={styles.thumb}
                    alt=""
                  />
                ) : (
                  <div className={styles.thumbPlaceholder}>{c.name[0]?.toUpperCase() ?? '?'}</div>
                )}
                <span className={styles.name}>{c.name}</span>
                <span className={styles.count}>{c.referenceImages.length}</span>
              </button>
              <button
                className={styles.deleteBtn}
                title="Delete"
                onClick={() => {
                  if (window.confirm(`Delete "${c.name}" and all ${c.referenceImages.length} ref images?`)) {
                    void onDelete(c.id)
                  }
                }}
              >✕</button>
            </div>
          ))}
          {adding ? (
            <input
              autoFocus
              value={newName}
              placeholder="Character name"
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
        </>
      )}
    </div>
  )
}

export default CharactersSidebar
```

- [ ] **Step 2: Create the CSS module**

`src/renderer/src/components/CharactersSidebar.module.css`:

```css
.sidebar {
  width: 220px;
  flex-shrink: 0;
  border-left: 1px solid var(--border, #2a2a2a);
  padding: 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: var(--bg-card, #1a1a1a);
  overflow-y: auto;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 8px 8px;
  background: none;
  border: none;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  opacity: 0.65;
  color: inherit;
  cursor: pointer;
}
.empty {
  font-size: 12px;
  opacity: 0.55;
  padding: 6px 8px;
}
.row {
  display: flex;
  align-items: center;
  border-radius: 4px;
}
.row:hover { background: var(--bg-elevated, #222); }
.rowLabel {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  background: none;
  border: none;
  color: inherit;
  text-align: left;
  cursor: pointer;
  font-size: 13px;
  min-width: 0;
}
.thumb {
  width: 32px;
  height: 32px;
  object-fit: cover;
  border-radius: 4px;
  flex-shrink: 0;
}
.thumbPlaceholder {
  width: 32px;
  height: 32px;
  background: var(--bg-elevated, #2a2a2a);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  opacity: 0.7;
  flex-shrink: 0;
}
.name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.count {
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  opacity: 0.55;
}
.deleteBtn {
  width: 24px;
  height: 24px;
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  opacity: 0;
  font-size: 11px;
  transition: opacity 0.1s;
}
.row:hover .deleteBtn { opacity: 0.6; }
.deleteBtn:hover { opacity: 1; }
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
.addInput {
  margin-top: 6px;
  padding: 6px 8px;
  background: var(--bg-elevated, #222);
  border: 1px solid var(--accent, #4ade80);
  border-radius: 4px;
  color: inherit;
  font-size: 13px;
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck:web`
Expected: clean.

- [ ] **Step 4: Commit**

```
git commit -m "$(cat <<'EOF'
feat(renderer): CharactersSidebar component

Collapsible third sidebar for Gallery. Each row shows the first
reference image (or initial-letter placeholder), the name, and the
ref count. Inline +New input, hover delete (with confirm), click to
open detail modal.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: GalleryView — add third column + right-click "Use as reference for…"

**Files:**
- Modify: `src/renderer/src/views/GalleryView.tsx`
- Modify: `src/renderer/src/views/GalleryView.module.css`

- [ ] **Step 1: Add hook + state**

In `GalleryView.tsx`, add imports:

```tsx
import { useCharacters } from '../hooks/useCharacters'
import { CharactersSidebar } from '../components/CharactersSidebar'
import { CharacterDetail } from '../components/CharacterDetail'
import type { StoredCharacter } from '@preload/index'
```

Inside the component, after the existing `useProjects()` hook:

```tsx
const chars = useCharacters()
const [detailFor, setDetailFor] = useState<StoredCharacter | null>(null)
const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entryId: string } | null>(null)
```

- [ ] **Step 2: Add CharactersSidebar to the layout**

In the JSX return, the existing `.layout` div has `[ProjectSidebar | gridColumn]`. Add `<CharactersSidebar>` as the third child:

```tsx
<div className={styles.layout}>
  <ProjectSidebar ...existing props... />
  <div className={styles.gridColumn}>
    {/* existing grid */}
  </div>
  <CharactersSidebar
    characters={chars.characters}
    onOpenDetail={(c) => setDetailFor(c)}
    onCreate={(name) => chars.create({ name })}
    onDelete={chars.delete}
  />
</div>
```

- [ ] **Step 3: Add the CharacterDetail modal at the bottom of the wrap**

After the closing `.layout` div, before the closing `.wrap` div:

```tsx
<CharacterDetail
  open={detailFor !== null}
  character={detailFor}
  onClose={() => setDetailFor(null)}
  onSave={async (patch) => {
    if (detailFor) await chars.update(detailFor.id, patch)
  }}
  onAddReference={async (sourcePath) => {
    if (detailFor) await chars.addReference(detailFor.id, sourcePath)
  }}
  onRemoveReference={async (refPath) => {
    if (detailFor) await chars.removeReference(detailFor.id, refPath)
  }}
/>
```

The `detailFor` state will refresh automatically via `useCharacters` re-render after each mutation; the modal reads from `chars.characters` indirectly by passing `detailFor` (which points to the latest snapshot only at the moment it was set). To always render the latest character, **derive `currentDetail`**:

```tsx
const currentDetail = detailFor
  ? chars.characters.find((c) => c.id === detailFor.id) ?? null
  : null
```

Pass `currentDetail` to the modal instead of `detailFor`.

- [ ] **Step 4: Add right-click "Use as reference for…" on gallery entries**

Find the existing grid entry render (likely a `<button>` or `<div>` with `onClick`). Add `onContextMenu`:

```tsx
onContextMenu={(e) => {
  e.preventDefault()
  setContextMenu({ x: e.clientX, y: e.clientY, entryId: entry.id })
}}
```

Add the context menu render (after the existing JSX, before any closing tags):

```tsx
{contextMenu && (
  <div
    className={styles.contextMenu}
    style={{ left: contextMenu.x, top: contextMenu.y }}
    onMouseLeave={() => setContextMenu(null)}
  >
    <div className={styles.contextMenuHeader}>Use as reference for…</div>
    {chars.characters.length === 0 && (
      <div className={styles.contextMenuEmpty}>No characters yet</div>
    )}
    {chars.characters.map((c) => {
      const entry = visibleEntries.find((e) => e.id === contextMenu.entryId)
      const sourcePath = entry?.filePath
      const atCap = c.referenceImages.length >= 10
      return (
        <button
          key={c.id}
          className={styles.contextMenuItem}
          disabled={atCap || !sourcePath}
          onClick={async () => {
            setContextMenu(null)
            if (sourcePath) await chars.addReference(c.id, sourcePath)
          }}
        >
          {c.name} {atCap ? '(full)' : ''}
        </button>
      )
    })}
  </div>
)}
```

- [ ] **Step 5: Add CSS for the context menu and three-column layout**

In `GalleryView.module.css`:

```css
/* Three-column layout — keep existing .layout, .gridColumn rules. */

.contextMenu {
  position: fixed;
  z-index: 50;
  min-width: 200px;
  background: var(--bg-card, #1a1a1a);
  border: 1px solid var(--border, #333);
  border-radius: 6px;
  padding: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
}
.contextMenuHeader {
  padding: 6px 10px;
  font-size: 11px;
  text-transform: uppercase;
  opacity: 0.6;
}
.contextMenuEmpty {
  padding: 8px 10px;
  font-size: 12px;
  opacity: 0.55;
}
.contextMenuItem {
  display: block;
  width: 100%;
  padding: 6px 10px;
  background: none;
  border: none;
  color: inherit;
  text-align: left;
  cursor: pointer;
  font-size: 13px;
  border-radius: 4px;
}
.contextMenuItem:hover {
  background: var(--bg-elevated, #2a2a2a);
}
.contextMenuItem:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck:web`
Expected: clean.

- [ ] **Step 7: Run tests**

Run: `npm test`
Expected: 95/95 pass.

- [ ] **Step 8: Commit**

```
git commit -m "$(cat <<'EOF'
refactor(GalleryView): three-column + characters context menu

Adds CharactersSidebar as the third column and CharacterDetail
modal. Gallery entries now have a right-click "Use as reference
for…" menu that pipes the entry's filePath into chars.addReference.
Modal reads the latest character snapshot by deriving from
chars.characters list, so mid-edit reference additions reflect
immediately.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: GenerateView — wire CharacterPicker into the workflow

**Files:**
- Modify: `src/renderer/src/views/GenerateView.tsx`

- [ ] **Step 1: Add imports**

```tsx
import { useCharacters } from '../hooks/useCharacters'
import { CharacterPicker } from '../components/CharacterPicker'
import { CharacterDetail } from '../components/CharacterDetail'
import type { StoredCharacter } from '@preload/index'
```

- [ ] **Step 2: Add state + hook**

Near the other hooks (`useProjects`, `useWorkstationPool`), add:

```tsx
const chars = useCharacters()
const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null)
const [manageCharOpen, setManageCharOpen] = useState(false)

const selectedCharacter: StoredCharacter | null = selectedCharacterId
  ? chars.characters.find((c) => c.id === selectedCharacterId) ?? null
  : null
```

- [ ] **Step 3: Render the picker row**

Above (or below — your call) the existing "Save to" row, add:

```tsx
<CharacterPicker
  characters={chars.characters}
  selectedId={selectedCharacterId}
  onSelect={setSelectedCharacterId}
  onManage={() => setManageCharOpen(true)}
/>
```

- [ ] **Step 4: Pass character into the workflow build call**

Find the existing `pool.submit` (or `workflow.buildImage` + `pool.submit`) sequence. Replace the build/submit call. The current shape is approximately:

```tsx
const workflow = await window.api.workflow.buildImage({ prompt, ...params })
await pool.submit(workflow, runOn === 'auto' ? undefined : runOn)
```

Change to pass `character` AND build via the new local builder (so the renderer assembles BuildImageWorkflowOptions, which the main process can rebuild after upload). The cleanest way is to pass the build options through to the pool:

```tsx
const buildOptions: BuildImageWorkflowOptions = {
  prompt: params.prompt,
  // ...other existing fields...
  character: selectedCharacter ?? undefined
}
const workflow = await window.api.workflow.buildImage(buildOptions)
await pool.submit({
  workflow,
  hints: {
    preferWorkstation: runOn === 'auto' ? undefined : runOn,
    character: selectedCharacter ?? undefined
  },
  buildOptions
})
```

**Note:** the existing `pool.submit` signature in the renderer hook may take positional args. If so, update the hook wrapper in `useWorkstationPool.ts` to accept the new shape (workflow + hints + buildOptions) and pass through.

If the renderer-side `window.api.workflow.buildImage` doesn't know about `character`, it'll be ignored — that's fine, because the pool's pre-submit rebuild (Task 2) supplies it server-side.

- [ ] **Step 5: Render CharacterDetail modal for "Manage…"**

After the main return JSX:

```tsx
<CharacterDetail
  open={manageCharOpen}
  character={selectedCharacter}
  onClose={() => setManageCharOpen(false)}
  onSave={async (patch) => {
    if (selectedCharacter) await chars.update(selectedCharacter.id, patch)
  }}
  onAddReference={async (sourcePath) => {
    if (selectedCharacter) await chars.addReference(selectedCharacter.id, sourcePath)
  }}
  onRemoveReference={async (refPath) => {
    if (selectedCharacter) await chars.removeReference(selectedCharacter.id, refPath)
  }}
/>
```

If `selectedCharacter` is null but the user clicked "Manage…", route them to creating a new character first. Simplest: if `selectedCharacter` is null on click, create a fresh `Unnamed character` and select it:

```tsx
onManage={async () => {
  if (!selectedCharacter) {
    const c = await chars.create({ name: 'Untitled' })
    setSelectedCharacterId(c.id)
  }
  setManageCharOpen(true)
}}
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck:web`
Expected: clean.

- [ ] **Step 7: Run tests**

Run: `npm test`
Expected: 95/95 pass.

- [ ] **Step 8: Commit**

```
git commit -m "$(cat <<'EOF'
feat(GenerateView): CharacterPicker + workflow integration

Picker exposes the character list with a Manage… button. The
selected character flows into pool.submit as a hint AND into
buildOptions so the pool can rebuild the workflow after uploading
ref images. Manage… on None auto-creates an "Untitled" character
and opens the detail modal.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Acceptance walk-through + roadmap update

**Files:** none modified (except roadmap at the end).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all 95 tests pass (68 prior + 17 charactersStore + 10 workflow.character).

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: clean (both projects).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds with no errors.

- [ ] **Step 4: Boot the app**

```
unset ELECTRON_RUN_AS_NODE
npm run dev
```

Verify:
- App boots without renderer-console errors.
- Gallery view shows three columns: [Projects | grid | Characters].
- Characters sidebar starts empty.

- [ ] **Step 5: Walk through spec §8 acceptance criteria**

For each, perform the action and visually confirm:

1. **Create** — Click `+ New` in Characters sidebar → enter "Aria" → row appears with placeholder thumb. Detail modal opens automatically.
2. **Edit fields** — In modal, set description "tall warrior, silver hair", trigger "ariax" → Save → close → reopen → values persisted.
3. **Add ref (upload)** — In modal, "+ Add image" → file picker → pick PNG → thumb appears, file at `%APPDATA%\digitalassets\characters\<id>\refs\<uuid>.png`.
4. **Add ref (drag-drop)** — Drop PNG onto ref area → same result.
5. **Add ref from gallery** — Right-click a gallery entry → "Use as reference for…" → pick Aria → ref appended.
6. **Remove ref** — In modal, click ✕ on a ref thumb → file deleted, removed from array.
7. **10-image cap** — Add 10 refs → "+ Add image" button shows "Cap reached" and is disabled.
8. **Use in Generate (no refs)** — Open Generate → CharacterPicker → pick Aria → type prompt → Send → workflow uses description + trigger + LoRA + checkpoint per character. Job succeeds (if model installed).
9. **Use in Generate (with refs)** — Pick a character with 2 refs → Send → submission uploads both refs (visible as IPCs); workflow includes IPAdapter chain. Job succeeds on a workstation with `ComfyUI_IPAdapter_plus` installed.
10. **Delete character** — ✕ on sidebar row → confirm → row gone, folder gone, characters.json no longer lists it.
11. **Missing IPAdapter graceful error** — On a workstation without IPAdapter, submit a character with refs → job errors with `"Workstation 'X' rejected: missing node IPAdapterUnifiedLoader"`.
12. **Renderer crash recovery** — Close app mid-edit → reopen → state consistent.

- [ ] **Step 6: Final commit if any bug fixes were needed**

```
git commit -m "fix(phase-3): <describe>

Resolved during acceptance walk-through."
```

- [ ] **Step 7: Update roadmap**

Edit `docs/superpowers/specs/2026-05-19-flova-clone-roadmap.md`. Change the Phase 3 row:

```
| 3 | Characters library | ✅ Shipped | 1 | <latest hash> |
```

Commit:

```
git commit -m "docs(roadmap): mark Phase 3 shipped

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Final checklist

- [ ] All 11 tasks above completed
- [ ] `npm test` passes (95/95)
- [ ] `npm run typecheck` passes (both projects)
- [ ] `npm run build` succeeds
- [ ] `npm run dev` boots cleanly
- [ ] All 12 spec §8 acceptance criteria pass
- [ ] Roadmap updated and pushed

## Notes for the executor

- **TDD is mandatory for Tasks 0–1.** The pure-logic surface is the largest and most error-prone — write tests first, see them fail, implement.
- **Each task is a self-contained commit.** Don't bundle.
- **The `form-data` dependency in Task 2 may or may not be already resolvable.** If `node -e "require('form-data')"` fails, install it explicitly. axios used to bundle it but modern axios does not.
- **IPAdapter node names are locked to `ComfyUI_IPAdapter_plus`.** Other forks will fail — the spec accepts that. Phase 5 will add detection.
- **Filtering Gallery by character is intentionally not in this phase.** If you find yourself adding `characterId` to `HistoryEntry`, stop — it's deferred.
- **Renderer state derives from `chars.characters` snapshot** (not local copies) so mid-modal ref additions reflect immediately. See the `currentDetail` pattern in Task 9.
