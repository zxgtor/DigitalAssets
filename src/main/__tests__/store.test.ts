import { describe, it, expect } from 'vitest'
import { migrateSettings, DEFAULT_SETTINGS, type SettingsV2 } from '../store'

describe('migrateSettings', () => {
  it('migrates v1 (with comfyUrl) to v3 — creates first workstation', () => {
    const v1: any = {
      ollamaBaseUrl: 'http://x:1',
      ollamaModel: 'm',
      maxKeyframes: 8,
      outputFolder: '',
      comfyUrl: 'http://192.168.1.10:8188/'    // trailing slash will be stripped
    }
    const v3 = migrateSettings(v1)
    expect(v3.version).toBe(3)
    expect(v3.workstations).toHaveLength(1)
    expect(v3.workstations[0]).toMatchObject({
      name: 'Local ComfyUI',
      url: 'http://192.168.1.10:8188',          // stripped
      enabled: true
    })
    expect(v3.workstations[0].id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(v3.schedulerMode).toBe('lan-pool')
    expect(v3.discovery.portRange).toEqual([8188, 8190])
    expect(v3.ui).toEqual({ workstationsPanelOpen: true, queuePanelOpen: true })
    expect(v3.lastProjectId).toBeNull()
  })

  it('migrates v1 with empty comfyUrl to v3 — empty workstations', () => {
    const v1: any = { ...DEFAULT_SETTINGS, comfyUrl: '', version: undefined }
    const v3 = migrateSettings(v1)
    expect(v3.version).toBe(3)
    expect(v3.workstations).toEqual([])
    expect(v3.lastProjectId).toBeNull()
  })

  it('migrates v2 to v3 — preserves workstations, adds lastProjectId: null', () => {
    const v2a: SettingsV2 = {
      ...DEFAULT_SETTINGS,
      version: 2,
      workstations: [{ id: 'abc', name: 'X', url: 'http://x:1', enabled: true }],
      schedulerMode: 'manual',
      discovery: { portRange: [9000, 9001] },
      ui: { workstationsPanelOpen: false, queuePanelOpen: false }
    }
    const v3 = migrateSettings(v2a as any)
    expect(v3.version).toBe(3)
    expect(v3.workstations).toEqual(v2a.workstations)
    expect(v3.schedulerMode).toBe('manual')
    expect(v3.discovery.portRange).toEqual([9000, 9001])
    expect(v3.lastProjectId).toBeNull()
  })

  it('fills defaults when v1 fields are missing', () => {
    const v1: any = {}
    const v3 = migrateSettings(v1)
    expect(v3.ollamaBaseUrl).toBe(DEFAULT_SETTINGS.ollamaBaseUrl)
    expect(v3.version).toBe(3)
    expect(v3.lastProjectId).toBeNull()
  })

  it('migrates v2 to v3 — adds lastProjectId: null', () => {
    const v2: any = {
      version: 2,
      ollamaBaseUrl: 'http://x:1', ollamaModel: 'm', maxKeyframes: 8,
      outputFolder: '', comfyUrl: 'http://x:8188',
      workstations: [], schedulerMode: 'lan-pool',
      discovery: { portRange: [8188, 8190] },
      ui: { workstationsPanelOpen: true, queuePanelOpen: true }
    }
    const v3 = migrateSettings(v2)
    expect(v3.version).toBe(3)
    expect(v3.lastProjectId).toBeNull()
  })

  it('is idempotent on v3', () => {
    const v3a: any = {
      ...DEFAULT_SETTINGS,
      version: 3,
      lastProjectId: 'abc-123'
    }
    const v3b = migrateSettings(v3a)
    expect(v3b).toEqual(v3a)
  })

  it('v1 → v3 migration sets lastProjectId: null', () => {
    const v1: any = { ollamaBaseUrl: 'http://x:1', comfyUrl: '' }
    const v3 = migrateSettings(v1)
    expect(v3.version).toBe(3)
    expect(v3.lastProjectId).toBeNull()
  })
})
