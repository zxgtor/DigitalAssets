import { describe, it, expect } from 'vitest'
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
