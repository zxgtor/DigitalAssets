import type { WorkflowJSON } from '../services/workflow'

export interface RequiredModels {
  checkpoints: string[]
  loras: string[]
  vae: string[]
}

const CLASS_TO_FIELD: Record<string, keyof RequiredModels> = {
  CheckpointLoaderSimple: 'checkpoints',
  LoraLoader: 'loras',
  VAELoader: 'vae'
}

const INPUT_KEY: Record<string, string> = {
  CheckpointLoaderSimple: 'ckpt_name',
  LoraLoader: 'lora_name',
  VAELoader: 'vae_name'
}

export function extractRequiredModels(wf: WorkflowJSON): RequiredModels {
  const out: RequiredModels = { checkpoints: [], loras: [], vae: [] }
  for (const node of Object.values(wf)) {
    const field = CLASS_TO_FIELD[node.class_type]
    if (!field) continue
    const inputKey = INPUT_KEY[node.class_type]
    const value = (node.inputs as Record<string, unknown>)[inputKey]
    if (typeof value === 'string' && value.length > 0) {
      if (!out[field].includes(value)) out[field].push(value)
    }
  }
  return out
}
