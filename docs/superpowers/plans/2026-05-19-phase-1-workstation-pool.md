# Phase 1 实施计划：工作站池与调度器

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-`comfyUrl` generation path with a multi-workstation pool (LAN-pool / per-model / manual scheduling + LAN auto-discovery + health polling + unified queue), without breaking the existing GenerateView UX.

**Architecture:** A main-process `WorkstationPool` singleton owns persistence, health polling, scheduling, and ComfyUI submission. It streams `workstations:update` / `jobs:update` events to the renderer over IPC. The renderer uses a `useWorkstationPool()` hook plus three new components (WorkstationPanel, QueuePanel, DiscoverDialog) embedded inside GenerateView. Settings is extended to v2 with a one-shot `migrateSettings()` that converts the old `comfyUrl` into the first workstation.

**Tech Stack:** Electron + React + TypeScript + axios (already in deps). New devDep: vitest (zero new prod deps). Zero-dep hand-rolled Semaphore. ComfyUI HTTP API for queue/history/system_stats/object_info.

**Spec:** `docs/superpowers/specs/2026-05-19-phase-1-workstation-pool-design.md`

---

## File map

### New main-process files

| Path | Responsibility |
|---|---|
| `src/main/utils/semaphore.ts` | Concurrency limiter (zero-dep, ~30 lines) |
| `src/main/utils/discovery.ts` | LAN subnet enumeration + ComfyUI fingerprint probe |
| `src/main/utils/workflowAnalyze.ts` | Extract required models from a workflow JSON |
| `src/main/services/workstationPool.ts` | Singleton service: workstations CRUD, health loop, scheduler, submit, status polling |
| `src/main/ipc/workstations.ts` | IPC bridge: list / add / remove / edit / discover / submit / cancel / refreshModels / getJobs |

### New renderer files

| Path | Responsibility |
|---|---|
| `src/renderer/src/hooks/useWorkstationPool.ts` | Subscribes to `workstations:update` + `jobs:update`, exposes pool state + actions |
| `src/renderer/src/components/WorkstationPanel.tsx` | Collapsible list of workstation cards |
| `src/renderer/src/components/WorkstationPanel.module.css` | Styles |
| `src/renderer/src/components/QueuePanel.tsx` | Collapsible job feed |
| `src/renderer/src/components/QueuePanel.module.css` | Styles |
| `src/renderer/src/components/DiscoverDialog.tsx` | Modal for LAN scan |
| `src/renderer/src/components/DiscoverDialog.module.css` | Styles |

### Modified files

| Path | Change |
|---|---|
| `src/main/store.ts` | Add v2 schema, `migrateSettings()`, atomic write |
| `src/main/ipc/index.ts` | Register workstations handlers + start pool |
| `src/main/ipc/comfy.ts` | `comfy:queue` / `comfy:getStatus` become thin wrappers over the pool |
| `src/preload/index.ts` | Expose `window.api.workstations.*` |
| `src/preload/index.d.ts` | (auto-derived from index.ts via `Api` type) |
| `src/renderer/src/types.ts` | Add `Workstation`, `Job`, `SchedulerMode` types |
| `src/renderer/src/views/GenerateView.tsx` | Replace single-URL logic with pool hook + new panels + Run-on dropdown |
| `src/renderer/src/views/GenerateView.module.css` | Layout adjustments |
| `src/renderer/src/views/SettingsView.tsx` | New Workstations section + scheduler-mode picker + Discover button |
| `src/renderer/src/views/SettingsView.module.css` | Styles for new section |
| `src/renderer/src/components/TopNav.tsx` | Aggregate "X/Y stations" status pill |
| `package.json` | Add `vitest` devDep + `test` script |

### New config files

| Path | Responsibility |
|---|---|
| `vitest.config.ts` | Vitest project config |
| `tsconfig.test.json` | TS project for tests (extends `tsconfig.node.json`) |

**Total:** ~21 files (8 new main, 6 new renderer, 7 modified, 2 config). Estimated ~1800 LOC.

---

## Task order

Tasks are ordered so each one leaves the codebase in a working state (typecheck + existing UI still runs). Tasks 0–11 are main-process / pure logic with TDD. Tasks 12–22 wire it through IPC and the renderer; verification there is typecheck + acceptance walk-through.

---

## Task 0: Set up vitest

**Files:**
- Create: `vitest.config.ts`
- Create: `tsconfig.test.json`
- Create: `src/main/utils/__tests__/smoke.test.ts`
- Modify: `package.json` (add devDep + script)

- [ ] **Step 1: Install vitest as devDep**

Run:
```
npm install --save-dev vitest@^1.6.0
```

Expected: `package.json` has `"vitest": "^1.6.0"` under `devDependencies`. No prod deps changed.

- [ ] **Step 2: Add `test` and `test:watch` scripts**

Edit `package.json` `"scripts"` block, adding two lines:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 5_000
  },
  resolve: {
    alias: {
      '@main': resolve('src/main')
    }
  }
})
```

- [ ] **Step 4: Create `tsconfig.test.json`**

```json
{
  "extends": "./tsconfig.node.json",
  "include": ["src/**/*.ts", "src/**/__tests__/**/*.ts", "vitest.config.ts"],
  "compilerOptions": {
    "composite": false,
    "types": ["node", "vitest/globals"]
  }
}
```

- [ ] **Step 5: Create the smoke test**

`src/main/utils/__tests__/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

