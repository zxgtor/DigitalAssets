import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock electron's app.getPath to point at a tmp dir
const tmpDir = require('path').join(require('os').tmpdir(), `proj-test-${Date.now()}`)
vi.mock('electron', () => ({
  app: { getPath: () => tmpDir }
}))

import { mkdirSync, rmSync, existsSync } from 'fs'
import {
  listProjects,
  addProject,
  renameProject,
  deleteProject,
  getProject,
  ensureInbox
} from '../projectsStore'

describe('projectsStore', () => {
  beforeEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
    mkdirSync(tmpDir, { recursive: true })
  })

  it('listProjects returns [] when file is missing', () => {
    expect(listProjects()).toEqual([])
  })

  it('addProject creates a project with UUID id and createdAt', () => {
    const p = addProject('Logos')
    expect(p.id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(p.name).toBe('Logos')
    expect(typeof p.createdAt).toBe('number')
    expect(listProjects()).toHaveLength(1)
  })

  it('addProject rejects empty/whitespace name', () => {
    expect(() => addProject('')).toThrow(/name required/i)
    expect(() => addProject('   ')).toThrow(/name required/i)
  })

  it('addProject trims the name', () => {
    const p = addProject('  Logos  ')
    expect(p.name).toBe('Logos')
  })

  it('listProjects sorts by createdAt asc', async () => {
    const a = addProject('A')
    await new Promise((r) => setTimeout(r, 5))
    const b = addProject('B')
    expect(listProjects().map((p) => p.id)).toEqual([a.id, b.id])
  })

  it('getProject returns the project by id, or undefined', () => {
    const p = addProject('X')
    expect(getProject(p.id)?.name).toBe('X')
    expect(getProject('does-not-exist')).toBeUndefined()
  })

  it('renameProject updates the name and persists', () => {
    const p = addProject('Old')
    const renamed = renameProject(p.id, 'New')
    expect(renamed.name).toBe('New')
    expect(listProjects()[0].name).toBe('New')
  })

  it('renameProject rejects empty/whitespace', () => {
    const p = addProject('X')
    expect(() => renameProject(p.id, '')).toThrow(/name required/i)
    expect(() => renameProject(p.id, '   ')).toThrow(/name required/i)
  })

  it('renameProject throws on unknown id', () => {
    expect(() => renameProject('nope', 'X')).toThrow(/not found/i)
  })

  it('deleteProject removes the project', () => {
    const p = addProject('X')
    deleteProject(p.id)
    expect(listProjects()).toEqual([])
  })

  it('deleteProject throws on unknown id', () => {
    expect(() => deleteProject('nope')).toThrow(/not found/i)
  })

  it('ensureInbox creates an Inbox project if none exists, returns its id', () => {
    expect(listProjects()).toEqual([])
    const id = ensureInbox()
    expect(id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(listProjects()).toHaveLength(1)
    expect(listProjects()[0].name).toBe('Inbox')
  })

  it('ensureInbox is idempotent — returns the existing first project id', () => {
    const id1 = ensureInbox()
    const id2 = ensureInbox()
    expect(id2).toBe(id1)
    expect(listProjects()).toHaveLength(1)
  })
})
