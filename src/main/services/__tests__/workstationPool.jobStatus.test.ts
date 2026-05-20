import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WorkstationPool } from '../workstationPool'
import axios from 'axios'

vi.mock('axios')
const axiosGet = vi.mocked(axios.get)

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
  beforeEach(() => { vi.clearAllMocks() })

  it('transitions pending → running when ComfyUI shows it in queue_running', async () => {
    const pool = setupWithJob('p1')
    axiosGet.mockImplementation(async (url: string) => {
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
    axiosGet.mockImplementation(async (url: string) => {
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
    axiosGet.mockImplementation(async (url: string) => {
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
    axiosGet.mockImplementation(async (url: string) => {
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
