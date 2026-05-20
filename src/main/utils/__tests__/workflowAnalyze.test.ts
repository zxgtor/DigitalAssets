import { describe, it, expect } from 'vitest'
import { extractRequiredModels } from '../workflowAnalyze'
import type { WorkflowJSON } from '../../services/workflow'

const baseImageWorkflow: WorkflowJSON = {
  '3': { class_type: 'KSampler', inputs: { seed: 1 } },
  '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd_xl_base_1.0.safetensors' } },
  '5': { class_type: 'CLIPTextEncode', inputs: { text: 'hi' } },
  '10': { class_type: 'LoraLoader', inputs: { lora_name: 'addDetail.safetensors' } },
  '11': { class_type: 'LoraLoader', inputs: { lora_name: 'styleX.safetensors' } },
  '12': { class_type: 'VAELoader', inputs: { vae_name: 'sdxl_vae.safetensors' } }
}

describe('extractRequiredModels', () => {
  it('pulls checkpoints, loras, vaes', () => {
    expect(extractRequiredModels(baseImageWorkflow)).toEqual({
      checkpoints: ['sd_xl_base_1.0.safetensors'],
      loras: ['addDetail.safetensors', 'styleX.safetensors'],
      vae: ['sdxl_vae.safetensors']
    })
  })

  it('returns empty arrays when no loader nodes are present', () => {
    const wf: WorkflowJSON = {
      '1': { class_type: 'KSampler', inputs: { seed: 1 } }
    }
    expect(extractRequiredModels(wf)).toEqual({ checkpoints: [], loras: [], vae: [] })
  })

  it('deduplicates repeated model names', () => {
    const wf: WorkflowJSON = {
      '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'foo.safetensors' } },
      '2': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'foo.safetensors' } }
    }
    expect(extractRequiredModels(wf).checkpoints).toEqual(['foo.safetensors'])
  })

  it('ignores nodes with non-string ckpt_name', () => {
    const wf: WorkflowJSON = {
      '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ['ref', 0] } }
    }
    expect(extractRequiredModels(wf).checkpoints).toEqual([])
  })
})
