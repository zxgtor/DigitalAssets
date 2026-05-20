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