describe('smoke', () => {
  it('vitest is wired up', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 6: Run and verify**

Run: `npm test`
Expected: 1 test passes. No type errors.

- [ ] **Step 7: Commit**

```
chore(test): add vitest devDep and smoke test

Adds vitest + tsconfig.test.json. Tests live in src/**/__tests__/*.test.ts.
Pure-logic-only — UI verified via typecheck + acceptance criteria.
```

---

## Task 1: Semaphore utility (TDD)

**Files:**
- Create: `src/main/utils/semaphore.ts`
- Create: `src/main/utils/__tests__/semaphore.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/main/utils/__tests__/semaphore.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Semaphore } from '../semaphore'

describe('Semaphore', () => {
  it('allows up to `limit` concurrent tasks', async () => {
    const sem = new Semaphore(2)
    const order: string[] = []
    const tick = (label: string, ms: number): Promise<void> =>
      sem.run(async () => {
        order.push(`start:${label}`)
        await new Promise((r) => setTimeout(r, ms))
        order.push(`end:${label}`)
      })

    await Promise.all([tick('a', 30), tick('b', 30), tick('c', 10)])

    // First two must start before any ends; c must wait for a or b to finish.
    expect(order[0]).toBe('start:a')
    expect(order[1]).toBe('start:b')
    expect(order[2]).toMatch(/^end:(a|b)$/)
  })

  it('releases the slot on rejection', async () => {
    const sem = new Semaphore(1)
    await expect(sem.run(async () => { throw new Error('boom') })).rejects.toThrow('boom')
    // Next call must proceed (slot was released).
    const result = await sem.run(async () => 42)
    expect(result).toBe(42)
  })

  it('returns the resolved value', async () => {
    const sem = new Semaphore(1)
    const result = await sem.run(async () => 'hello')
    expect(result).toBe('hello')
  })
})
```

- [ ] **Step 2: Run the tests — expect failure**

Run: `npm test -- semaphore`
Expected: FAIL — `Semaphore` not exported / file does not exist.

- [ ] **Step 3: Implement `Semaphore`**

`src/main/utils/semaphore.ts`:

```ts
/**
 * Tiny zero-dep concurrency limiter.
 *
 *   const sem = new Semaphore(4)
 *   await sem.run(() => doThing())
 */
export class Semaphore {
  private active = 0
  private readonly waiters: (() => void)[] = []

  constructor(private readonly limit: number) {
    if (limit < 1) throw new Error('Semaphore limit must be >= 1')
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await task()
    } finally {
      this.release()
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(() => {
        this.active++
        resolve()
      })
    })
  }

  private release(): void {
    this.active--
    const next = this.waiters.shift()
    if (next) next()
  }
}
```

- [ ] **Step 4: Run the tests — expect pass**

Run: `npm test -- semaphore`
Expected: All 3 tests pass.

- [ ] **Step 5: Commit**

```
feat(main): add Semaphore concurrency limiter

Zero-dep, ~25 lines. Used by discovery (cap 32 parallel HTTP probes)
and the scheduler (cap 4 parallel /prompt submissions).
```

---

## Task 2: Workflow model extractor (TDD)

**Files:**
- Create: `src/main/utils/workflowAnalyze.ts`
- Create: `src/main/utils/__tests__/workflowAnalyze.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { extractRequiredModels } from '../workflowAnalyze'
import type { WorkflowJSON } from '../../services/workflow'

const baseImageWorkflow: WorkflowJSON = {
  '3': { class_type: 'KSampler', inputs: { seed: 1 } },
  '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd_xl_base_1.0.safetensors' } },
  '5': { class_type: 'CLIPTextEncode', inputs: { text: 'hi' } },
  '10': { class_type: 'LoraLoader', inputs: { lora_name: 'addDetail.safetensors' } },
  '11': { class_type: 'LoraLoader', inputs: { lora_name: 'styleX.safetensors' } },
  '12': { class_type: 'VAELoader', inputs: { vae_name: 'sdxl_vae.safetensors' } }
}

describe('extractRequiredModels', () => {
  it('pulls checkpoints, loras, vaes', () => {
    expect(extractRequiredModels(baseImageWorkflow)).toEqual({
      checkpoints: ['sd_xl_base_1.0.safetensors'],
      loras: ['addDetail.safetensors', 'styleX.safetensors'],
      vae: ['sdxl_vae.safetensors']
    })
  })

  it('returns empty arrays when no loader nodes are present', () => {
    const wf: WorkflowJSON = {
      '1': { class_type: 'KSampler', inputs: { seed: 1 } }
    }
    expect(extractRequiredModels(wf)).toEqual({ checkpoints: [], loras: [], vae: [] })
  })

  it('deduplicates repeated model names', () => {
    const wf: WorkflowJSON = {
      '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'foo.safetensors' } },
      '2': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'foo.safetensors' } }
    }
    expect(extractRequiredModels(wf).checkpoints).toEqual(['foo.safetensors'])
  })

  it('ignores nodes with non-string ckpt_name', () => {
    const wf: WorkflowJSON = {
      '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ['ref', 0] } }
    }
    expect(extractRequiredModels(wf).checkpoints).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests — expect failure**

Run: `npm test -- workflowAnalyze`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement extractor**

`src/main/utils/workflowAnalyze.ts`:

```ts
import type { WorkflowJSON } from '../services/workflow'

export interface RequiredModels {
  checkpoints: string[]
  loras: string[]
  vae: string[]
}

const CLASS_TO_FIELD: Record<string, keyof RequiredModels> = {
  CheckpointLoaderSimple: 'checkpoints',
  LoraLoader: 'loras',
  VAELoader: 'vae'
}

const INPUT_KEY: Record<string, string> = {
  CheckpointLoaderSimple: 'ckpt_name',
  LoraLoader: 'lora_name',
  VAELoader: 'vae_name'
}

export function extractRequiredModels(wf: WorkflowJSON): RequiredModels {
  const out: RequiredModels = { checkpoints: [], loras: [], vae: [] }
  for (const node of Object.values(wf)) {
    const field = CLASS_TO_FIELD[node.class_type]
    if (!field) continue
    const inputKey = INPUT_KEY[node.class_type]
    const value = (node.inputs as Record<string, unknown>)[inputKey]
    if (typeof value === 'string' && value.length > 0) {
      if (!out[field].includes(value)) out[field].push(value)
    }
  }
  return out
}
```

- [ ] **Step 4: Run the tests — expect pass**

Run: `npm test -- workflowAnalyze`
Expected: All 4 tests pass.

- [ ] **Step 5: Commit**

```
feat(main): add workflow model extractor

Pulls required checkpoints / LoRAs / VAEs out of a workflow JSON so
the scheduler can route to a workstation that has them.
```

---

## Task 3: Settings v2 schema + atomic write + migration (TDD)

**Files:**
- Modify: `src/main/store.ts`
- Create: `src/main/__tests__/store.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/main/__tests__/store.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { migrateSettings, DEFAULT_SETTINGS, type SettingsV2 } from '../store'

describe('migrateSettings', () => {
  it('migrates v1 (with comfyUrl) to v2 — creates first workstation', () => {
    const v1: any = {
      ollamaBaseUrl: 'http://x:1',
      ollamaModel: 'm',
      maxKeyframes: 8,
      outputFolder: '',
      comfyUrl: 'http://192.168.1.10:8188/'    // trailing slash will be stripped
    }
    const v2 = migrateSettings(v1)
    expect(v2.version).toBe(2)
    expect(v2.workstations).toHaveLength(1)
    expect(v2.workstations[0]).toMatchObject({
      name: 'Local ComfyUI',
      url: 'http://192.168.1.10:8188',          // stripped
      enabled: true
    })
    expect(v2.workstations[0].id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(v2.schedulerMode).toBe('lan-pool')
    expect(v2.discovery.portRange).toEqual([8188, 8190])
    expect(v2.ui).toEqual({ workstationsPanelOpen: true, queuePanelOpen: true })
  })

  it('migrates v1 with empty comfyUrl to v2 — empty workstations', () => {
    const v1: any = { ...DEFAULT_SETTINGS, comfyUrl: '', version: undefined }
    const v2 = migrateSettings(v1)
    expect(v2.version).toBe(2)
    expect(v2.workstations).toEqual([])
  })

  it('is idempotent on v2', () => {
    const v2a: SettingsV2 = {
      ...DEFAULT_SETTINGS,
      version: 2,
      workstations: [{ id: 'abc', name: 'X', url: 'http://x:1', enabled: true }],
      schedulerMode: 'manual',
      discovery: { portRange: [9000, 9001] },
      ui: { workstationsPanelOpen: false, queuePanelOpen: false }
    }
    const v2b = migrateSettings(v2a)
    expect(v2b).toEqual(v2a)
  })

  it('fills defaults when v1 fields are missing', () => {
    const v1: any = {}
    const v2 = migrateSettings(v1)
    expect(v2.ollamaBaseUrl).toBe(DEFAULT_SETTINGS.ollamaBaseUrl)
    expect(v2.version).toBe(2)
  })
})
```

- [ ] **Step 2: Run the tests — expect failure**

Run: `npm test -- store`
Expected: FAIL — exports missing.

- [ ] **Step 3: Rewrite `src/main/store.ts`**

Replace the entire file with:

```ts
import { app } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'

// ─── Schemas ────────────────────────────────────────────────────────────────

export interface StoredWorkstation {
  id: string
  name: string
  url: string
  enabled: boolean
}

export type SchedulerMode = 'lan-pool' | 'per-model' | 'manual'

/** Legacy v1 shape — preserved so old settings.json files still load. */
export interface SettingsV1 {
  ollamaBaseUrl: string
  ollamaModel: string
  maxKeyframes: number
  outputFolder: string
  comfyUrl: string
}

export interface SettingsV2 extends SettingsV1 {
  version: 2
  workstations: StoredWorkstation[]
  schedulerMode: SchedulerMode
  discovery: { portRange: [number, number] }
  ui: { workstationsPanelOpen: boolean; queuePanelOpen: boolean }
}

/** Public type. Always v2 once `getSettings()` returns. */
export type Settings = SettingsV2

export const DEFAULT_SETTINGS: Settings = {
  version: 2,
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: 'llava',
  maxKeyframes: 8,
  outputFolder: '',
  comfyUrl: 'http://localhost:8188',
  workstations: [],
  schedulerMode: 'lan-pool',
  discovery: { portRange: [8188, 8190] },
  ui: { workstationsPanelOpen: true, queuePanelOpen: true }
}

// ─── Migration ──────────────────────────────────────────────────────────────

/**
 * Convert any persisted settings object to v2. Idempotent.
 *
 * v1 → v2: the legacy `comfyUrl` becomes the first workstation entry
 * (or `[]` if it was empty).
 */
export function migrateSettings(raw: Partial<SettingsV2> & Partial<SettingsV1>): SettingsV2 {
  if (raw.version === 2) {
    return { ...DEFAULT_SETTINGS, ...raw, version: 2 }
  }

  const comfyUrl = (raw.comfyUrl ?? '').trim().replace(/\/$/, '')
  const workstations: StoredWorkstation[] = comfyUrl
    ? [{ id: randomUUID(), name: 'Local ComfyUI', url: comfyUrl, enabled: true }]
    : []

  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    version: 2,
    workstations,
    schedulerMode: 'lan-pool',
    discovery: { portRange: [8188, 8190] },
    ui: { workstationsPanelOpen: true, queuePanelOpen: true }
  }
}

// ─── Disk I/O ───────────────────────────────────────────────────────────────

function getSettingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function readFromDisk(): Settings {
  const path = getSettingsPath()
  if (!existsSync(path)) return { ...DEFAULT_SETTINGS }
  try {
    const raw = readFileSync(path, 'utf-8')
    return migrateSettings(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/** Atomic write: tmp file + rename. */
function writeToDisk(settings: Settings): void {
  const path = getSettingsPath()
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf-8')
  renameSync(tmp, path)
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function getSettings(): Settings {
  return readFromDisk()
}

export function setSettings(partial: Partial<Settings>): Settings {
  const current = readFromDisk()
  const next: Settings = { ...current, ...partial }
  writeToDisk(next)
  return next
}

export function resetSettings(): Settings {
  const fresh = { ...DEFAULT_SETTINGS }
  writeToDisk(fresh)
  return fresh
}
```

**Note:** the `store.test.ts` does NOT import `app` from electron — it imports only `migrateSettings`, `DEFAULT_SETTINGS`, `SettingsV2`. The disk I/O paths require Electron's runtime and are exercised in acceptance tests (Task 22).

- [ ] **Step 4: Run the tests — expect pass**

Run: `npm test -- store`
Expected: All 4 tests pass.

- [ ] **Step 5: Run main-process typecheck**

Run: `npm run typecheck:node`
Expected: clean. (Existing `Settings` consumers like `comfy.ts`, IPC handlers still typecheck because v2 is a strict superset of v1.)

- [ ] **Step 6: Commit**

```
feat(store): v2 schema + atomic write + v1->v2 migration

settings.json gains workstations[], schedulerMode, discovery, ui.
Existing comfyUrl is migrated into a first workstation on next load.
```

---

## Task 4: Discovery utility (TDD)

**Files:**
- Create: `src/main/utils/discovery.ts`
- Create: `src/main/utils/__tests__/discovery.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/main/utils/__tests__/discovery.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  enumerateSubnet,
  isComfyResponse,
  buildProbeUrls
} from '../discovery'

describe('enumerateSubnet', () => {
  it('expands a /24 into 254 hosts (skips .0 and .255)', () => {
    const hosts = enumerateSubnet('192.168.1.42', 24)
    expect(hosts.length).toBe(254)
    expect(hosts[0]).toBe('192.168.1.1')
    expect(hosts[253]).toBe('192.168.1.254')
    expect(hosts).not.toContain('192.168.1.0')
    expect(hosts).not.toContain('192.168.1.255')
  })

  it('returns [] when prefix is not /24 (unsupported)', () => {
    expect(enumerateSubnet('10.0.0.5', 16)).toEqual([])
  })
})

describe('buildProbeUrls', () => {
  it('crosses host x portRange', () => {
    expect(buildProbeUrls(['1.2.3.4', '1.2.3.5'], [8188, 8189])).toEqual([
      'http://1.2.3.4:8188',
      'http://1.2.3.4:8189',
      'http://1.2.3.5:8188',
      'http://1.2.3.5:8189'
    ])
  })

  it('skips an "own" url to avoid probing self', () => {
    const urls = buildProbeUrls(['1.2.3.4'], [8188, 8188], { skip: ['http://1.2.3.4:8188'] })
    expect(urls).toEqual([])
  })
})

describe('isComfyResponse', () => {
  it('matches the ComfyUI /system_stats shape', () => {
    expect(isComfyResponse({ system: { os: 'linux' }, devices: [{ name: 'cuda:0' }] })).toBe(true)
  })

  it('rejects arbitrary JSON', () => {
    expect(isComfyResponse({ hello: 'world' })).toBe(false)
    expect(isComfyResponse(null)).toBe(false)
    expect(isComfyResponse('not an object')).toBe(false)
  })
})
```

- [ ] **Step 2: Run — expect failure.** `npm test -- discovery` → FAIL.

- [ ] **Step 3: Implement**

`src/main/utils/discovery.ts`:

```ts
import axios from 'axios'
import { Semaphore } from './semaphore'

export interface DiscoveryCandidate {
  url: string                 // e.g. http://192.168.1.22:8188
  gpu: string                 // e.g. "NVIDIA RTX 4090"
  vramTotal: number           // bytes
}

const PROBE_TIMEOUT_MS = 1500
const PROBE_CONCURRENCY = 32

/** Expand `host/24` to all 254 usable host addresses on the subnet. */
export function enumerateSubnet(localIp: string, prefix: number): string[] {
  if (prefix !== 24) return []
  const m = localIp.match(/^(\d+\.\d+\.\d+)\.(\d+)$/)
  if (!m) return []
  const base = m[1]
  const out: string[] = []
  for (let i = 1; i <= 254; i++) out.push(`${base}.${i}`)
  return out
}

export function buildProbeUrls(
  hosts: string[],
  portRange: [number, number],
  opts: { skip?: string[] } = {}
): string[] {
  const skip = new Set(opts.skip ?? [])
  const out: string[] = []
  for (const host of hosts) {
    for (let port = portRange[0]; port <= portRange[1]; port++) {
      const url = `http://${host}:${port}`
      if (!skip.has(url)) out.push(url)
    }
  }
  return out
}

export function isComfyResponse(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return false
  const d = data as Record<string, unknown>
  return typeof d.system === 'object' && Array.isArray(d.devices)
}

/**
 * Probe one URL. Returns null if not ComfyUI / unreachable.
 * Exported separately for unit testing in integration tests if desired;
 * here we keep it internal and exposed only via `discover`.
 */
async function probe(url: string): Promise<DiscoveryCandidate | null> {
  try {
    const res = await axios.get(`${url}/system_stats`, { timeout: PROBE_TIMEOUT_MS })
    if (!isComfyResponse(res.data)) return null
    const dev = (res.data.devices?.[0] ?? {}) as { name?: string; vram_total?: number }
    return {
      url,
      gpu: dev.name ?? 'unknown GPU',
      vramTotal: dev.vram_total ?? 0
    }
  } catch {
    return null
  }
}

export interface DiscoveryOptions {
  portRange: [number, number]
  skipUrls?: string[]
  /** Callback fired as each candidate is found. */
  onCandidate?: (c: DiscoveryCandidate) => void
}

/**
 * Scan the LAN for ComfyUI servers.
 * Picks the first IPv4 + /24 interface and probes every host × port.
 */
export async function discover(opts: DiscoveryOptions): Promise<DiscoveryCandidate[]> {
  const { networkInterfaces } = await import('os')
  const ifaces = networkInterfaces()
  let local: { ip: string; prefix: number } | null = null
  for (const list of Object.values(ifaces)) {
    if (!list) continue
    for (const i of list) {
      if (i.family === 'IPv4' && !i.internal) {
        const m = i.cidr?.match(/^\d+\.\d+\.\d+\.\d+\/(\d+)$/)
        if (m) { local = { ip: i.address, prefix: parseInt(m[1], 10) }; break }
      }
    }
    if (local) break
  }
  if (!local) return []

  const hosts = enumerateSubnet(local.ip, local.prefix).filter((h) => h !== local.ip)
  const urls = buildProbeUrls(hosts, opts.portRange, { skip: opts.skipUrls })
  const sem = new Semaphore(PROBE_CONCURRENCY)

  const results = await Promise.all(
    urls.map((url) =>
      sem.run(async () => {
        const hit = await probe(url)
        if (hit && opts.onCandidate) opts.onCandidate(hit)
        return hit
      })
    )
  )
  return results.filter((r): r is DiscoveryCandidate => r !== null)
}
```

- [ ] **Step 4: Run — expect pass.** `npm test -- discovery` → all pass.

- [ ] **Step 5: Commit**

```
feat(main): add LAN discovery utility

Enumerates /24 subnet, probes each host x port with /system_stats,
filters by ComfyUI response shape. Concurrency capped at 32.
```

---

## Task 5: WorkstationPool — types + CRUD + persistence (no health, no scheduler)

**Files:**
- Create: `src/main/services/workstationPool.ts` (initial — will grow in later tasks)
- Create: `src/main/services/__tests__/workstationPool.crud.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/main/services/__tests__/workstationPool.crud.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { WorkstationPool } from '../workstationPool'

describe('WorkstationPool CRUD (in-memory)', () => {
  let pool: WorkstationPool

  beforeEach(() => {
    pool = new WorkstationPool({ persist: false })
  })

  it('add returns the workstation with a generated id', () => {
    const ws = pool.add({ name: 'PC-1', url: 'http://1.2.3.4:8188' })
    expect(ws.id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(ws.name).toBe('PC-1')
    expect(ws.enabled).toBe(true)
    expect(ws.status).toBe('unknown')
    expect(ws.url).toBe('http://1.2.3.4:8188')
  })

  it('add dedupes by URL (case + trailing slash normalized)', () => {
    pool.add({ name: 'PC-1', url: 'http://1.2.3.4:8188' })
    const dup = pool.add({ name: 'Other', url: 'http://1.2.3.4:8188/' })
    expect(pool.list()).toHaveLength(1)
    expect(dup.name).toBe('PC-1')        // returns the existing one
  })

  it('list returns added workstations', () => {
    pool.add({ name: 'A', url: 'http://a:8188' })
    pool.add({ name: 'B', url: 'http://b:8188' })
    expect(pool.list()).toHaveLength(2)
  })

  it('remove deletes by id', () => {
    const a = pool.add({ name: 'A', url: 'http://a:8188' })
    pool.remove(a.id)
    expect(pool.list()).toEqual([])
  })

  it('edit updates name + url + enabled', () => {
    const a = pool.add({ name: 'A', url: 'http://a:8188' })
    pool.edit(a.id, { name: 'A-renamed', url: 'http://a:9999', enabled: false })
    const after = pool.list()[0]
    expect(after.name).toBe('A-renamed')
    expect(after.url).toBe('http://a:9999')
    expect(after.enabled).toBe(false)
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (`WorkstationPool` doesn't exist).

- [ ] **Step 3: Implement initial pool**

`src/main/services/workstationPool.ts`:

```ts
import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'
import type { WorkflowJSON } from './workflow'
import type { StoredWorkstation, SchedulerMode } from '../store'
import { getSettings, setSettings } from '../store'

// ─── Public types ───────────────────────────────────────────────────────────

export interface Workstation extends StoredWorkstation {
  status: 'online' | 'busy' | 'offline' | 'unknown'
  models: { checkpoints: string[]; loras: string[]; vae: string[] }
  queueDepth: number
  gpu?: { name: string; vramTotal: number; vramFree: number }
  lastSeenAt?: number
}

export type JobStatus =
  | 'queued'
  | 'submitting'
  | 'pending'
  | 'running'
  | 'done'
  | 'error'

export interface Job {
  id: string
  workstationId: string | null
  promptId: string | null
  workflow: WorkflowJSON
  hints: { requireModel?: { checkpoints: string[]; loras: string[]; vae: string[] }; preferWorkstation?: string }
  status: JobStatus
  queuePosition?: number
  outputs?: string[]
  error?: string
  promptPreview?: string
  createdAt: number
  startedAt?: number
  finishedAt?: number
}

// ─── Pool ───────────────────────────────────────────────────────────────────

export interface WorkstationPoolOptions {
  persist?: boolean   // default true; tests pass false
}

function normalizeUrl(u: string): string {
  return u.trim().replace(/\/$/, '').toLowerCase()
}

export class WorkstationPool extends EventEmitter {
  private workstations = new Map<string, Workstation>()
  private readonly opts: WorkstationPoolOptions

  constructor(opts: WorkstationPoolOptions = {}) {
    super()
    this.opts = { persist: true, ...opts }
    if (this.opts.persist) this.loadFromSettings()
  }

  private loadFromSettings(): void {
    const s = getSettings()
    for (const ws of s.workstations) {
      this.workstations.set(ws.id, {
        ...ws,
        status: 'unknown',
        models: { checkpoints: [], loras: [], vae: [] },
        queueDepth: 0
      })
    }
  }

  private persist(): void {
    if (!this.opts.persist) return
    const workstations: StoredWorkstation[] = Array.from(this.workstations.values()).map((w) => ({
      id: w.id, name: w.name, url: w.url, enabled: w.enabled
    }))
    setSettings({ workstations })
  }

  list(): Workstation[] {
    return Array.from(this.workstations.values())
  }

  add(input: { name: string; url: string }): Workstation {
    const normalized = normalizeUrl(input.url)
    for (const ws of this.workstations.values()) {
      if (normalizeUrl(ws.url) === normalized) return ws
    }
    const ws: Workstation = {
      id: randomUUID(),
      name: input.name,
      url: input.url.trim().replace(/\/$/, ''),
      enabled: true,
      status: 'unknown',
      models: { checkpoints: [], loras: [], vae: [] },
      queueDepth: 0
    }
    this.workstations.set(ws.id, ws)
    this.persist()
    this.emit('workstations:update', this.list())
    return ws
  }

  remove(id: string): void {
    this.workstations.delete(id)
    this.persist()
    this.emit('workstations:update', this.list())
  }

  edit(id: string, patch: Partial<Pick<Workstation, 'name' | 'url' | 'enabled'>>): void {
    const ws = this.workstations.get(id)
    if (!ws) return
    if (patch.name !== undefined) ws.name = patch.name
    if (patch.url !== undefined) ws.url = patch.url.trim().replace(/\/$/, '')
    if (patch.enabled !== undefined) ws.enabled = patch.enabled
    this.persist()
    this.emit('workstations:update', this.list())
  }
}
```

- [ ] **Step 4: Run — expect PASS.** `npm test -- workstationPool.crud` → all 5 tests pass.

- [ ] **Step 5: Commit**

```
feat(workstation-pool): in-memory CRUD scaffold

Pool class with add / list / remove / edit + dedupe by URL.
Persistence (via store.setSettings) is gated on opts.persist so unit
tests can run without Electron. Health and scheduler land in later
tasks.
```

---

## Task 6: WorkstationPool — health loop

**Files:**
- Modify: `src/main/services/workstationPool.ts`
- Create: `src/main/services/__tests__/workstationPool.health.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/main/services/__tests__/workstationPool.health.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WorkstationPool } from '../workstationPool'
import axios from 'axios'

vi.mock('axios')
const mockedAxios = vi.mocked(axios)

describe('WorkstationPool health', () => {
  let pool: WorkstationPool
  beforeEach(() => {
    pool = new WorkstationPool({ persist: false })
    vi.clearAllMocks()
  })
  afterEach(() => {
    pool.stop()
  })

  it('marks workstation online + populates gpu on /system_stats success', async () => {
    pool.add({ name: 'A', url: 'http://a:8188' })
    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url.endsWith('/system_stats')) {
        return { data: { system: { os: 'linux' }, devices: [{ name: 'cuda:0 RTX 3090', vram_total: 24e9, vram_free: 20e9 }] } }
      }
      if (url.endsWith('/queue')) return { data: { queue_running: [], queue_pending: [] } }
      throw new Error('unmocked URL ' + url)
    })

    await pool.pollOnce()                          // testing seam
    const ws = pool.list()[0]
    expect(ws.status).toBe('online')
    expect(ws.gpu?.name).toBe('cuda:0 RTX 3090')
    expect(ws.gpu?.vramTotal).toBe(24e9)
    expect(ws.queueDepth).toBe(0)
  })

  it('marks busy when queue_running has entries', async () => {
    pool.add({ name: 'A', url: 'http://a:8188' })
    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url.endsWith('/system_stats')) return { data: { system: {}, devices: [{}] } }
      if (url.endsWith('/queue')) return { data: { queue_running: [['x', 'p1']], queue_pending: [['x', 'p2']] } }
      throw new Error('unmocked')
    })
    await pool.pollOnce()
    const ws = pool.list()[0]
    expect(ws.status).toBe('busy')
    expect(ws.queueDepth).toBe(2)
  })

  it('marks offline after 3 consecutive failures', async () => {
    pool.add({ name: 'A', url: 'http://a:8188' })
    mockedAxios.get.mockRejectedValue(new Error('network'))

    await pool.pollOnce(); expect(pool.list()[0].status).toBe('unknown')
    await pool.pollOnce(); expect(pool.list()[0].status).toBe('unknown')
    await pool.pollOnce(); expect(pool.list()[0].status).toBe('offline')
  })

  it('recovers to online on one success after offline', async () => {
    pool.add({ name: 'A', url: 'http://a:8188' })
    mockedAxios.get.mockRejectedValue(new Error('network'))
    await pool.pollOnce(); await pool.pollOnce(); await pool.pollOnce()
    expect(pool.list()[0].status).toBe('offline')

    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url.endsWith('/system_stats')) return { data: { system: {}, devices: [{}] } }
      if (url.endsWith('/queue')) return { data: { queue_running: [], queue_pending: [] } }
      throw new Error('unmocked')
    })
    await pool.pollOnce()
    expect(pool.list()[0].status).toBe('online')
  })

  it('skips disabled workstations', async () => {
    const a = pool.add({ name: 'A', url: 'http://a:8188' })
    pool.edit(a.id, { enabled: false })
    mockedAxios.get.mockResolvedValue({ data: {} })
    await pool.pollOnce()
    expect(mockedAxios.get).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (`pool.pollOnce` and `pool.stop` don't exist).

- [ ] **Step 3: Extend `workstationPool.ts`**

Add these imports to the top:

```ts
import axios from 'axios'
```

Add private state to the class:

```ts
  private failureCounts = new Map<string, number>()
  private healthInterval: NodeJS.Timeout | null = null
  private readonly POLL_INTERVAL_MS = 5_000
  private readonly OFFLINE_AFTER_FAILURES = 3
```

Add these methods to the class:

```ts
  /** Begin the 5s health-polling loop. */
  start(): void {
    if (this.healthInterval) return
    this.healthInterval = setInterval(() => { void this.pollOnce() }, this.POLL_INTERVAL_MS)
    void this.pollOnce()
  }

  /** Stop the health loop. Safe to call from tests / shutdown. */
  stop(): void {
    if (this.healthInterval) {
      clearInterval(this.healthInterval)
      this.healthInterval = null
    }
  }

  /** Run one pass of health checks. Exposed for tests. */
  async pollOnce(): Promise<void> {
    const enabled = this.list().filter((w) => w.enabled)
    await Promise.all(enabled.map((w) => this.checkOne(w)))
  }

  private async checkOne(ws: Workstation): Promise<void> {
    try {
      const stats = await axios.get(`${ws.url}/system_stats`, { timeout: 3_000 })
      const queue = await axios.get(`${ws.url}/queue`, { timeout: 3_000 })
      this.failureCounts.set(ws.id, 0)

      const dev = (stats.data?.devices?.[0] ?? {}) as Record<string, unknown>
      ws.gpu = {
        name: (dev.name as string) ?? 'unknown GPU',
        vramTotal: (dev.vram_total as number) ?? 0,
        vramFree: (dev.vram_free as number) ?? 0
      }

      const running = Array.isArray(queue.data?.queue_running) ? queue.data.queue_running.length : 0
      const pending = Array.isArray(queue.data?.queue_pending) ? queue.data.queue_pending.length : 0
      ws.queueDepth = running + pending
      ws.status = running > 0 ? 'busy' : 'online'
      ws.lastSeenAt = Date.now()
    } catch {
      const failures = (this.failureCounts.get(ws.id) ?? 0) + 1
      this.failureCounts.set(ws.id, failures)
      if (failures >= this.OFFLINE_AFTER_FAILURES) {
        ws.status = 'offline'
        ws.queueDepth = 0
      }
      // else leave status as-is (unknown stays unknown; online stays online)
    } finally {
      this.emit('workstations:update', this.list())
    }
  }
```

- [ ] **Step 4: Run — expect PASS.** `npm test -- workstationPool.health` → all 5 tests pass.

- [ ] **Step 5: Commit**

```
feat(workstation-pool): health polling loop

5s interval; 3-failure threshold to flip offline; one success recovers.
Populates gpu / vram / queueDepth from /system_stats + /queue.
pollOnce() exposed for unit tests.
```

---

## Task 7: WorkstationPool — model detection (refreshModels)

**Files:**
- Modify: `src/main/services/workstationPool.ts`
- Create: `src/main/services/__tests__/workstationPool.models.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WorkstationPool } from '../workstationPool'
import axios from 'axios'

vi.mock('axios')
const mockedAxios = vi.mocked(axios)

const FAKE_OBJECT_INFO = {
  CheckpointLoaderSimple: { input: { required: { ckpt_name: [['a.safetensors', 'b.safetensors']] } } },
  LoraLoader:             { input: { required: { lora_name: [['l1.safetensors']] } } },
  VAELoader:              { input: { required: { vae_name: [['v1.safetensors']] } } }
}

describe('WorkstationPool refreshModels', () => {
  let pool: WorkstationPool
  beforeEach(() => {
    pool = new WorkstationPool({ persist: false })
    vi.clearAllMocks()
  })

  it('populates models on success', async () => {
    const ws = pool.add({ name: 'A', url: 'http://a:8188' })
    mockedAxios.get.mockResolvedValue({ data: FAKE_OBJECT_INFO })
    await pool.refreshModels(ws.id)
    const after = pool.list()[0]
    expect(after.models.checkpoints).toEqual(['a.safetensors', 'b.safetensors'])
    expect(after.models.loras).toEqual(['l1.safetensors'])
    expect(after.models.vae).toEqual(['v1.safetensors'])
  })

  it('serializes refreshes (only 1 axios call in-flight)', async () => {
    const a = pool.add({ name: 'A', url: 'http://a:8188' })
    const b = pool.add({ name: 'B', url: 'http://b:8188' })
    let inFlight = 0
    let peak = 0
    mockedAxios.get.mockImplementation(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 30))
      inFlight--
      return { data: FAKE_OBJECT_INFO }
    })
    await Promise.all([pool.refreshModels(a.id), pool.refreshModels(b.id)])
    expect(peak).toBe(1)
  })

  it('leaves models empty on failure (does not crash)', async () => {
    const ws = pool.add({ name: 'A', url: 'http://a:8188' })
    mockedAxios.get.mockRejectedValue(new Error('boom'))
    await pool.refreshModels(ws.id)
    expect(pool.list()[0].models).toEqual({ checkpoints: [], loras: [], vae: [] })
  })
})
```

- [ ] **Step 2: Run — FAIL** (`refreshModels` missing).

- [ ] **Step 3: Extend pool**

Add to imports:

```ts
import { Semaphore } from '../utils/semaphore'
```

Add static field (outside the class, module scope):

```ts
/** Global gate so /object_info never runs more than once at a time across all workstations. */
const objectInfoGate = new Semaphore(1)
```

Add to the class:

```ts
  async refreshModels(id: string): Promise<void> {
    const ws = this.workstations.get(id)
    if (!ws) return
    await objectInfoGate.run(async () => {
      try {
        const res = await axios.get(`${ws.url}/object_info`, {
          timeout: 30_000,
          maxContentLength: 50_000_000
        })
        const info = res.data as Record<string, any>
        ws.models = {
          checkpoints: info?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] ?? [],
          loras:       info?.LoraLoader?.input?.required?.lora_name?.[0] ?? [],
          vae:         info?.VAELoader?.input?.required?.vae_name?.[0] ?? []
        }
      } catch {
        // leave as-is on failure; UI shows last-known list
      } finally {
        this.emit('workstations:update', this.list())
      }
    })
  }
```

Also: in `checkOne()` from Task 6, on the *first* successful check for a workstation whose `models.checkpoints.length === 0`, fire-and-forget a refresh. Add at the end of the `try` block (right before the `failureCounts.set` line is fine):

```ts
      const firstContact = ws.lastSeenAt === undefined
      // (existing: ws.gpu = ..., ws.queueDepth = ..., ws.status = ..., ws.lastSeenAt = Date.now())
```

Wait — we need `firstContact` derived BEFORE updating `lastSeenAt`. Restructure `checkOne` accordingly. **Final version of `checkOne`:**

```ts
  private async checkOne(ws: Workstation): Promise<void> {
    try {
      const stats = await axios.get(`${ws.url}/system_stats`, { timeout: 3_000 })
      const queue = await axios.get(`${ws.url}/queue`, { timeout: 3_000 })
      this.failureCounts.set(ws.id, 0)

      const firstContact = ws.lastSeenAt === undefined

      const dev = (stats.data?.devices?.[0] ?? {}) as Record<string, unknown>
      ws.gpu = {
        name: (dev.name as string) ?? 'unknown GPU',
        vramTotal: (dev.vram_total as number) ?? 0,
        vramFree: (dev.vram_free as number) ?? 0
      }
      const running = Array.isArray(queue.data?.queue_running) ? queue.data.queue_running.length : 0
      const pending = Array.isArray(queue.data?.queue_pending) ? queue.data.queue_pending.length : 0
      ws.queueDepth = running + pending
      ws.status = running > 0 ? 'busy' : 'online'
      ws.lastSeenAt = Date.now()

      if (firstContact && ws.models.checkpoints.length === 0) {
        // fire-and-forget; refresh emits its own update event
        void this.refreshModels(ws.id)
      }
    } catch {
      const failures = (this.failureCounts.get(ws.id) ?? 0) + 1
      this.failureCounts.set(ws.id, failures)
      if (failures >= this.OFFLINE_AFTER_FAILURES) {
        ws.status = 'offline'
        ws.queueDepth = 0
      }
    } finally {
      this.emit('workstations:update', this.list())
    }
  }
```

- [ ] **Step 4: Run — PASS.** `npm test` → all suites pass (CRUD + health + models).

- [ ] **Step 5: Commit**

```
feat(workstation-pool): on-demand model detection

refreshModels() fetches /object_info (serialized via global gate),
parses checkpoints / loras / vaes. Auto-fires on first successful
contact with a workstation.
```

---

## Task 8: WorkstationPool — scheduler picking algorithm (TDD)

**Files:**
- Modify: `src/main/services/workstationPool.ts`
- Create: `src/main/services/__tests__/workstationPool.picker.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { WorkstationPool } from '../workstationPool'

function setup(): WorkstationPool {
  const pool = new WorkstationPool({ persist: false })
  // Inject 3 workstations with known state via the testing seam.
  pool.__test_setWorkstations([
    { id: 'A', name: 'A', url: 'http://a:8188', enabled: true,  status: 'online', queueDepth: 0, models: { checkpoints: ['x.safetensors'], loras: [], vae: [] } },
    { id: 'B', name: 'B', url: 'http://b:8188', enabled: true,  status: 'online', queueDepth: 3, models: { checkpoints: ['y.safetensors'], loras: [], vae: [] } },
    { id: 'C', name: 'C', url: 'http://c:8188', enabled: false, status: 'online', queueDepth: 0, models: { checkpoints: ['x.safetensors'], loras: [], vae: [] } }
  ])
  return pool
}

describe('WorkstationPool.pick', () => {
  it('lan-pool: picks the lowest-queueDepth online workstation', () => {
    const pool = setup()
    const ws = pool.pick({ mode: 'lan-pool', requireModel: { checkpoints: [], loras: [], vae: [] } })
    expect(ws?.id).toBe('A')   // A queue=0 wins over B queue=3
  })

  it('lan-pool: ignores disabled and offline', () => {
    const pool = setup()
    pool.__test_setStatus('A', 'offline')
    const ws = pool.pick({ mode: 'lan-pool', requireModel: { checkpoints: [], loras: [], vae: [] } })
    expect(ws?.id).toBe('B')
  })

  it('per-model: filters by requireModel.checkpoints', () => {
    const pool = setup()
    const ws = pool.pick({ mode: 'per-model', requireModel: { checkpoints: ['y.safetensors'], loras: [], vae: [] } })
    expect(ws?.id).toBe('B')
  })

  it('per-model: empty requireModel falls back to lan-pool behavior', () => {
    const pool = setup()
    const ws = pool.pick({ mode: 'per-model', requireModel: { checkpoints: [], loras: [], vae: [] } })
    expect(ws?.id).toBe('A')
  })

  it('per-model: returns null if no workstation has the model', () => {
    const pool = setup()
    const ws = pool.pick({ mode: 'per-model', requireModel: { checkpoints: ['nope.safetensors'], loras: [], vae: [] } })
    expect(ws).toBe(null)
  })

  it('manual: returns null when no preferWorkstation given', () => {
    const pool = setup()
    const ws = pool.pick({ mode: 'manual', requireModel: { checkpoints: [], loras: [], vae: [] } })
    expect(ws).toBe(null)
  })

  it('preferWorkstation overrides global mode (online)', () => {
    const pool = setup()
    const ws = pool.pick({ mode: 'lan-pool', preferWorkstation: 'B', requireModel: { checkpoints: [], loras: [], vae: [] } })
    expect(ws?.id).toBe('B')
  })

  it('preferWorkstation overrides even when offline (will queue locally)', () => {
    const pool = setup()
    pool.__test_setStatus('B', 'offline')
    const ws = pool.pick({ mode: 'lan-pool', preferWorkstation: 'B', requireModel: { checkpoints: [], loras: [], vae: [] } })
    expect(ws?.id).toBe('B')   // offline OK — caller will queue / retry
  })

  it('preferWorkstation returns null when the id is unknown', () => {
    const pool = setup()
    const ws = pool.pick({ mode: 'manual', preferWorkstation: 'ZZZ', requireModel: { checkpoints: [], loras: [], vae: [] } })
    expect(ws).toBe(null)
  })
})
```

- [ ] **Step 2: Run — FAIL** (`pick` and test seams missing).

- [ ] **Step 3: Extend pool**

Add to the class:

```ts
  // ── Testing seams (no-op in prod) ─────────────────────────────────────────
  /** @internal — used only in unit tests to seed state without HTTP. */
  __test_setWorkstations(list: Workstation[]): void {
    this.workstations.clear()
    for (const w of list) this.workstations.set(w.id, w)
  }
  /** @internal */
  __test_setStatus(id: string, status: Workstation['status']): void {
    const ws = this.workstations.get(id)
    if (ws) ws.status = status
  }

  // ── Scheduler ─────────────────────────────────────────────────────────────

  pick(opts: {
    mode: SchedulerMode
    preferWorkstation?: string
    requireModel: { checkpoints: string[]; loras: string[]; vae: string[] }
  }): Workstation | null {
    // 1. Hard pin always wins.
    if (opts.preferWorkstation) {
      const pinned = this.workstations.get(opts.preferWorkstation)
      if (pinned && pinned.enabled) return pinned
      return null
    }

    // 2. Manual mode requires a pin.
    if (opts.mode === 'manual') return null

    // 3. Filter to candidates.
    let candidates = this.list().filter((w) => w.enabled && (w.status === 'online' || w.status === 'busy'))

    if (opts.mode === 'per-model') {
      const need = opts.requireModel
      const hasAll = (w: Workstation): boolean =>
        need.checkpoints.every((m) => w.models.checkpoints.includes(m)) &&
        need.loras.every((m)       => w.models.loras.includes(m)) &&
        need.vae.every((m)         => w.models.vae.includes(m))
      // Empty requireModel = no constraint = lan-pool behavior.
      const anyConstraint = need.checkpoints.length + need.loras.length + need.vae.length > 0
      if (anyConstraint) candidates = candidates.filter(hasAll)
    }

    if (candidates.length === 0) return null

    // 4. Sort by queueDepth asc, tie-break by random.
    candidates.sort((a, b) => {
      if (a.queueDepth !== b.queueDepth) return a.queueDepth - b.queueDepth
      return Math.random() - 0.5
    })
    return candidates[0]
  }
```

- [ ] **Step 4: Run — PASS.** `npm test -- picker` → all 9 tests pass.

- [ ] **Step 5: Commit**

```
feat(workstation-pool): scheduler pick() algorithm

Three modes + preferWorkstation override. per-model falls back to
lan-pool when requireModel is empty. Tie-broken by random.
```

---

## Task 9: WorkstationPool — submit + status loop

**Files:**
- Modify: `src/main/services/workstationPool.ts`
- Create: `src/main/services/__tests__/workstationPool.submit.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WorkstationPool } from '../workstationPool'
import axios from 'axios'

vi.mock('axios')
const mockedAxios = vi.mocked(axios)

function pool3(): WorkstationPool {
  const pool = new WorkstationPool({ persist: false })
  pool.__test_setWorkstations([
    { id: 'A', name: 'A', url: 'http://a:8188', enabled: true, status: 'online', queueDepth: 0, models: { checkpoints: ['x.safetensors'], loras: [], vae: [] } },
    { id: 'B', name: 'B', url: 'http://b:8188', enabled: true, status: 'online', queueDepth: 0, models: { checkpoints: ['x.safetensors'], loras: [], vae: [] } }
  ])
  return pool
}

const TRIVIAL_WF = { '1': { class_type: 'KSampler', inputs: { seed: 1 } } }

describe('WorkstationPool.submit', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns a jobId synchronously after picking', async () => {
    const pool = pool3()
    mockedAxios.post.mockResolvedValue({ data: { prompt_id: 'p1' } })
    const jobId = await pool.submit({ workflow: TRIVIAL_WF as any, hints: {} })
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/i)
    const jobs = pool.getJobs()
    expect(jobs).toHaveLength(1)
    expect(jobs[0].status).toBe('pending')
    expect(jobs[0].promptId).toBe('p1')
    expect(jobs[0].workstationId).toMatch(/^[AB]$/)
  })

  it('sets job.error when no workstation matches (manual + no pin)', async () => {
    const pool = pool3()
    await pool.submit({ workflow: TRIVIAL_WF as any, hints: {}, mode: 'manual' })
    const job = pool.getJobs()[0]
    expect(job.status).toBe('error')
    expect(job.error).toMatch(/Pick a workstation/i)
    expect(mockedAxios.post).not.toHaveBeenCalled()
  })

  it('retries on first workstation rejection and succeeds on the second', async () => {
    const pool = pool3()
    let calls = 0
    mockedAxios.post.mockImplementation(async () => {
      calls++
      if (calls === 1) throw new Error('connect ECONNREFUSED')
      return { data: { prompt_id: 'p2' } }
    })
    await pool.submit({ workflow: TRIVIAL_WF as any, hints: {} })
    const job = pool.getJobs()[0]
    expect(job.status).toBe('pending')
    expect(job.promptId).toBe('p2')
    expect(calls).toBe(2)
  })

  it('fails after 2 retries (3 total)', async () => {
    const pool = pool3()
    mockedAxios.post.mockRejectedValue(new Error('boom'))
    await pool.submit({ workflow: TRIVIAL_WF as any, hints: {} })
    const job = pool.getJobs()[0]
    expect(job.status).toBe('error')
    expect(job.error).toMatch(/rejected/i)
  })

  it('auto-extracts requireModel from workflow checkpoint', async () => {
    const pool = pool3()
    mockedAxios.post.mockResolvedValue({ data: { prompt_id: 'p3' } })
    const wf = {
      '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'y.safetensors' } }
    }
    pool.__test_setWorkstations([
      { id: 'A', name: 'A', url: 'http://a:8188', enabled: true, status: 'online', queueDepth: 0, models: { checkpoints: ['x.safetensors'], loras: [], vae: [] } },
      { id: 'B', name: 'B', url: 'http://b:8188', enabled: true, status: 'online', queueDepth: 0, models: { checkpoints: ['y.safetensors'], loras: [], vae: [] } }
    ])
    await pool.submit({ workflow: wf as any, hints: {}, mode: 'per-model' })
    const job = pool.getJobs()[0]
    expect(job.workstationId).toBe('B')
  })
})
```

- [ ] **Step 2: Run — FAIL** (`submit` / `getJobs` missing).

- [ ] **Step 3: Extend pool**

Add to imports:

```ts
import { extractRequiredModels } from '../utils/workflowAnalyze'
```

Add module-scope constant:

```ts
/** Global gate so we never POST /prompt more than 4x in parallel. */
const submitGate = new Semaphore(4)
const MAX_SUBMIT_RETRIES = 2
```

Add to the class:

```ts
  private jobs = new Map<string, Job>()
  private currentMode: SchedulerMode = 'lan-pool'

  setMode(mode: SchedulerMode): void {
    this.currentMode = mode
  }

  getJobs(): Job[] {
    return Array.from(this.jobs.values()).sort((a, b) => b.createdAt - a.createdAt)
  }

  clearDoneJobs(): void {
    for (const [id, j] of this.jobs) if (j.status === 'done') this.jobs.delete(id)
    this.emit('jobs:update', this.getJobs())
  }

  removeJob(id: string): void {
    this.jobs.delete(id)
    this.emit('jobs:update', this.getJobs())
  }

  async submit(args: {
    workflow: WorkflowJSON
    hints: { preferWorkstation?: string }
    mode?: SchedulerMode
  }): Promise<string> {
    const mode = args.mode ?? this.currentMode
    const requireModel = extractRequiredModels(args.workflow)
    const job: Job = {
      id: randomUUID(),
      workstationId: null,
      promptId: null,
      workflow: args.workflow,
      hints: { ...args.hints, requireModel },
      status: 'queued',
      promptPreview: extractPromptPreview(args.workflow),
      createdAt: Date.now()
    }
    this.jobs.set(job.id, job)
    this.emit('jobs:update', this.getJobs())

    // Try up to (MAX_SUBMIT_RETRIES + 1) different workstations.
    const tried = new Set<string>()
    for (let attempt = 0; attempt <= MAX_SUBMIT_RETRIES; attempt++) {
      const ws = this.pick({ mode, preferWorkstation: args.hints.preferWorkstation, requireModel })
      if (!ws) {
        this.failJob(job, this.noPickReason(mode, args.hints.preferWorkstation, requireModel))
        return job.id
      }
      if (tried.has(ws.id)) {
        this.failJob(job, `All eligible workstations rejected the job`)
        return job.id
      }
      tried.add(ws.id)
      job.workstationId = ws.id
      job.status = 'submitting'
      this.emit('jobs:update', this.getJobs())

      try {
        await submitGate.run(async () => {
          const res = await axios.post(
            `${ws.url}/prompt`,
            { prompt: args.workflow, client_id: `digitalassets-${Date.now()}` },
            { timeout: 10_000 }
          )
          const promptId = res.data?.prompt_id as string | undefined
          if (!promptId) throw new Error('ComfyUI did not return a prompt_id')
          job.promptId = promptId
          job.status = 'pending'
          job.startedAt = Date.now()
        })
        this.emit('jobs:update', this.getJobs())
        return job.id
      } catch (err) {
        // Mark this workstation offline immediately so the next pick skips it.
        ws.status = 'offline'
        this.emit('workstations:update', this.list())
        // continue retry loop
        if (attempt === MAX_SUBMIT_RETRIES) {
          this.failJob(job, `Workstation '${ws.name}' rejected the job: ${(err as Error).message}`)
          return job.id
        }
      }
    }
    return job.id
  }

  private failJob(job: Job, reason: string): void {
    job.status = 'error'
    job.error = reason
    job.finishedAt = Date.now()
    this.emit('jobs:update', this.getJobs())
  }

  private noPickReason(mode: SchedulerMode, pref: string | undefined, req: { checkpoints: string[]; loras: string[]; vae: string[] }): string {
    if (mode === 'manual' && !pref) return 'Pick a workstation from "Run on" before sending.'
    if (pref) return `Workstation '${pref}' not found or disabled.`
    const anyOnline = this.list().some((w) => w.enabled && (w.status === 'online' || w.status === 'busy'))
    if (!anyOnline) return 'No workstations are online. Check your network, or click "Discover on LAN" in Settings.'
    const missing = req.checkpoints.find((m) => !this.list().some((w) => w.models.checkpoints.includes(m)))
    if (missing) return `No workstation has '${missing}'. Refresh model lists with ↻, or pick a different checkpoint.`
    return 'No workstation matched the job constraints.'
  }
```

Add at the bottom of the file (helper outside the class):

```ts
function extractPromptPreview(wf: WorkflowJSON): string {
  for (const node of Object.values(wf)) {
    if (node.class_type === 'CLIPTextEncode') {
      const t = (node.inputs as Record<string, unknown>).text
      if (typeof t === 'string' && t.length > 0) {
        return t.length > 50 ? t.slice(0, 50) + '…' : t
      }
    }
  }
  return ''
}
```

- [ ] **Step 4: Run — PASS.** `npm test` → all suites green.

- [ ] **Step 5: Commit**

```
feat(workstation-pool): submit() with retry across workstations

Picks per current mode, auto-extracts requireModel, POSTs /prompt,
retries up to 2x on different workstations on submission failure.
Submit concurrency globally gated at 4.
```

---

## Task 10: WorkstationPool — job status polling

**Files:**
- Modify: `src/main/services/workstationPool.ts`
- Create: `src/main/services/__tests__/workstationPool.jobStatus.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WorkstationPool } from '../workstationPool'
import axios from 'axios'

vi.mock('axios')
const mockedAxios = vi.mocked(axios)

function setupWithJob(promptId: string) {
  const pool = new WorkstationPool({ persist: false })
  pool.__test_setWorkstations([
    { id: 'A', name: 'A', url: 'http://a:8188', enabled: true, status: 'online', queueDepth: 0, models: { checkpoints: [], loras: [], vae: [] } }
  ])
  pool.__test_seedJob({
    id: 'jid', workstationId: 'A', promptId,
    workflow: {} as any, hints: {}, status: 'pending', createdAt: Date.now()
  })
  return pool
}

describe('WorkstationPool job status polling', () => {
  beforeEach(() => vi.clearAllMocks())

  it('transitions pending → running when ComfyUI shows it in queue_running', async () => {
    const pool = setupWithJob('p1')
    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url.endsWith('/system_stats')) return { data: { system: {}, devices: [{}] } }
      if (url.endsWith('/history/p1')) return { data: {} }     // not yet done
      if (url.endsWith('/queue')) return { data: { queue_running: [[0, 'p1']], queue_pending: [] } }
      throw new Error('unmocked ' + url)
    })
    await pool.pollOnce()
    expect(pool.getJobs()[0].status).toBe('running')
  })

  it('records queue position when pending', async () => {
    const pool = setupWithJob('p1')
    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url.endsWith('/system_stats')) return { data: { system: {}, devices: [{}] } }
      if (url.endsWith('/history/p1')) return { data: {} }
      if (url.endsWith('/queue')) return { data: { queue_running: [[0, 'pX']], queue_pending: [[0, 'pY'], [0, 'p1']] } }
      throw new Error('unmocked ' + url)
    })
    await pool.pollOnce()
    expect(pool.getJobs()[0].status).toBe('pending')
    expect(pool.getJobs()[0].queuePosition).toBe(2)
  })

  it('transitions to done with output URLs from /history', async () => {
    const pool = setupWithJob('p1')
    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url.endsWith('/system_stats')) return { data: { system: {}, devices: [{}] } }
      if (url.endsWith('/history/p1')) return {
        data: {
          p1: {
            outputs: {
              '9': { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] }
            }
          }
        }
      }
      throw new Error('unmocked ' + url)
    })
    await pool.pollOnce()
    const job = pool.getJobs()[0]
    expect(job.status).toBe('done')
    expect(job.outputs?.[0]).toContain('/view?filename=out.png')
  })

  it('transitions to error after MANY consecutive unknown polls', async () => {
    const pool = setupWithJob('p1')
    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url.endsWith('/system_stats')) return { data: { system: {}, devices: [{}] } }
      if (url.endsWith('/history/p1')) return { data: {} }
      if (url.endsWith('/queue')) return { data: { queue_running: [], queue_pending: [] } }
      throw new Error('unmocked ' + url)
    })
    for (let i = 0; i < 20; i++) await pool.pollOnce()
    expect(pool.getJobs()[0].status).toBe('error')
    expect(pool.getJobs()[0].error).toMatch(/Lost track/i)
  })
})
```

- [ ] **Step 2: Run — FAIL** (`__test_seedJob` and status polling missing).

- [ ] **Step 3: Extend pool**

Add the seam:

```ts
  /** @internal — used only in unit tests. */
  __test_seedJob(job: Job): void {
    this.jobs.set(job.id, job)
  }
