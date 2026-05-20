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
