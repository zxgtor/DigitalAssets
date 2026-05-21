/**
 * One-shot mock data seeder. Run with the app closed:
 *
 *   node scripts/seed-mock.js
 *
 * Writes:
 *   - settings.json with 3 workstations + lan-pool scheduler
 *   - history.json with 7 gallery entries
 *   - thumbnails/ copies of resources/icon.png as placeholders
 *
 * Originals are backed up to *.backup before overwrite.
 * To restore: rename the .backup files back, or delete settings.json +
 * history.json for fresh defaults.
 *
 * Note: jobs (QueuePanel) are in-memory only and can't be pre-seeded —
 * they populate once you submit a generation.
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')

const USER_DATA = path.join(os.homedir(), 'AppData', 'Roaming', 'digitalassets')
const PROJECT_ROOT = path.resolve(__dirname, '..')
const ICON = path.join(PROJECT_ROOT, 'resources', 'icon.png')

if (!fs.existsSync(ICON)) {
  console.error(`Missing placeholder image: ${ICON}`)
  process.exit(1)
}
fs.mkdirSync(USER_DATA, { recursive: true })

// ─── Workstations ───────────────────────────────────────────────────────────
// Note: runtime fields (status, models, gpu, queueDepth) come from the health
// loop, so "Mock — *" entries below will start as "unknown" and flip to
// "offline" after ~15s since they don't resolve. "Local ComfyUI" comes up
// "online" if you have ComfyUI running locally on 8188.
const workstations = [
  {
    id: crypto.randomUUID(),
    name: 'Local ComfyUI',
    url: 'http://localhost:8188',
    enabled: true
  },
  {
    id: crypto.randomUUID(),
    name: 'Mock — Studio RTX 4090',
    url: 'http://192.168.1.250:8188',
    enabled: true
  },
  {
    id: crypto.randomUUID(),
    name: 'Mock — Office RTX 3060',
    url: 'http://192.168.1.251:8188',
    enabled: false
  }
]

const settings = {
  version: 2,
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: 'llava',
  maxKeyframes: 8,
  outputFolder: '',
  comfyUrl: 'http://localhost:8188',
  workstations,
  schedulerMode: 'lan-pool',
  discovery: { portRange: [8188, 8190] },
  ui: { workstationsPanelOpen: true, queuePanelOpen: true }
}

// ─── Gallery entries ────────────────────────────────────────────────────────
const thumbnailsDir = path.join(USER_DATA, 'thumbnails')
fs.mkdirSync(thumbnailsDir, { recursive: true })

const samples = [
  {
    prompt: 'A cyberpunk skyline at dusk, neon reflections in wet pavement, ultra-detailed, cinematic lighting',
    model: 'sd_xl_base_1.0'
  },
  {
    prompt: 'Detailed portrait of an astronaut on Mars, dramatic rim lighting, photoreal, 85mm lens',
    model: 'dreamshaper_8'
  },
  {
    prompt: 'Cozy coffee shop interior, warm afternoon light through windows, vintage aesthetic',
    model: 'sd_xl_base_1.0'
  },
  {
    prompt: 'Forest path in autumn, mist rising between birch trees, soft golden hour',
    model: 'realisticVisionV6'
  },
  {
    prompt: 'Steampunk dragon perched on a Victorian clocktower, intricate brass details',
    model: 'dreamshaper_8'
  },
  {
    prompt: 'Abstract geometric pattern, vivid neon colors on black background, fractal symmetry',
    model: 'sd_xl_base_1.0'
  },
  {
    prompt: 'Mountain lake at sunrise, mirror-still water, snow-capped peaks reflected',
    model: 'realisticVisionV6'
  }
]

const now = Date.now()
const entries = samples.map((s, i) => {
  const id = `mock-${now}-${i}`
  const dst = path.join(thumbnailsDir, `${id}.png`)
  fs.copyFileSync(ICON, dst)
  return {
    id,
    kind: 'image',
    filePath: dst,
    fileName: `mock-${i + 1}.png`,
    prompt: s.prompt,
    model: s.model,
    createdAt: now - i * 1000 * 60 * 60 * 6, // staggered every 6 hours back
    thumbnailPath: dst
  }
})

// ─── Backup and write ───────────────────────────────────────────────────────
const settingsPath = path.join(USER_DATA, 'settings.json')
const historyPath = path.join(USER_DATA, 'history.json')

for (const p of [settingsPath, historyPath]) {
  if (fs.existsSync(p)) {
    const backup = `${p}.backup`
    fs.copyFileSync(p, backup)
    console.log(`backed up: ${path.basename(p)} → ${path.basename(backup)}`)
  }
}

fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
fs.writeFileSync(historyPath, JSON.stringify(entries, null, 2), 'utf-8')

console.log('')
console.log('Seeded:')
console.log(`  ${workstations.length} workstations  → ${settingsPath}`)
console.log(`  ${entries.length} gallery entries   → ${historyPath}`)
console.log(`  ${entries.length} thumbnail copies  in ${thumbnailsDir}`)
console.log('')
console.log('Restart the app to see the mock data.')
console.log('Jobs (QueuePanel) cannot be seeded — submit a generation to populate.')
console.log('')
console.log('Restore: rename *.backup back to the original name, or delete')
console.log('settings.json + history.json for fresh defaults.')