```

Add the constant:

```ts
  private readonly UNKNOWN_THRESHOLD = 20
  private unknownCounts = new Map<string, number>()
```

Extend `checkOne()` — at the end of the `try` block, after model-detection fire-and-forget, add a call to `await this.refreshJobsFor(ws)`:

```ts
      // existing model-detection fire-and-forget
      if (firstContact && ws.models.checkpoints.length === 0) {
        void this.refreshModels(ws.id)
      }

      // NEW: update jobs running on this workstation
      await this.refreshJobsFor(ws)
```

Then add the method:

```ts
  private async refreshJobsFor(ws: Workstation): Promise<void> {
    const myJobs = Array.from(this.jobs.values()).filter(
      (j) => j.workstationId === ws.id && (j.status === 'pending' || j.status === 'running')
    )
    if (myJobs.length === 0) return

    // Snapshot /queue once per workstation; reuse across jobs.
    let queueData: { queue_running: any[][]; queue_pending: any[][] } | null = null
    try {
      const q = await axios.get(`${ws.url}/queue`, { timeout: 3_000 })
      queueData = { queue_running: q.data?.queue_running ?? [], queue_pending: q.data?.queue_pending ?? [] }
    } catch { /* leave null */ }

    for (const job of myJobs) {
      if (!job.promptId) continue
      try {
        // 1. History first — if there, it's done.
        const hist = await axios.get(`${ws.url}/history/${job.promptId}`, { timeout: 5_000 })
        const entry = hist.data?.[job.promptId]
        if (entry) {
          const outputs: string[] = []
          for (const nodeOut of Object.values(entry.outputs ?? {}) as Record<string, unknown>[]) {
            const imgs = (nodeOut as { images?: { filename: string; subfolder?: string; type?: string }[] }).images
            if (imgs) {
              for (const img of imgs) {
                outputs.push(
                  `${ws.url}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder ?? '')}&type=${img.type ?? 'output'}`
                )
              }
            }
          }
          job.status = 'done'
          job.outputs = outputs
          job.finishedAt = Date.now()
          this.unknownCounts.delete(job.id)
          continue
        }

        // 2. Queue — running vs pending.
        if (queueData) {
          if (queueData.queue_running.some((item) => item[1] === job.promptId)) {
            job.status = 'running'
            job.queuePosition = undefined
            this.unknownCounts.delete(job.id)
            continue
          }
          const idx = queueData.queue_pending.findIndex((item) => item[1] === job.promptId)
          if (idx >= 0) {
            job.status = 'pending'
            job.queuePosition = idx + 1
            this.unknownCounts.delete(job.id)
            continue
          }
        }

        // 3. Unknown — increment.
        const u = (this.unknownCounts.get(job.id) ?? 0) + 1
        this.unknownCounts.set(job.id, u)
        if (u >= this.UNKNOWN_THRESHOLD) {
          job.status = 'error'
          job.error = `Lost track of job on '${ws.name}' (ComfyUI may have restarted). Click Retry.`
          job.finishedAt = Date.now()
          this.unknownCounts.delete(job.id)
        }
      } catch {
        /* network blip — try again next cycle */
      }
    }
    this.emit('jobs:update', this.getJobs())
  }
