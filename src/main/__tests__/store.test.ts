import { describe, it, expect } from 'vitest'
import { migrateSettings, DEFAULT_SETTINGS, type SettingsV2 } from '../store'

describe('migrateSettings', () => {
  it('migrates v1 (with comfyUrl) to v2 — creates first workstation', () => {
    const v1: any = {
      ollamaBaseUrl: 'http://x:1',
      ollamaModel: 'm',
      maxKeyframes: 8,
      outputFolder: '',
      comfyUrl: 'http://192.168.1.10:8188/'    // trailing slash will be stripped
    }
    const v2 = migrateSettings(v1)
    expect(v2.version).toBe(2)
    expect(v2.workstations).toHaveLength(1)
    expect(v2.workstations[0]).toMatchObject({
      name: 'Local ComfyUI',
      url: 'http://192.168.1.10:8188',          // stripped
      enabled: true
    })
    expect(v2.workstations[0].id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(v2.schedulerMode).toBe('lan-pool')
    expect(v2.discovery.portRange).toEqual([8188, 8190])
    expect(v2.ui).toEqual({ workstationsPanelOpen: true, queuePanelOpen: true })
  })

  it('migrates v1 with empty comfyUrl to v2 — empty workstations', () => {
    const v1: any = { ...DEFAULT_SETTINGS, comfyUrl: '', version: undefined }
    const v2 = migrateSettings(v1)
    expect(v2.version).toBe(2)
    expect(v2.workstations).toEqual([])
  })

  it('is idempotent on v2', () => {
    const v2a: SettingsV2 = {
      ...DEFAULT_SETTINGS,
      version: 2,
      workstations: [{ id: 'abc', name: 'X', url: 'http://x:1', enabled: true }],
      schedulerMode: 'manual',
      discovery: { portRange: [9000, 9001] },
      ui: { workstationsPanelOpen: false, queuePanelOpen: false }
    }
    const v2b = migrateSettings(v2a)
    expect(v2b).toEqual(v2a)
  })

  it('fills defaults when v1 fields are missing', () => {
    const v1: any = {}
    const v2 = migrateSettings(v1)
    expect(v2.ollamaBaseUrl).toBe(DEFAULT_SETTINGS.ollamaBaseUrl)
    expect(v2.version).toBe(2)
  })
})
