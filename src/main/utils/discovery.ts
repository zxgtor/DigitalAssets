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

  const hosts = enumerateSubnet(local.ip, local.prefix).filter((h) => h !== local!.ip)
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