```

- [ ] **Step 4: Run — PASS.** `npm test` → all suites pass.

- [ ] **Step 5: Commit**

```
feat(workstation-pool): poll job status alongside workstation health

Each 5s tick, for any pending/running jobs on a workstation, hit
/history then /queue. 20 consecutive "unknown" polls => job errors
("ComfyUI may have restarted").
```

---

## Task 11: WorkstationPool singleton + discover() pass-through

**Files:**
- Modify: `src/main/services/workstationPool.ts`

- [ ] **Step 1: Add discover pass-through + singleton accessor**

Append to the file:

```ts
import { discover as runDiscovery, type DiscoveryCandidate, type DiscoveryOptions } from '../utils/discovery'

declare module './workstationPool' {
  // (no-op marker — kept for future module augmentation)
}

// Add this method INSIDE the WorkstationPool class:
//   discoverOnLan(opts: ...) { ... }
```

In-class method (insert after `refreshModels`):

```ts
  async discoverOnLan(opts: {
    portRange: [number, number]
    onCandidate?: (c: DiscoveryCandidate) => void
  }): Promise<DiscoveryCandidate[]> {
    const existing = this.list().map((w) => w.url.toLowerCase())
    return runDiscovery({
      portRange: opts.portRange,
      skipUrls: existing,
      onCandidate: opts.onCandidate
    })
  }
