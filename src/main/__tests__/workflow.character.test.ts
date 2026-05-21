import { describe, it, expect } from 'vitest'
import { buildImageWorkflow } from '../services/workflow'
import type { StoredCharacter } from '../charactersStore'

const baseChar: StoredCharacter = {
  id: 'c-1',
  name: 'Aria',
  description: 'tall warrior',
  triggerWord: 'ariax',
  loraName: null,
  loraWeight: 0.8,
  defaultCheckpoint: null,
  ipAdapterWeight: 0.6,
  referenceImages: [],
  createdAt: 0
}

describe('buildImageWorkflow with character (no refs)', () => {
  it('prepends description + trigger word to the prompt', () => {
    const wf = buildImageWorkflow({
      prompt: 'in a forest',
      character: baseChar
    })
    // The positive-prompt node is `6` (CLIPTextEncode).
    expect((wf['6'].inputs as { text: string }).text).toBe(
      'tall warrior, ariax, in a forest'
    )
  })

  it('omits trigger word when null', () => {
    const wf = buildImageWorkflow({
      prompt: 'in a forest',
      character: { ...baseChar, triggerWord: null }
    })
    expect((wf['6'].inputs as { text: string }).text).toBe('tall warrior, in a forest')
  })

  it('omits description when empty', () => {
    const wf = buildImageWorkflow({
      prompt: 'in a forest',
      character: { ...baseChar, description: '' }
    })
    expect((wf['6'].inputs as { text: string }).text).toBe('ariax, in a forest')
  })

  it('uses character.defaultCheckpoint when opts.checkpoint not passed', () => {
    const wf = buildImageWorkflow({
      prompt: 'x',
      character: { ...baseChar, defaultCheckpoint: 'aria_turbo.safetensors' }
    })
    expect((wf['4'].inputs as { ckpt_name: string }).ckpt_name).toBe(
      'aria_turbo.safetensors'
    )
  })

  it('opts.checkpoint overrides character.defaultCheckpoint when both set', () => {
    const wf = buildImageWorkflow({
      prompt: 'x',
      checkpoint: 'explicit.safetensors',
      character: { ...baseChar, defaultCheckpoint: 'aria.safetensors' }
    })
    expect((wf['4'].inputs as { ckpt_name: string }).ckpt_name).toBe('explicit.safetensors')
  })

  it('inserts LoraLoader node when character.loraName is set', () => {
    const wf = buildImageWorkflow({
      prompt: 'x',
      character: { ...baseChar, loraName: 'aria.safetensors', loraWeight: 0.7 }
    })
    // Find the LoraLoader by class_type
    const lora = Object.entries(wf).find(([, n]) => n.class_type === 'LoraLoader')
    expect(lora).toBeDefined()
    const [loraId, loraNode] = lora!
    expect((loraNode.inputs as { lora_name: string }).lora_name).toBe('aria.safetensors')
    expect((loraNode.inputs as { strength_model: number }).strength_model).toBe(0.7)
    expect((loraNode.inputs as { strength_clip: number }).strength_clip).toBe(0.7)
    // KSampler (node 3) now references the LoraLoader
    expect((wf['3'].inputs as { model: [string, number] }).model).toEqual([loraId, 0])
  })
})

describe('buildImageWorkflow with character (with refs)', () => {
  const charWithRefs: StoredCharacter = {
    ...baseChar,
    referenceImages: ['C:\\u\\refs\\a.png', 'C:\\u\\refs\\b.png']
  }
  const uploadedMap = {
    'C:\\u\\refs\\a.png': 'aria_ref_a.png',
    'C:\\u\\refs\\b.png': 'aria_ref_b.png'
  }

  it('inserts LoadImage nodes per uploaded reference', () => {
    const wf = buildImageWorkflow({
      prompt: 'x',
      character: charWithRefs,
      uploadedReferenceFilenames: uploadedMap
    })
    const loads = Object.values(wf).filter((n) => n.class_type === 'LoadImage')
    expect(loads).toHaveLength(2)
    const filenames = loads.map((n) => (n.inputs as { image: string }).image)
    expect(filenames.sort()).toEqual(['aria_ref_a.png', 'aria_ref_b.png'])
  })

  it('inserts IPAdapterUnifiedLoader + IPAdapter chain', () => {
    const wf = buildImageWorkflow({
      prompt: 'x',
      character: charWithRefs,
      uploadedReferenceFilenames: uploadedMap
    })
    const unifiedLoader = Object.entries(wf).find(
      ([, n]) => n.class_type === 'IPAdapterUnifiedLoader'
    )
    const ipAdapters = Object.entries(wf).filter(
      ([, n]) => n.class_type === 'IPAdapter'
    )
    expect(unifiedLoader).toBeDefined()
    expect(ipAdapters).toHaveLength(2)
    // Last IPAdapter feeds KSampler.model
    const lastIpAdapterId = ipAdapters[ipAdapters.length - 1][0]
    expect((wf['3'].inputs as { model: [string, number] }).model).toEqual([lastIpAdapterId, 0])
    // Each IPAdapter has the configured weight
    for (const [, n] of ipAdapters) {
      expect((n.inputs as { weight: number }).weight).toBe(0.6)
    }
  })

  it('skips IPAdapter chain when uploadedReferenceFilenames is missing', () => {
    const wf = buildImageWorkflow({
      prompt: 'x',
      character: charWithRefs
      // No uploadedReferenceFilenames provided
    })
    expect(Object.values(wf).some((n) => n.class_type === 'IPAdapter')).toBe(false)
    expect(Object.values(wf).some((n) => n.class_type === 'LoadImage')).toBe(false)
  })
})

describe('buildImageWorkflow without character (regression)', () => {
  it('still produces the basic txt2img workflow', () => {
    const wf = buildImageWorkflow({ prompt: 'plain' })
    expect(wf['3'].class_type).toBe('KSampler')
    expect(wf['4'].class_type).toBe('CheckpointLoaderSimple')
    expect((wf['6'].inputs as { text: string }).text).toBe('plain')
    expect(Object.values(wf).some((n) => n.class_type === 'IPAdapter')).toBe(false)
    expect(Object.values(wf).some((n) => n.class_type === 'LoraLoader')).toBe(false)
  })
})
