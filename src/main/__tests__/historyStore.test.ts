import { describe, it, expect, beforeEach, vi } from 'vitest'

const tmpDir = require('path').join(require('os').tmpdir(), `hist-test-${Date.now()}`)
vi.mock('electron', () => ({
  app: { getPath: () => tmpDir }
}))

import { mkdirSync, rmSync, existsSync } from 'fs'
import {
  listHistory,
  addHistoryEntry,
  removeByProject
} from '../historyStore'

describe('historyStore', () => {
  beforeEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
    mkdirSync(tmpDir, { recursive: true })
  })

  it('addHistoryEntry requires projectId and persists it', () => {
    const e = addHistoryEntry({
      kind: 'image',
      filePath: '/p/a.png',
      fileName: 'a.png',
      prompt: 'hi',
      createdAt: Date.now(),
      projectId: 'proj-1'
    })
    expect(e.projectId).toBe('proj-1')
    expect(listHistory()[0].projectId).toBe('proj-1')
  })

  it('removeByProject deletes only entries with the given projectId', () => {
    addHistoryEntry({
      kind: 'image', filePath: '/p/a.png', fileName: 'a.png',
      prompt: 'a', createdAt: 1, projectId: 'proj-1'
    })
    addHistoryEntry({
      kind: 'image', filePath: '/p/b.png', fileName: 'b.png',
      prompt: 'b', createdAt: 2, projectId: 'proj-2'
    })
    addHistoryEntry({
      kind: 'image', filePath: '/p/c.png', fileName: 'c.png',
      prompt: 'c', createdAt: 3, projectId: 'proj-1'
    })
    const removed = removeByProject('proj-1')
    expect(removed).toBe(2)
    expect(listHistory().map((e) => e.fileName)).toEqual(['b.png'])
  })

  it('removeByProject returns 0 when nothing matches', () => {
    addHistoryEntry({
      kind: 'image', filePath: '/p/a.png', fileName: 'a.png',
      prompt: 'a', createdAt: 1, projectId: 'proj-1'
    })
    expect(removeByProject('does-not-exist')).toBe(0)
    expect(listHistory()).toHaveLength(1)
  })
})