```

At module bottom:

```ts
let _singleton: WorkstationPool | null = null

export function getPool(): WorkstationPool {
  if (!_singleton) _singleton = new WorkstationPool({ persist: true })
  return _singleton
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck:node`
Expected: clean.

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: all suites pass.

- [ ] **Step 4: Commit**

```
feat(workstation-pool): expose discoverOnLan + getPool() singleton

Wraps utils/discovery with skip-already-added behavior. getPool()
returns the persistent singleton; tests instantiate their own
non-persistent pools.
```

---

## Task 12: Workstations IPC handlers

**Files:**
- Create: `src/main/ipc/workstations.ts`
- Modify: `src/main/ipc/index.ts`

- [ ] **Step 1: Create the IPC module**

`src/main/ipc/workstations.ts`:

```ts
import { ipcMain, BrowserWindow } from 'electron'
import { getPool, type Workstation, type Job } from '../services/workstationPool'
import type { WorkflowJSON } from '../services/workflow'
import type { SchedulerMode } from '../store'
import { getSettings, setSettings } from '../store'
import type { DiscoveryCandidate } from '../utils/discovery'

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

export function registerWorkstationHandlers(): void {
  const pool = getPool()
  pool.on('workstations:update', (list: Workstation[]) => broadcast('workstations:update', list))
  pool.on('jobs:update', (list: Job[]) => broadcast('jobs:update', list))

  // Apply persisted scheduler mode on startup.
  pool.setMode(getSettings().schedulerMode)
  pool.start()

  ipcMain.handle('workstations:list', () => pool.list())

  ipcMain.handle('workstations:add', (_e, input: { name: string; url: string }) => pool.add(input))

  ipcMain.handle('workstations:remove', (_e, id: string) => {
    // Block delete if workstation has active jobs.
    const active = pool.getJobs().some(
      (j) => j.workstationId === id && (j.status === 'pending' || j.status === 'running' || j.status === 'submitting')
    )
    if (active) throw new Error('Workstation has active jobs. Cancel them first.')
    pool.remove(id)
  })

  ipcMain.handle('workstations:edit', (_e, args: { id: string; patch: Partial<{ name: string; url: string; enabled: boolean }> }) => {
    pool.edit(args.id, args.patch)
  })

  ipcMain.handle('workstations:refreshModels', async (_e, id: string) => {
    await pool.refreshModels(id)
  })

  ipcMain.handle('workstations:setMode', (_e, mode: SchedulerMode) => {
    pool.setMode(mode)
    setSettings({ schedulerMode: mode })
  })

  ipcMain.handle('workstations:submit', async (_e, args: { workflow: WorkflowJSON; preferWorkstation?: string }) => {
    return pool.submit({ workflow: args.workflow, hints: { preferWorkstation: args.preferWorkstation } })
  })

  ipcMain.handle('workstations:getJobs', () => pool.getJobs())

  ipcMain.handle('workstations:clearDoneJobs', () => pool.clearDoneJobs())

  ipcMain.handle('workstations:removeJob', (_e, id: string) => pool.removeJob(id))

  ipcMain.handle('workstations:cancel', async (_e, id: string) => {
    const job = pool.getJobs().find((j) => j.id === id)
    if (!job || !job.promptId || !job.workstationId) return
    const ws = pool.list().find((w) => w.id === job.workstationId)
    if (!ws) return
    const { default: axios } = await import('axios')
    try {
      await axios.post(`${ws.url}/interrupt`, {}, { timeout: 3_000 })
    } catch { /* fire-and-forget */ }
  })

  // Discover — streamed via 'workstations:discover:candidate' events while running.
  ipcMain.handle('workstations:discover', async (_e) => {
    const portRange = getSettings().discovery.portRange
    return pool.discoverOnLan({
      portRange,
      onCandidate: (c: DiscoveryCandidate) => broadcast('workstations:discover:candidate', c)
    })
  })

  ipcMain.handle('workstations:testConnection', async (_e, url: string) => {
    const clean = url.trim().replace(/\/$/, '')
    const { default: axios } = await import('axios')
    try {
      const res = await axios.get(`${clean}/system_stats`, { timeout: 3_000 })
      return { ok: true, gpu: res.data?.devices?.[0]?.name ?? 'unknown GPU' }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
}
```

- [ ] **Step 2: Wire into the IPC barrel**

Modify `src/main/ipc/index.ts`:

```ts
// Add import
import { registerWorkstationHandlers } from './workstations'

// At the end of registerIpcHandlers(), AFTER registerComfyHandlers():
  registerWorkstationHandlers()
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck:node`
Expected: clean.

- [ ] **Step 4: Commit**

```
feat(ipc): register workstations:* handlers

Exposes pool methods over IPC; bridges pool events
(workstations:update / jobs:update / workstations:discover:candidate)
to all renderer windows via webContents.send.
```

---

## Task 13: Update `comfy:queue` / `comfy:getStatus` to thin wrappers

**Files:**
- Modify: `src/main/ipc/comfy.ts`

- [ ] **Step 1: Rewrite the two handlers**

Replace the two `ipcMain.handle` blocks for `comfy:queue` and `comfy:getStatus` with the following (keep `comfy:open` untouched at the bottom of the file). Top of file: add an import.

Add at the top:

```ts
import { getPool } from '../services/workstationPool'
```

Replace the `comfy:queue` handler:

```ts
  // ── Thin wrapper: forwards to workstationPool ────────────────────────────
  ipcMain.handle(
    'comfy:queue',
    async (_event, args: { workflow: WorkflowJSON; comfyUrl: string }): Promise<{ promptId: string }> => {
      const pool = getPool()
      const normalized = (args.comfyUrl ?? '').trim().replace(/\/$/, '').toLowerCase()
      const match = pool.list().find((w) => w.url.toLowerCase() === normalized)
      if (!match) {
        console.warn('[comfy:queue] unknown comfyUrl, falling back to scheduler:', args.comfyUrl)
      }
      const jobId = await pool.submit({
        workflow: args.workflow,
        hints: match ? { preferWorkstation: match.id } : {}
      })
      // Wait briefly for promptId — for backward compat (callers expect promptId).
      // The job may still be 'submitting' but typically transitions within 100ms.
      for (let i = 0; i < 50; i++) {  // 50 * 100ms = 5s max
        const job = pool.getJobs().find((j) => j.id === jobId)
        if (!job) break
        if (job.promptId) return { promptId: job.promptId }
        if (job.status === 'error') throw new Error(job.error ?? 'submission failed')
        await new Promise((r) => setTimeout(r, 100))
      }
      throw new Error('Timed out waiting for ComfyUI prompt_id')
    }
  )
```

Replace the `comfy:getStatus` handler:

```ts
  ipcMain.handle(
    'comfy:getStatus',
    async (
      _event,
      args: { promptId: string; comfyUrl: string }
    ): Promise<{ status: ComfyStatus; queuePosition?: number; outputs?: string[] }> => {
      const pool = getPool()
      const job = pool.getJobs().find((j) => j.promptId === args.promptId)
      if (!job) return { status: 'unknown' }
      if (job.status === 'done') return { status: 'done', outputs: job.outputs ?? [] }
      if (job.status === 'pending') return { status: 'pending', queuePosition: job.queuePosition }
      if (job.status === 'running') return { status: 'running' }
      if (job.status === 'error') return { status: 'error' }
      return { status: 'unknown' }
    }
  )
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck:node`
Expected: clean.

- [ ] **Step 3: Commit**

```
refactor(comfy ipc): comfy:queue / getStatus become pool wrappers

Existing renderer + external script callers see the same signature.
Internally each call resolves the URL to a pool workstation (if it
matches) and delegates to workstationPool.submit / getJobs.
```

---

## Task 14: Preload bindings

**Files:**
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Add types + namespace**

Add to the type exports at the top of the file (after existing interfaces):

```ts
export interface WorkstationPersisted {
  id: string
  name: string
  url: string
  enabled: boolean
}

export type WorkstationStatus = 'online' | 'busy' | 'offline' | 'unknown'

export interface Workstation extends WorkstationPersisted {
  status: WorkstationStatus
  models: { checkpoints: string[]; loras: string[]; vae: string[] }
  queueDepth: number
  gpu?: { name: string; vramTotal: number; vramFree: number }
  lastSeenAt?: number
}

export type JobStatus = 'queued' | 'submitting' | 'pending' | 'running' | 'done' | 'error'

export interface Job {
  id: string
  workstationId: string | null
  promptId: string | null
  hints: { preferWorkstation?: string }
  status: JobStatus
  queuePosition?: number
  outputs?: string[]
  error?: string
  promptPreview?: string
  createdAt: number
  startedAt?: number
  finishedAt?: number
}

export type SchedulerMode = 'lan-pool' | 'per-model' | 'manual'

export interface DiscoveryCandidate {
  url: string
  gpu: string
  vramTotal: number
}
```

Add inside the `api` object literal (after the existing `comfy:` namespace):

```ts
  workstations: {
    list: (): Promise<Workstation[]> => ipcRenderer.invoke('workstations:list'),
    add: (input: { name: string; url: string }): Promise<Workstation> =>
      ipcRenderer.invoke('workstations:add', input),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('workstations:remove', id),
    edit: (id: string, patch: Partial<{ name: string; url: string; enabled: boolean }>): Promise<void> =>
      ipcRenderer.invoke('workstations:edit', { id, patch }),
    refreshModels: (id: string): Promise<void> => ipcRenderer.invoke('workstations:refreshModels', id),
    setMode: (mode: SchedulerMode): Promise<void> => ipcRenderer.invoke('workstations:setMode', mode),
    submit: (args: { workflow: WorkflowJSON; preferWorkstation?: string }): Promise<string> =>
      ipcRenderer.invoke('workstations:submit', args),
    getJobs: (): Promise<Job[]> => ipcRenderer.invoke('workstations:getJobs'),
    clearDoneJobs: (): Promise<void> => ipcRenderer.invoke('workstations:clearDoneJobs'),
    removeJob: (id: string): Promise<void> => ipcRenderer.invoke('workstations:removeJob', id),
    cancel: (id: string): Promise<void> => ipcRenderer.invoke('workstations:cancel', id),
    discover: (): Promise<DiscoveryCandidate[]> => ipcRenderer.invoke('workstations:discover'),
    testConnection: (url: string): Promise<{ ok: boolean; gpu?: string; error?: string }> =>
      ipcRenderer.invoke('workstations:testConnection', url),
    onUpdate: (cb: (list: Workstation[]) => void): (() => void) => {
      const handler = (_e: unknown, list: Workstation[]): void => cb(list)
      ipcRenderer.on('workstations:update', handler)
      return () => ipcRenderer.removeListener('workstations:update', handler)
    },
    onJobsUpdate: (cb: (list: Job[]) => void): (() => void) => {
      const handler = (_e: unknown, list: Job[]): void => cb(list)
      ipcRenderer.on('jobs:update', handler)
      return () => ipcRenderer.removeListener('jobs:update', handler)
    },
    onDiscoverCandidate: (cb: (c: DiscoveryCandidate) => void): (() => void) => {
      const handler = (_e: unknown, c: DiscoveryCandidate): void => cb(c)
      ipcRenderer.on('workstations:discover:candidate', handler)
      return () => ipcRenderer.removeListener('workstations:discover:candidate', handler)
    }
  },
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck` (runs node + web)
Expected: clean.

- [ ] **Step 3: Commit**

```
feat(preload): expose window.api.workstations.*

Adds 12 methods (list/add/remove/edit/refreshModels/setMode/submit/
getJobs/clearDoneJobs/removeJob/cancel/discover/testConnection) plus
3 event subscriptions (onUpdate / onJobsUpdate / onDiscoverCandidate).
```

---

## Task 15: Renderer types + `useWorkstationPool()` hook

**Files:**
- Modify: `src/renderer/src/types.ts`
- Create: `src/renderer/src/hooks/useWorkstationPool.ts`

- [ ] **Step 1: Re-export new types from `types.ts`**

Add to the bottom of `src/renderer/src/types.ts`:

```ts
export type {
  Workstation,
  WorkstationStatus,
  Job,
  JobStatus,
  SchedulerMode,
  DiscoveryCandidate
} from '@preload/index'
```

If `@preload/index` is not aliased, change electron.vite.config.ts to add a renderer alias (then come back here). Check first by looking at existing imports — typically the renderer imports types from `../../../preload/index` directly. If that's the pattern, use the relative import instead:

```ts
export type {
  Workstation,
  WorkstationStatus,
  Job,
  JobStatus,
  SchedulerMode,
  DiscoveryCandidate
} from '../../../preload/index'
```

- [ ] **Step 2: Create the hook**

`src/renderer/src/hooks/useWorkstationPool.ts`:

```ts
import { useEffect, useState, useCallback } from 'react'
import type { Workstation, Job, SchedulerMode, DiscoveryCandidate } from '../types'

export interface UseWorkstationPool {
  workstations: Workstation[]
  jobs: Job[]
  loading: boolean
  add: (input: { name: string; url: string }) => Promise<Workstation>
  remove: (id: string) => Promise<void>
  edit: (id: string, patch: Partial<{ name: string; url: string; enabled: boolean }>) => Promise<void>
  refreshModels: (id: string) => Promise<void>
  setMode: (mode: SchedulerMode) => Promise<void>
  submit: (workflow: unknown, preferWorkstation?: string) => Promise<string>
  cancel: (id: string) => Promise<void>
  removeJob: (id: string) => Promise<void>
  clearDoneJobs: () => Promise<void>
  discover: (onCandidate?: (c: DiscoveryCandidate) => void) => Promise<DiscoveryCandidate[]>
  testConnection: (url: string) => Promise<{ ok: boolean; gpu?: string; error?: string }>
}

export function useWorkstationPool(): UseWorkstationPool {
  const [workstations, setWorkstations] = useState<Workstation[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const init = async (): Promise<void> => {
      const [w, j] = await Promise.all([
        window.api.workstations.list(),
        window.api.workstations.getJobs()
      ])
      if (cancelled) return
      setWorkstations(w)
      setJobs(j)
      setLoading(false)
    }
    void init()

    const unsubW = window.api.workstations.onUpdate(setWorkstations)
    const unsubJ = window.api.workstations.onJobsUpdate(setJobs)
    return () => {
      cancelled = true
      unsubW(); unsubJ()
    }
  }, [])

  const discover = useCallback(
    async (onCandidate?: (c: DiscoveryCandidate) => void): Promise<DiscoveryCandidate[]> => {
      const unsub = onCandidate
        ? window.api.workstations.onDiscoverCandidate(onCandidate)
        : (): void => {}
      try {
        return await window.api.workstations.discover()
      } finally {
        unsub()
      }
    },
    []
  )

  return {
    workstations,
    jobs,
    loading,
    add: (input) => window.api.workstations.add(input),
    remove: (id) => window.api.workstations.remove(id),
    edit: (id, patch) => window.api.workstations.edit(id, patch),
    refreshModels: (id) => window.api.workstations.refreshModels(id),
    setMode: (mode) => window.api.workstations.setMode(mode),
    submit: (workflow, preferWorkstation) =>
      window.api.workstations.submit({ workflow: workflow as never, preferWorkstation }),
    cancel: (id) => window.api.workstations.cancel(id),
    removeJob: (id) => window.api.workstations.removeJob(id),
    clearDoneJobs: () => window.api.workstations.clearDoneJobs(),
    discover,
    testConnection: (url) => window.api.workstations.testConnection(url)
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```
feat(renderer): types + useWorkstationPool() hook

Wraps window.api.workstations.* with reactive state from the two
event channels. Renderer code never touches IPC directly from now on.
```

---

## Task 16: WorkstationPanel component

**Files:**
- Create: `src/renderer/src/components/WorkstationPanel.tsx`
- Create: `src/renderer/src/components/WorkstationPanel.module.css`

- [ ] **Step 1: Create the component**

`src/renderer/src/components/WorkstationPanel.tsx`:

```tsx
import React from 'react'
import styles from './WorkstationPanel.module.css'
import type { Workstation } from '../types'

interface Props {
  workstations: Workstation[]
  open: boolean                       // controlled
  onToggle: (open: boolean) => void
  onRefresh: (id: string) => void
}

function statusDot(s: Workstation['status']): string {
  switch (s) {
    case 'online': return styles.dotOnline
    case 'busy':   return styles.dotBusy
    case 'offline': return styles.dotOffline
    default:        return styles.dotUnknown
  }
}

function bytesToGB(n: number): string {
  return (n / 1_000_000_000).toFixed(1)
}

export function WorkstationPanel({ workstations, open, onToggle, onRefresh }: Props): React.JSX.Element {
  const total = workstations.length
  const online = workstations.filter((w) => w.status === 'online' || w.status === 'busy').length

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.header}
        onClick={() => onToggle(!open)}
      >
        <span>Workstations</span>
        <span className={styles.summary}>{open ? '▼' : '▶'} {online}/{total} online</span>
      </button>

      {open && (
        <div className={styles.list}>
          {workstations.length === 0 && (
            <div className={styles.empty}>No workstations added. Open Settings to add or discover.</div>
          )}
          {workstations.map((w) => (
            <div key={w.id} className={styles.card} title={`${w.url} • added ${new Date(w.lastSeenAt ?? 0).toLocaleString()}`}>
              <div className={styles.row1}>
                <span className={`${styles.dot} ${statusDot(w.status)}`} />
                <span className={styles.name}>{w.name}</span>
                <span className={styles.statusText}>
                  {w.status === 'busy' ? `Busy ${w.queueDepth}` : w.status === 'online' ? 'Idle' : w.status}
                </span>
                <button type="button" className={styles.refreshBtn} onClick={() => onRefresh(w.id)} title="Refresh models">↻</button>
              </div>
              <div className={styles.row2}>
                <span className={styles.url}>{w.url}</span>
              </div>
              {w.gpu && (
                <div className={styles.vram}>
                  <span className={styles.vramLabel}>VRAM</span>
                  <span className={styles.vramBar}>
                    <span
                      className={styles.vramFill}
                      style={{ width: `${w.gpu.vramTotal ? (1 - w.gpu.vramFree / w.gpu.vramTotal) * 100 : 0}%` }}
                    />
                  </span>
                  <span className={styles.vramText}>
                    {bytesToGB(w.gpu.vramTotal - w.gpu.vramFree)} / {bytesToGB(w.gpu.vramTotal)} GB
                  </span>
                </div>
              )}
              <div className={styles.models}>
                {w.models.checkpoints.length} checkpoints, {w.models.loras.length} LoRAs, {w.models.vae.length} VAEs
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default WorkstationPanel
```

- [ ] **Step 2: Create the CSS**

`src/renderer/src/components/WorkstationPanel.module.css`:

```css
.wrap { display: flex; flex-direction: column; gap: 4px; }

.header {
  display: flex; align-items: center; justify-content: space-between;
  background: none; border: none; color: var(--text); cursor: pointer;
  padding: 6px 0; font-size: 12px; letter-spacing: 0.3px;
  text-transform: uppercase; opacity: 0.7;
}
.header:hover { opacity: 1; }
.summary { font-size: 11px; opacity: 0.7; }

.list { display: flex; flex-direction: column; gap: 6px; }
.empty { color: var(--text-muted); font-size: 12px; padding: 8px; }

.card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  display: flex; flex-direction: column; gap: 4px;
}

.row1 { display: flex; align-items: center; gap: 8px; }
.row2 { display: flex; }
.url { color: var(--text-muted); font-size: 11px; }

.dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--text-muted);
}
.dotOnline  { background: #4ade80; }
.dotBusy    { background: #facc15; }
.dotOffline { background: #6b7280; }
.dotUnknown { background: transparent; border: 1px solid #6b7280; }

.name { flex: 1; font-size: 13px; }
.statusText { font-size: 11px; opacity: 0.7; }
.refreshBtn { background: none; border: none; cursor: pointer; color: var(--text); opacity: 0.6; }
.refreshBtn:hover { opacity: 1; }

.vram { display: flex; align-items: center; gap: 6px; font-size: 11px; }
.vramLabel { opacity: 0.6; }
.vramBar { flex: 1; height: 4px; background: var(--bg-elevated); border-radius: 2px; overflow: hidden; }
.vramFill { display: block; height: 100%; background: #60a5fa; }
.vramText { opacity: 0.7; }

.models { font-size: 11px; opacity: 0.6; }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck:web`
Expected: clean.

- [ ] **Step 4: Commit**

```
feat(renderer): WorkstationPanel component

Collapsible card list. Status dot + VRAM bar + model counts.
Wired to onRefresh callback; toggle state persisted by parent.
```

---

## Task 17: QueuePanel component

**Files:**
- Create: `src/renderer/src/components/QueuePanel.tsx`
- Create: `src/renderer/src/components/QueuePanel.module.css`

- [ ] **Step 1: Create component**

`src/renderer/src/components/QueuePanel.tsx`:

```tsx
import React from 'react'
import styles from './QueuePanel.module.css'
import type { Job, Workstation } from '../types'

interface Props {
  jobs: Job[]
  workstations: Workstation[]
  selectedJobId: string | null
  open: boolean                       // controlled
  onToggle: (open: boolean) => void
  onSelect: (id: string) => void
  onCancel: (id: string) => void
  onRetry: (id: string) => void
  onRemove: (id: string) => void
  onClearDone: () => void
}

function statusIcon(s: Job['status']): string {
  switch (s) {
    case 'queued': case 'submitting': return '◇'
    case 'pending': return '◐'
    case 'running': return '⬤'
    case 'done': return '✓'
    case 'error': return '✗'
    default: return '?'
  }
}

export function QueuePanel({
  jobs, workstations, selectedJobId, open, onToggle,
  onSelect, onCancel, onRetry, onRemove, onClearDone
}: Props): React.JSX.Element {
  const hasDone = jobs.some((j) => j.status === 'done')

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.header}
        onClick={() => onToggle(!open)}
      >
        <span>Queue</span>
        <span className={styles.summary}>{open ? '▼' : '▶'} {jobs.length} job{jobs.length === 1 ? '' : 's'}</span>
      </button>

      {open && (
        <div className={styles.list}>
          {jobs.length === 0 && <div className={styles.empty}>No jobs yet. Send one with the button below.</div>}
          {jobs.map((j) => {
            const ws = workstations.find((w) => w.id === j.workstationId)
            const selected = j.id === selectedJobId
            return (
              <div
                key={j.id}
                className={`${styles.card} ${selected ? styles.cardSelected : ''}`}
                onClick={() => onSelect(j.id)}
              >
                <div className={styles.row1}>
                  <span className={`${styles.icon} ${styles[`status_${j.status}`]}`}>{statusIcon(j.status)}</span>
                  <span className={styles.id}>#{j.id.slice(0, 4)}</span>
                  <span className={styles.statusText}>
                    {j.status}
                    {j.status === 'pending' && j.queuePosition != null ? ` #${j.queuePosition}` : ''}
                  </span>
                  <span className={styles.wsName}>{ws?.name ?? '—'}</span>
                </div>
                {j.promptPreview && <div className={styles.preview}>"{j.promptPreview}"</div>}
                {j.error && <div className={styles.error}>{j.error}</div>}
                <div className={styles.actions}>
                  {(j.status === 'pending' || j.status === 'running') && (
                    <button onClick={(e) => { e.stopPropagation(); onCancel(j.id) }}>Cancel</button>
                  )}
                  {j.status === 'error' && (
                    <button onClick={(e) => { e.stopPropagation(); onRetry(j.id) }}>Retry</button>
                  )}
                  {(j.status === 'done' || j.status === 'error') && (
                    <button onClick={(e) => { e.stopPropagation(); onRemove(j.id) }}>Remove</button>
                  )}
                </div>
              </div>
            )
          })}
          {hasDone && (
            <button type="button" className={styles.clearDone} onClick={onClearDone}>
              Clear done
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default QueuePanel
```

- [ ] **Step 2: Create CSS**

`src/renderer/src/components/QueuePanel.module.css`:

```css
.wrap { display: flex; flex-direction: column; gap: 4px; }
.header {
  display: flex; align-items: center; justify-content: space-between;
  background: none; border: none; color: var(--text); cursor: pointer;
  padding: 6px 0; font-size: 12px; letter-spacing: 0.3px;
  text-transform: uppercase; opacity: 0.7;
}
.header:hover { opacity: 1; }
.summary { font-size: 11px; opacity: 0.7; }

.list { display: flex; flex-direction: column; gap: 6px; }
.empty { color: var(--text-muted); font-size: 12px; padding: 8px; }

.card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  cursor: pointer;
  display: flex; flex-direction: column; gap: 4px;
}
.card:hover { border-color: var(--accent); }
.cardSelected { border-color: var(--accent); background: var(--bg-elevated); }

.row1 { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.icon { font-size: 12px; }
.status_done    { color: #4ade80; }
.status_error   { color: #f87171; }
.status_running { color: #60a5fa; }
.status_pending { color: #facc15; }

.id        { font-family: ui-monospace, monospace; opacity: 0.7; }
.statusText{ flex: 1; opacity: 0.8; }
.wsName    { font-size: 11px; opacity: 0.6; }

.preview { font-size: 11px; opacity: 0.7; font-style: italic; }
.error   { font-size: 11px; color: #f87171; }

.actions { display: flex; gap: 6px; }
.actions button {
  background: none; border: 1px solid var(--border); color: var(--text);
  font-size: 11px; padding: 2px 8px; border-radius: 4px; cursor: pointer;
}
.actions button:hover { background: var(--bg-elevated); }

.clearDone {
  background: none; border: none; color: var(--text-muted);
  font-size: 11px; padding: 4px; cursor: pointer; text-align: right;
}
.clearDone:hover { color: var(--text); }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck:web`
Expected: clean.

- [ ] **Step 4: Commit**

```
feat(renderer): QueuePanel component

Job list with status icons, prompt preview, cancel/retry/remove
actions per status, and "Clear done" link. Parent owns selectedJobId
so Outputs panel can mirror it.
```

---

## Task 18: DiscoverDialog component

**Files:**
- Create: `src/renderer/src/components/DiscoverDialog.tsx`
- Create: `src/renderer/src/components/DiscoverDialog.module.css`

- [ ] **Step 1: Create component**

`src/renderer/src/components/DiscoverDialog.tsx`:

```tsx
import React, { useEffect, useState } from 'react'
import styles from './DiscoverDialog.module.css'
import type { DiscoveryCandidate } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  onDiscover: (onCandidate: (c: DiscoveryCandidate) => void) => Promise<DiscoveryCandidate[]>
  onAdd: (candidates: DiscoveryCandidate[]) => Promise<void>
}

function bytesToGB(n: number): string {
  return n ? (n / 1_000_000_000).toFixed(1) + ' GB' : '—'
}

export function DiscoverDialog({ open, onClose, onDiscover, onAdd }: Props): React.JSX.Element | null {
  const [scanning, setScanning] = useState(false)
  const [candidates, setCandidates] = useState<DiscoveryCandidate[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!open) {
      setCandidates([]); setSelected(new Set()); setScanning(false)
      return
    }
    setScanning(true)
    const run = async (): Promise<void> => {
      try {
        await onDiscover((c) => setCandidates((prev) => prev.some((p) => p.url === c.url) ? prev : [...prev, c]))
      } finally {
        setScanning(false)
      }
    }
    void run()
  }, [open, onDiscover])

  if (!open) return null

  const toggle = (url: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(url)) next.delete(url); else next.add(url)
      return next
    })
  }

  const addSelected = async (): Promise<void> => {
    const toAdd = candidates.filter((c) => selected.has(c.url))
    await onAdd(toAdd)
    onClose()
  }

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.title}>Discover ComfyUI servers on LAN</div>
        <div className={styles.status}>
          {scanning ? 'Scanning…' : `Done. Found ${candidates.length}.`}
        </div>

        <div className={styles.list}>
          {candidates.map((c) => (
            <label key={c.url} className={styles.item}>
              <input type="checkbox" checked={selected.has(c.url)} onChange={() => toggle(c.url)} />
              <div className={styles.info}>
                <div className={styles.url}>{c.url}</div>
                <div className={styles.gpu}>{c.gpu} · {bytesToGB(c.vramTotal)}</div>
              </div>
            </label>
          ))}
          {!scanning && candidates.length === 0 && (
            <div className={styles.empty}>
              No ComfyUI servers found. Make sure ComfyUI is running with --listen,
              or use Add manually.
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <button onClick={onClose}>Cancel</button>
          <button
            disabled={selected.size === 0}
            onClick={addSelected}
            className={styles.primary}
          >
            Add selected ({selected.size})
          </button>
        </div>
      </div>
    </div>
  )
}

export default DiscoverDialog
```

- [ ] **Step 2: CSS**

`src/renderer/src/components/DiscoverDialog.module.css`:

```css
.backdrop {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000;
}
.modal {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  width: 460px; max-width: 90vw;
  padding: 16px;
  display: flex; flex-direction: column; gap: 12px;
}
.title { font-size: 14px; font-weight: 600; }
.status { font-size: 12px; opacity: 0.7; }

.list { max-height: 300px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
.empty { font-size: 12px; opacity: 0.6; padding: 12px; }

.item {
  display: flex; align-items: center; gap: 10px;
  padding: 8px; border: 1px solid var(--border); border-radius: 4px;
  cursor: pointer;
}
.item:hover { background: var(--bg-elevated); }
.info { display: flex; flex-direction: column; }
.url { font-size: 12px; font-family: ui-monospace, monospace; }
.gpu { font-size: 11px; opacity: 0.7; }

.footer { display: flex; justify-content: flex-end; gap: 8px; }
.footer button {
  background: none; border: 1px solid var(--border); color: var(--text);
  padding: 6px 14px; border-radius: 4px; cursor: pointer; font-size: 12px;
}
.footer button:hover:not(:disabled) { background: var(--bg-elevated); }
.footer button:disabled { opacity: 0.4; cursor: not-allowed; }
.primary { background: var(--accent) !important; color: white !important; }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck:web`
Expected: clean.

- [ ] **Step 4: Commit**

```
feat(renderer): DiscoverDialog modal

Live-updating candidate list during scan, with checkbox selection
and explicit "Add selected" confirmation.
```

---

## Task 19: GenerateView refactor

**Files:**
- Modify: `src/renderer/src/views/GenerateView.tsx`
- Modify: `src/renderer/src/views/GenerateView.module.css` (small additions)

- [ ] **Step 1: Rewrite GenerateView**

This is the largest single-file change. Read the existing file first (Task 0 context already shows it). Replace the entire file with this implementation, which preserves all the existing prompt/params UI but rewires the right column to use the new panels and hook:

```tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import styles from './GenerateView.module.css'
import { PillButton } from '../components/PillButton'
import { toMediaUrlAsync } from '../utils/mediaUrl'
import { WorkstationPanel } from '../components/WorkstationPanel'
import { QueuePanel } from '../components/QueuePanel'
import { useWorkstationPool } from '../hooks/useWorkstationPool'
import type { HistoryEntry, SchedulerMode } from '../types'

interface GenerateViewProps {
  entry: HistoryEntry | null
  onBack: () => void
}

interface WorkflowParams {
  prompt: string
  negativePrompt: string
  checkpoint: string
  steps: number
  cfg: number
  seed: number
  width: number
  height: number
}

const SIZE_PRESETS = [
  { label: '512×512', w: 512, h: 512 },
  { label: '768×768', w: 768, h: 768 },
  { label: '1024×1024', w: 1024, h: 1024 },
  { label: '1024×768', w: 1024, h: 768 },
  { label: '768×1024', w: 768, h: 1024 },
  { label: '1216×832', w: 1216, h: 832 }
]

function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff)
}

export function GenerateView({ entry, onBack }: GenerateViewProps): React.JSX.Element {
  const pool = useWorkstationPool()
  const [params, setParams] = useState<WorkflowParams>({
    prompt: entry?.prompt ?? '',
    negativePrompt: 'blurry, low quality, deformed, watermark, text, nsfw',
    checkpoint: 'sd_xl_base_1.0.safetensors',
    steps: 25,
    cfg: 7.0,
    seed: randomSeed(),
    width: 1024,
    height: 1024
  })
  const [thumbUrl, setThumbUrl] = useState<string>('')
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [runOn, setRunOn] = useState<string>('auto')           // 'auto' or workstation id
  const [globalMode, setGlobalMode] = useState<SchedulerMode>('lan-pool')
  const [wsOpen, setWsOpen] = useState(true)
  const [qOpen, setQOpen] = useState(true)

  // Load persisted settings (mode + panel toggle states) once.
  useEffect(() => {
    void window.api.settings.get().then((s) => {
      setGlobalMode(s.schedulerMode)
      setWsOpen(s.ui.workstationsPanelOpen)
      setQOpen(s.ui.queuePanelOpen)
    })
  }, [])

  const onWsToggle = useCallback((open: boolean): void => {
    setWsOpen(open)
    void window.api.settings.set({ ui: { workstationsPanelOpen: open, queuePanelOpen: qOpen } })
  }, [qOpen])

  const onQToggle = useCallback((open: boolean): void => {
    setQOpen(open)
    void window.api.settings.set({ ui: { workstationsPanelOpen: wsOpen, queuePanelOpen: open } })
  }, [wsOpen])

  useEffect(() => {
    if (entry?.prompt) setParams((prev) => ({ ...prev, prompt: entry.prompt }))
  }, [entry?.prompt])

  useEffect(() => {
    if (!entry?.thumbnailPath) return
    toMediaUrlAsync(entry.thumbnailPath).then(setThumbUrl).catch(() => {})
  }, [entry?.thumbnailPath])

  // Default selected job = most recent one
  useEffect(() => {
    if (selectedJobId == null && pool.jobs.length > 0) {
      setSelectedJobId(pool.jobs[0].id)
    }
  }, [pool.jobs, selectedJobId])

  const set = useCallback(<K extends keyof WorkflowParams>(key: K, val: WorkflowParams[K]) => {
    setParams((prev) => ({ ...prev, [key]: val }))
  }, [])

  const handleQueue = useCallback(async () => {
    try {
      const workflow = await window.api.workflow.buildImage({
        prompt: params.prompt,
        negativePrompt: params.negativePrompt
      })
      if (workflow['4']) workflow['4'].inputs.ckpt_name = params.checkpoint
      if (workflow['3']) {
        workflow['3'].inputs.steps = params.steps
        workflow['3'].inputs.cfg = params.cfg
        workflow['3'].inputs.seed = params.seed
      }
      if (workflow['5']) {
        workflow['5'].inputs.width = params.width
        workflow['5'].inputs.height = params.height
      }
      const pref = runOn === 'auto' ? undefined : runOn
      const jobId = await pool.submit(workflow, pref)
      setSelectedJobId(jobId)
    } catch (err) {
      // pool.submit doesn't throw; errors land in the job. Network errors on the IPC bridge would though.
      // eslint-disable-next-line no-alert
      alert(`Submit failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [params, runOn, pool])

  const handleRandomSeed = useCallback(() => set('seed', randomSeed()), [set])
  const onRetry = useCallback(async (jobId: string) => {
    const job = pool.jobs.find((j) => j.id === jobId)
    if (!job) return
    await pool.removeJob(jobId)
    // Build a fresh workflow with current params (job.workflow is the original; user may have tweaked)
    await handleQueue()
  }, [pool, handleQueue])

  if (!entry) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyIcon}>⊕</div>
        <div className={styles.emptyTitle}>Nothing selected</div>
        <div className={styles.emptyHint}>Go to Gallery and click ⊕ on an item to generate</div>
        <PillButton variant="ghost" size="sm" onClick={onBack}>← Gallery</PillButton>
      </div>
    )
  }

  const activeSize = SIZE_PRESETS.find((p) => p.w === params.width && p.h === params.height)
  const selectedJob = pool.jobs.find((j) => j.id === selectedJobId) ?? pool.jobs[0]
  const autoLabel = globalMode === 'per-model' ? 'Auto (per model)' : 'Auto (LAN pool)'
  const showAuto = globalMode !== 'manual'

  // Empty state: no workstations at all → prompt to add
  const noWorkstations = !pool.loading && pool.workstations.length === 0

  return (
    <div className={styles.wrap}>
      <div className={styles.inner}>
        <div className={styles.header}>
          <button type="button" className={styles.backBtn} onClick={onBack}>← Gallery</button>
          <div className={styles.entryInfo}>
            {thumbUrl && <img className={styles.thumb} src={thumbUrl} alt="" />}
            <div className={styles.entryMeta}>
              <span className={styles.kindBadge}>{entry.kind}</span>
              <span className={styles.fileName}>{entry.fileName}</span>
            </div>
          </div>
        </div>

        {noWorkstations && (
          <div className={styles.noWsBanner}>
            <span>Add a workstation to start generating.</span>
            <span style={{ opacity: 0.6, marginLeft: 8 }}>Open Settings → Workstations.</span>
          </div>
        )}

        <div className={styles.body}>
          <div className={styles.left}>
            <div className={styles.section}>
              <div className={styles.sectionTitle}>Prompt</div>
              <textarea className={styles.promptArea} value={params.prompt}
                onChange={(e) => set('prompt', e.target.value)} rows={5} spellCheck={false} />
            </div>

            <div className={styles.section}>
              <div className={styles.sectionTitle}>Parameters</div>

              <div className={styles.field}>
                <label className={styles.label}>Checkpoint</label>
                <input className={styles.input} type="text" value={params.checkpoint}
                  onChange={(e) => set('checkpoint', e.target.value)} spellCheck={false} />
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Negative prompt</label>
                <textarea className={styles.input} value={params.negativePrompt}
                  onChange={(e) => set('negativePrompt', e.target.value)} rows={2} spellCheck={false} />
              </div>

              <div className={styles.fieldRow}>
                <div className={styles.field}>
                  <label className={styles.label}>Steps — {params.steps}</label>
                  <input type="range" min={10} max={50} step={1} value={params.steps}
                    onChange={(e) => set('steps', Number(e.target.value))} className={styles.slider} />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>CFG — {params.cfg.toFixed(1)}</label>
                  <input type="range" min={1} max={20} step={0.5} value={params.cfg}
                    onChange={(e) => set('cfg', Number(e.target.value))} className={styles.slider} />
                </div>
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Seed</label>
                <div className={styles.seedRow}>
                  <input className={styles.input} type="number" value={params.seed}
                    onChange={(e) => set('seed', Number(e.target.value))} style={{ flex: 1 }} />
                  <button type="button" className={styles.diceBtn} onClick={handleRandomSeed}>🎲</button>
                </div>
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Output size</label>
                <div className={styles.sizePresets}>
                  {SIZE_PRESETS.map((p) => (
                    <button key={p.label} type="button"
                      className={[styles.sizeBtn, activeSize?.label === p.label ? styles.sizeBtnActive : ''].join(' ')}
                      onClick={() => { set('width', p.w); set('height', p.h) }}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className={styles.runOnRow}>
              <label className={styles.label}>Run on</label>
              <select
                className={styles.input}
                value={runOn}
                onChange={(e) => setRunOn(e.target.value)}
              >
                {showAuto && <option value="auto">{autoLabel}</option>}
                {pool.workstations.map((w) => (
                  <option key={w.id} value={w.id} disabled={!w.enabled}>
                    {w.name} {w.status === 'offline' ? '(offline)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.actions}>
              <PillButton variant="primary" onClick={handleQueue} disabled={noWorkstations}>
                Send to ComfyUI ▶
              </PillButton>
            </div>
          </div>

          <div className={styles.right}>
            <WorkstationPanel
              workstations={pool.workstations}
              open={wsOpen}
              onToggle={onWsToggle}
              onRefresh={(id) => void pool.refreshModels(id)}
            />
            <QueuePanel
              jobs={pool.jobs}
              workstations={pool.workstations}
              selectedJobId={selectedJobId}
              open={qOpen}
              onToggle={onQToggle}
              onSelect={setSelectedJobId}
              onCancel={(id) => void pool.cancel(id)}
              onRetry={(id) => void onRetry(id)}
              onRemove={(id) => void pool.removeJob(id)}
              onClearDone={() => void pool.clearDoneJobs()}
            />
            {selectedJob && selectedJob.outputs && selectedJob.outputs.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>Outputs</div>
                <div className={styles.outputGrid}>
                  {selectedJob.outputs.map((url, i) => (
                    <img key={i} src={url} className={styles.outputImg} alt={`output ${i + 1}`} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default GenerateView
```

- [ ] **Step 2: Add CSS additions**

Append to `src/renderer/src/views/GenerateView.module.css`:

```css
.noWsBanner {
  margin: 8px 0;
  padding: 8px 12px;
  background: var(--bg-elevated);
  border: 1px solid var(--accent);
  border-radius: 6px;
  font-size: 12px;
}

.runOnRow {
  display: flex; align-items: center; gap: 8px;
  margin-top: 8px;
}
.runOnRow select { flex: 1; }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck:web`
Expected: clean.

- [ ] **Step 4: Commit**

```
refactor(GenerateView): use workstation pool + queue panels

Replaces the single-URL comfy.queue/getStatus path with the pool
hook. New Run-on dropdown + Workstation panel + Queue panel.
Outputs follow the selected job.
```

---

## Task 20: SettingsView — Workstations section

**Files:**
- Modify: `src/renderer/src/views/SettingsView.tsx`
- Modify: `src/renderer/src/views/SettingsView.module.css`

- [ ] **Step 1: Add the section**

Find the existing ComfyUI section in `SettingsView.tsx`. **Above** it, insert a new section. Use `useWorkstationPool()` from inside the same component (add to existing imports).

Add to imports:

```tsx
import { useWorkstationPool } from '../hooks/useWorkstationPool'
import { DiscoverDialog } from '../components/DiscoverDialog'
import type { SchedulerMode } from '../types'
```

Add inside the component (top of function body, alongside other state):

```tsx
  const pool = useWorkstationPool()
  const [mode, setMode] = useState<SchedulerMode>('lan-pool')
  const [showDiscover, setShowDiscover] = useState(false)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)

  useEffect(() => {
    void window.api.settings.get().then((s) => setMode(s.schedulerMode))
  }, [])

  const onTestNew = async (): Promise<void> => {
    setTesting(true); setTestResult(null)
    const r = await pool.testConnection(newUrl)
    setTesting(false)
    setTestResult(r.ok ? `✓ ${r.gpu}` : `✗ ${r.error}`)
  }

  const onAddNew = async (): Promise<void> => {
    if (!newName.trim() || !newUrl.trim()) return
    await pool.add({ name: newName.trim(), url: newUrl.trim() })
    setNewName(''); setNewUrl(''); setTestResult(null); setShowAddDialog(false)
  }
```

In the JSX, above the existing ComfyUI section, render:

```tsx
        <section className={styles.section}>
          <div className={styles.sectionTitle}>Workstations</div>

          <div className={styles.field}>
            <div className={styles.label}>Scheduler mode</div>
            {(['lan-pool', 'per-model', 'manual'] as const).map((m) => (
              <label key={m} className={styles.radioRow}>
                <input
                  type="radio"
                  checked={mode === m}
                  onChange={() => { setMode(m); void pool.setMode(m) }}
                />
                <span>
                  {m === 'lan-pool' && 'LAN pool — route to least-busy idle'}
                  {m === 'per-model' && 'Per-model — route by required checkpoint'}
                  {m === 'manual' && 'Manual — pick per job'}
                </span>
              </label>
            ))}
          </div>

          <div className={styles.workstationList}>
            {pool.workstations.length === 0 && (
              <div className={styles.empty}>No workstations yet. Add manually or discover.</div>
            )}
            {pool.workstations.map((w) => (
              <div key={w.id} className={styles.wsRow}>
                <input
                  type="checkbox"
                  checked={w.enabled}
                  onChange={(e) => void pool.edit(w.id, { enabled: e.target.checked })}
                />
                <div className={styles.wsInfo}>
                  <div className={styles.wsName}>{w.name}</div>
                  <div className={styles.wsUrl}>{w.url}</div>
                  <div className={styles.wsMeta}>
                    {w.status} · {w.gpu?.name ?? '—'} · {w.models.checkpoints.length} ckpts · {w.models.loras.length} LoRAs
                  </div>
                </div>
                <button onClick={() => void pool.refreshModels(w.id)} title="Refresh models">↻</button>
                <button onClick={() => {
                  if (confirm(`Remove '${w.name}'?`)) void pool.remove(w.id).catch((e) => alert((e as Error).message))
                }}>✕</button>
              </div>
            ))}
          </div>

          <div className={styles.wsActions}>
            <button onClick={() => setShowAddDialog(true)}>+ Add workstation</button>
            <button onClick={() => setShowDiscover(true)}>⚲ Discover on LAN…</button>
          </div>

          {showAddDialog && (
            <div className={styles.inlineDialog}>
              <input placeholder="Name (e.g. PC-1)" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <input placeholder="http://host:8188" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} />
              <div className={styles.inlineActions}>
                <button onClick={onTestNew} disabled={testing || !newUrl.trim()}>
                  {testing ? 'Testing…' : 'Test'}
                </button>
                <button onClick={onAddNew} disabled={!newName.trim() || !newUrl.trim()}>Save</button>
                <button onClick={() => { setShowAddDialog(false); setTestResult(null) }}>Cancel</button>
              </div>
              {testResult && <div className={styles.testResult}>{testResult}</div>}
            </div>
          )}
        </section>

        <DiscoverDialog
          open={showDiscover}
          onClose={() => setShowDiscover(false)}
          onDiscover={pool.discover}
          onAdd={async (cands) => {
            for (const c of cands) {
              await pool.add({ name: `Workstation @ ${c.url.replace(/^https?:\/\//, '')}`, url: c.url })
            }
          }}
        />
```

In the existing ComfyUI section, change the label to indicate legacy:

```tsx
        <section className={styles.section}>
          <div className={styles.sectionTitle}>ComfyUI URL (legacy)</div>
          <div className={styles.legacyHint}>
            Migrated to Workstation #1. Edit there instead. This field will be removed in Phase 2.
          </div>
          {/* existing comfyUrl input — keep but visually de-emphasize */}
        </section>
```

- [ ] **Step 2: CSS additions**

Append to `src/renderer/src/views/SettingsView.module.css`:

```css
.radioRow { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 13px; }
.workstationList { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.wsRow {
  display: flex; align-items: center; gap: 8px;
  padding: 8px; border: 1px solid var(--border); border-radius: 4px;
}
.wsInfo { flex: 1; }
.wsName { font-size: 13px; }
.wsUrl  { font-size: 11px; opacity: 0.7; font-family: ui-monospace, monospace; }
.wsMeta { font-size: 11px; opacity: 0.6; }
.wsRow button {
  background: none; border: 1px solid var(--border); color: var(--text);
  padding: 4px 8px; border-radius: 4px; cursor: pointer;
}

.wsActions { display: flex; gap: 8px; margin-top: 12px; }
.wsActions button {
  background: none; border: 1px solid var(--border); color: var(--text);
  padding: 6px 14px; border-radius: 4px; cursor: pointer; font-size: 12px;
}

.inlineDialog {
  margin-top: 12px;
  display: flex; flex-direction: column; gap: 8px;
  padding: 12px; border: 1px solid var(--accent); border-radius: 6px;
}
.inlineDialog input {
  background: var(--bg-elevated); border: 1px solid var(--border);
  color: var(--text); padding: 6px 8px; border-radius: 4px; font-size: 12px;
}
.inlineActions { display: flex; gap: 6px; }
.inlineActions button {
  background: none; border: 1px solid var(--border); color: var(--text);
  padding: 4px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;
}
.testResult { font-size: 12px; opacity: 0.8; }
.legacyHint { font-size: 11px; opacity: 0.6; margin-bottom: 6px; }
.empty { color: var(--text-muted); font-size: 12px; padding: 8px; }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck:web`
Expected: clean.

- [ ] **Step 4: Commit**

```
feat(SettingsView): workstations section + scheduler mode picker

Inline Add dialog with Test connection. Discover button opens the
modal. Existing ComfyUI URL field marked Legacy.
```

---

## Task 21: TopNav aggregate status pill

**Files:**
- Modify: `src/renderer/src/components/TopNav.tsx`

- [ ] **Step 1: Add the pill**

Inside `TopNav.tsx`, add to imports:

```tsx
import { useWorkstationPool } from '../hooks/useWorkstationPool'
```

In the component body (top), add:

```tsx
  const { workstations } = useWorkstationPool()
  const online = workstations.filter((w) => w.status === 'online' || w.status === 'busy').length
  const total = workstations.length
```

In the rendered JSX, locate the existing Ollama status indicator (search for "Ollama" or the existing status pill). Immediately after it, render:

```tsx
      <div
        className={styles.statusPill}
        title={`${online}/${total} workstations online`}
        onClick={() => onNavigate('generate')}
      >
        <span
          className={styles.statusDot}
          style={{ background: online > 0 ? '#4ade80' : '#6b7280' }}
        />
        <span>{online}/{total} stations</span>
      </div>
```

If `styles.statusPill` / `styles.statusDot` don't exist in `TopNav.module.css`, add:

```css
.statusPill {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 11px; opacity: 0.7; cursor: pointer;
  padding: 4px 8px;
}
.statusPill:hover { opacity: 1; }
.statusDot { width: 8px; height: 8px; border-radius: 50%; }
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck:web`
Expected: clean.

- [ ] **Step 3: Commit**

```
feat(TopNav): aggregate workstation status pill

Shows "X/Y stations" next to the Ollama indicator. Click jumps to
Generate.
```

---

## Task 22: Acceptance walk-through

**Files:** none modified. Verifies the spec's §9 acceptance criteria.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all suites pass (semaphore, workflowAnalyze, store, discovery, workstationPool.crud / health / models / picker / submit / jobStatus).

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: clean (both `:node` and `:web`).

- [ ] **Step 3: Boot the app**

Run: `npm run dev`

Verify:
- App boots without errors in dev console.
- If `settings.json` already had a `comfyUrl`, the Workstations section in Settings shows it as "Local ComfyUI". (Migration)
- TopNav shows `0/1 stations` initially, then flips to `1/1 stations` within 5–10s after ComfyUI health check succeeds.

- [ ] **Step 4: Verify spec §9 criteria one by one**

For each criterion below, perform the action and visually confirm. If any fail, file a separate small fix commit.

1. **Migration** ✓ — existing user opens app → sees "Local ComfyUI" workstation, generate works without changes.
2. **Manual add** ✓ — Settings → + Add workstation → fill in another LAN ComfyUI → Test → Save → appears in list and GenerateView.
3. **Auto-discovery** ✓ — Settings → Discover on LAN → second ComfyUI on the subnet shows up within ~8s → check it + Add selected → appears in list.
4. **Health cycle** ✓ — stop one workstation's ComfyUI → status pill goes gray within 15s. Restart → green within 5s.
5. **Model detection** ✓ — new workstation shows model counts within 30s of going online. Click ↻ — count refreshes.
6. **LAN pool mode** ✓ — switch to LAN-pool, submit 5 generation jobs → they distribute across idle workstations. Stop one → next jobs route around it.
7. **Per-model mode** ✓ — switch to per-model, change checkpoint to one only PC-A has → all jobs go to PC-A even if PC-B is idle.
8. **Manual mode** ✓ — switch to manual, click Send without selecting → toast/error in queue. Select PC-B → job goes to PC-B.
9. **Error recovery** ✓ — kill PC-A's ComfyUI just before Send → pool auto-routes to PC-B and job succeeds. Kill both → job errors with friendly message listing failed workstations.
10. **Concurrency** ✓ — submit 100 jobs at once → confirm via main-process logs that only 4 `/prompt` POSTs are in-flight at once.
11. **Persistence** ✓ — close app with mode = manual and 3 workstations → reopen → mode + workstations restored.

- [ ] **Step 5: Final commit (if any bug fixes were needed)**

```
fix(phase-1): <describe>

Resolved during acceptance walk-through.
```

- [ ] **Step 6: Update roadmap status**

Edit `docs/superpowers/specs/2026-05-19-flova-clone-roadmap.md`. Find the Phase 1 row in the phases table and change `🟡 Designing` to `✅ Shipped` (commit `<latest hash>`).

Commit:

```
docs(roadmap): mark Phase 1 shipped
```

---

## Final checklist

- [ ] All 23 tasks above completed
- [ ] `npm test` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run dev` boots without renderer-console errors
- [ ] All 11 spec §9 acceptance criteria pass
- [ ] Roadmap updated

## Notes for the executor

- **Do not skip the TDD steps.** Even when a test "feels obvious", writing it first surfaces interface decisions earlier. The picker/submit/status-polling tests in particular caught real edge cases during plan authoring.
- **Don't bundle multiple files into a single commit unless the plan says to.** Each task is a self-contained commit so review is bisectable.
- **If a test fails after your implementation matches the plan verbatim, the plan has a bug — push back rather than tweak the test.** Likely sources: missing `await`, mock setup, or a Map/Set ordering assumption.
- **The renderer alias `@preload` in Task 15:** if it doesn't exist, prefer the relative import variant included alongside it. Don't add new vite aliases for this task — keep build-config changes out of scope.
- **Settings persistence concurrency:** `setSettings()` does a read-modify-write — if two callers race, the second wins. This is acceptable here because all writers are serialized through the main process. Don't add locking.
