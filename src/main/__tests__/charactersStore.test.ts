import { describe, it, expect, beforeEach, vi } from 'vitest'

const tmpDir = require('path').join(require('os').tmpdir(), `char-test-${Date.now()}`)
vi.mock('electron', () => ({
  app: { getPath: () => tmpDir }
}))

import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  listCharacters,
  getCharacter,
  addCharacter,
  updateCharacter,
  deleteCharacter,
  addReference,
  removeReference,
  REF_CAP
} from '../charactersStore'

const sourceImage = join(tmpDir, 'source.png')

describe('charactersStore', () => {
  beforeEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
    mkdirSync(tmpDir, { recursive: true })
    writeFileSync(sourceImage, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  })

  it('listCharacters returns [] when file is missing', () => {
    expect(listCharacters()).toEqual([])
  })

  it('addCharacter creates a record with UUID + defaults + folder', () => {
    const c = addCharacter({ name: 'Aria' })
    expect(c.id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(c.name).toBe('Aria')
    expect(c.description).toBe('')
    expect(c.triggerWord).toBeNull()
    expect(c.loraName).toBeNull()
    expect(c.loraWeight).toBe(0.8)
    expect(c.defaultCheckpoint).toBeNull()
    expect(c.referenceImages).toEqual([])
    expect(c.ipAdapterWeight).toBe(0.6)
    expect(typeof c.createdAt).toBe('number')
    expect(existsSync(join(tmpDir, 'characters', c.id, 'refs'))).toBe(true)
  })

  it('addCharacter rejects empty/whitespace name', () => {
    expect(() => addCharacter({ name: '' })).toThrow(/name required/i)
    expect(() => addCharacter({ name: '   ' })).toThrow(/name required/i)
  })

  it('addCharacter accepts overrides for optional fields', () => {
    const c = addCharacter({
      name: 'Cyrus',
      description: 'tall warrior',
      triggerWord: 'cyrusx',
      loraName: 'cyrus.safetensors',
      loraWeight: 1.0,
      defaultCheckpoint: 'turbo.safetensors',
      ipAdapterWeight: 0.4
    })
    expect(c.description).toBe('tall warrior')
    expect(c.triggerWord).toBe('cyrusx')
    expect(c.loraName).toBe('cyrus.safetensors')
    expect(c.loraWeight).toBe(1.0)
    expect(c.defaultCheckpoint).toBe('turbo.safetensors')
    expect(c.ipAdapterWeight).toBe(0.4)
  })

  it('listCharacters sorts by name asc', () => {
    addCharacter({ name: 'Cyrus' })
    addCharacter({ name: 'Aria' })
    addCharacter({ name: 'Mira' })
    expect(listCharacters().map((c) => c.name)).toEqual(['Aria', 'Cyrus', 'Mira'])
  })

  it('getCharacter by id, or undefined', () => {
    const c = addCharacter({ name: 'Aria' })
    expect(getCharacter(c.id)?.name).toBe('Aria')
    expect(getCharacter('nope')).toBeUndefined()
  })

  it('updateCharacter patches fields and persists', () => {
    const c = addCharacter({ name: 'Aria' })
    const updated = updateCharacter(c.id, {
      description: 'updated',
      loraWeight: 1.2
    })
    expect(updated.description).toBe('updated')
    expect(updated.loraWeight).toBe(1.2)
    expect(updated.name).toBe('Aria') // unchanged
    expect(listCharacters()[0].description).toBe('updated')
  })

  it('updateCharacter rejects empty-after-trim name', () => {
    const c = addCharacter({ name: 'Aria' })
    expect(() => updateCharacter(c.id, { name: '   ' })).toThrow(/name required/i)
  })

  it('updateCharacter throws on unknown id', () => {
    expect(() => updateCharacter('nope', { description: 'x' })).toThrow(/not found/i)
  })

  it('updateCharacter ignores referenceImages in patch (must use addReference)', () => {
    const c = addCharacter({ name: 'Aria' })
    const after = updateCharacter(c.id, { referenceImages: ['/hack/path.png'] } as never)
    expect(after.referenceImages).toEqual([])
  })

  it('deleteCharacter removes record + folder', () => {
    const c = addCharacter({ name: 'Aria' })
    const folder = join(tmpDir, 'characters', c.id)
    expect(existsSync(folder)).toBe(true)
    deleteCharacter(c.id)
    expect(listCharacters()).toEqual([])
    expect(existsSync(folder)).toBe(false)
  })

  it('deleteCharacter throws on unknown id', () => {
    expect(() => deleteCharacter('nope')).toThrow(/not found/i)
  })

  it('addReference copies file into refs folder and appends path', () => {
    const c = addCharacter({ name: 'Aria' })
    const refPath = addReference(c.id, sourceImage)
    expect(refPath).toContain(join('characters', c.id, 'refs'))
    expect(refPath).toMatch(/\.png$/)
    expect(existsSync(refPath)).toBe(true)
    expect(getCharacter(c.id)?.referenceImages).toEqual([refPath])
  })

  it('addReference throws on unknown character id', () => {
    expect(() => addReference('nope', sourceImage)).toThrow(/not found/i)
  })

  it('addReference throws on missing source file', () => {
    const c = addCharacter({ name: 'Aria' })
    expect(() => addReference(c.id, join(tmpDir, 'nope.png'))).toThrow(/source file not found/i)
  })

  it('addReference enforces 10-image cap', () => {
    const c = addCharacter({ name: 'Aria' })
    for (let i = 0; i < REF_CAP; i++) addReference(c.id, sourceImage)
    expect(() => addReference(c.id, sourceImage)).toThrow(/cap reached/i)
    expect(getCharacter(c.id)?.referenceImages.length).toBe(REF_CAP)
  })

  it('removeReference deletes file and removes path', () => {
    const c = addCharacter({ name: 'Aria' })
    const refPath = addReference(c.id, sourceImage)
    expect(existsSync(refPath)).toBe(true)
    removeReference(c.id, refPath)
    expect(existsSync(refPath)).toBe(false)
    expect(getCharacter(c.id)?.referenceImages).toEqual([])
  })

  it('removeReference rejects path outside the character folder', () => {
    const c = addCharacter({ name: 'Aria' })
    const malicious = join(tmpDir, 'outside.png')
    writeFileSync(malicious, Buffer.from([0x89, 0x50]))
    expect(() => removeReference(c.id, malicious)).toThrow(/invalid reference path/i)
    // The malicious file is untouched.
    expect(existsSync(malicious)).toBe(true)
  })
})
