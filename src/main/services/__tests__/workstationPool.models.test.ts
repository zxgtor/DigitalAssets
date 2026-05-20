import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WorkstationPool } from '../workstationPool'
import axios from 'axios'

vi.mock('axios')
const axiosGet = vi.mocked(axios.get)

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
    axiosGet.mockResolvedValue({ data: FAKE_OBJECT_INFO })
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
    axiosGet.mockImplementation(async () => {
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
    axiosGet.mockRejectedValue(new Error('boom'))
    await pool.refreshModels(ws.id)
    expect(pool.list()[0].models).toEqual({ checkpoints: [], loras: [], vae: [] })
  })
})
