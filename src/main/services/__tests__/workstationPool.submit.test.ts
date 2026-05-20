import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WorkstationPool } from '../workstationPool'
import axios from 'axios'

vi.mock('axios')
const axiosPost = vi.mocked(axios.post)

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
  beforeEach(() => { vi.clearAllMocks() })

  it('returns a jobId synchronously after picking', async () => {
    const pool = pool3()
    axiosPost.mockResolvedValue({ data: { prompt_id: 'p1' } })
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
    expect(axiosPost).not.toHaveBeenCalled()
  })

  it('retries on first workstation rejection and succeeds on the second', async () => {
    const pool = pool3()
    let calls = 0
    axiosPost.mockImplementation(async () => {
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
    axiosPost.mockRejectedValue(new Error('boom'))
    await pool.submit({ workflow: TRIVIAL_WF as any, hints: {} })
    const job = pool.getJobs()[0]
    expect(job.status).toBe('error')
    expect(job.error).toMatch(/rejected/i)
  })

  it('auto-extracts requireModel from workflow checkpoint', async () => {
    const pool = pool3()
    axiosPost.mockResolvedValue({ data: { prompt_id: 'p3' } })
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
