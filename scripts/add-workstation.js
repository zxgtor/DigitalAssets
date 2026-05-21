/**
 * One-shot inject of a workstation into settings.json. Run with the app closed:
 *
 *   node scripts/add-workstation.js "<name>" "<url>"
 *
 * Example:
 *   node scripts/add-workstation.js "Home LAN ComfyUI" http://192.168.18.2:8000
 *
 * Backs up settings.json to .backup once before first modification.
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')

const [, , name, url] = process.argv
if (!name || !url) {
  console.error('Usage: node scripts/add-workstation.js "<name>" "<url>"')
  process.exit(1)
}

const SETTINGS = path.join(os.homedir(), 'AppData', 'Roaming', 'digitalassets', 'settings.json')
if (!fs.existsSync(SETTINGS)) {
  console.error(`settings.json not found at ${SETTINGS}`)
  process.exit(1)
}

const settings = JSON.parse(fs.readFileSync(SETTINGS, 'utf-8'))
if (settings.version !== 2) {
  console.error(`expected v2 settings, got version=${settings.version}`)
  process.exit(1)
}

const cleanUrl = url.trim().replace(/\/$/, '')
const dupe = (settings.workstations ?? []).find((w) => w.url.toLowerCase() === cleanUrl.toLowerCase())
if (dupe) {
  console.log(`A workstation with URL ${cleanUrl} already exists (name: "${dupe.name}"). Nothing to do.`)
  process.exit(0)
}

const backup = `${SETTINGS}.backup`
if (!fs.existsSync(backup)) {
  fs.copyFileSync(SETTINGS, backup)
  console.log(`backed up: settings.json -> settings.json.backup`)
}

settings.workstations = [...(settings.workstations ?? []), {
  id: crypto.randomUUID(),
  name,
  url: cleanUrl,
  enabled: true
}]

fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2), 'utf-8')
console.log(`added workstation: "${name}" -> ${cleanUrl}`)
console.log(`total workstations now: ${settings.workstations.length}`)
