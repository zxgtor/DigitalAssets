import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WorkstationPool } from '../workstationPool'
import axios from 'axios'

vi.mock('axios')
const axiosGet = vi.mocked(axios.get)

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
    axiosGet.mockImplementation(async (url: string) => {
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
    axiosGet.mockImplementation(async (url: string) => {
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
    axiosGet.mockRejectedValue(new Error('network'))

    await pool.pollOnce(); expect(pool.list()[0].status).toBe('unknown')
    await pool.pollOnce(); expect(pool.list()[0].status).toBe('unknown')
    await pool.pollOnce(); expect(pool.list()[0].status).toBe('offline')
  })

  it('recovers to online on one success after offline', async () => {
    pool.add({ name: 'A', url: 'http://a:8188' })
    axiosGet.mockRejectedValue(new Error('network'))
    await pool.pollOnce(); await pool.pollOnce(); await pool.pollOnce()
    expect(pool.list()[0].status).toBe('offline')

    axiosGet.mockImplementation(async (url: string) => {
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
    axiosGet.mockResolvedValue({ data: {} })
    await pool.pollOnce()
    expect(axiosGet).not.toHaveBeenCalled()
  })
})
