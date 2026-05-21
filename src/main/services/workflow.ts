/**
 * ComfyUI workflow JSON builders.
 *
 * Generates valid ComfyUI graph descriptions for two cases:
 *   - txt2img (basic SD)
 *   - AnimateDiff (animated, requires the ComfyUI-AnimateDiff-Evolved
 *     and VideoHelperSuite extensions)
 *
 * The structure is the standard "graph as object keyed by node id"
 * shape ComfyUI accepts at /prompt.
 */

import type { StoredCharacter } from '../charactersStore'

export type WorkflowJSON = Record<
  string,
  { class_type: string; inputs: Record<string, unknown> }
>

const DEFAULT_CHECKPOINT = 'sd_xl_turbo_1.0_fp16.safetensors'
// Turbo is distilled; it expects ~4 steps and cfg=1.0. Base SDXL would use 25/7.0.
const DEFAULT_STEPS = 4
const DEFAULT_CFG = 1.0
const DEFAULT_NEGATIVE = 'blurry, low quality, deformed'
const ANIMATEDIFF_NEGATIVE = 'blurry, low quality, deformed, watermark'

function randomSeed(): number {
  // ComfyUI accepts seeds up to 2^32-1 commonly (and larger). Use Math.random.
  return Math.floor(Math.random() * 0xffffffff)
}

export interface BuildImageWorkflowOptions {
  prompt: string
  negativePrompt?: string
  seed?: number
  steps?: number
  cfg?: number
  checkpoint?: string
  width?: number
  height?: number
  character?: StoredCharacter
  /** Set by submission flow after /upload/image: maps absolute local ref path → ComfyUI input filename. */
  uploadedReferenceFilenames?: Record<string, string>
}

export function buildImageWorkflow(opts: BuildImageWorkflowOptions): WorkflowJSON {
  // ── Compose prompt with character ─────────────────────────────────────────
  const character = opts.character
  const composedPrompt = character
    ? [character.description, character.triggerWord, opts.prompt].filter(Boolean).join(', ')
    : opts.prompt

  // ── Resolve checkpoint (character default unless explicit) ────────────────
  const ckptName =
    opts.checkpoint ?? character?.defaultCheckpoint ?? DEFAULT_CHECKPOINT

  const {
    negativePrompt = DEFAULT_NEGATIVE,
    seed = randomSeed(),
    steps = DEFAULT_STEPS,
    cfg = DEFAULT_CFG,
    width = 1024,
    height = 1024
  } = opts

  // ── Base graph ───────────────────────────────────────────────────────────
  // Node ids: 3=KSampler, 4=CheckpointLoaderSimple, 5=EmptyLatentImage,
  // 6=CLIPTextEncode (positive), 7=CLIPTextEncode (negative),
  // 8=VAEDecode, 9=SaveImage.
  const wf: WorkflowJSON = {
    '3': {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps,
        cfg,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1,
        model: ['4', 0],            // overwritten below if Lora/IPAdapter inserted
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['5', 0]
      }
    },
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckptName } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: composedPrompt, clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: negativePrompt, clip: ['4', 1] } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'DigitalAssets' } }
  }

  // Track which node provides the "model" link into KSampler.
  let modelSource: [string, number] = ['4', 0]
  let nextId = 10

  // ── LoraLoader (if character has a LoRA) ──────────────────────────────────
  if (character?.loraName) {
    const loraId = String(nextId++)
    wf[loraId] = {
      class_type: 'LoraLoader',
      inputs: {
        lora_name: character.loraName,
        strength_model: character.loraWeight,
        strength_clip: character.loraWeight,
        model: modelSource,
        clip: ['4', 1]
      }
    }
    modelSource = [loraId, 0]
  }

  // ── IPAdapter chain (only when refs were uploaded) ────────────────────────
  const refs = character?.referenceImages ?? []
  const uploaded = opts.uploadedReferenceFilenames
  if (refs.length > 0 && uploaded) {
    // LoadImage nodes
    const loadIds: string[] = []
    for (const refPath of refs) {
      const comfyName = uploaded[refPath]
      if (!comfyName) continue
      const id = String(nextId++)
      wf[id] = {
        class_type: 'LoadImage',
        inputs: { image: comfyName }
      }
      loadIds.push(id)
    }
    if (loadIds.length > 0) {
      // Single UnifiedLoader
      const unifiedId = String(nextId++)
      wf[unifiedId] = {
        class_type: 'IPAdapterUnifiedLoader',
        inputs: { model: modelSource, preset: 'PLUS (high strength)' }
      }
      let chainModel: [string, number] = [unifiedId, 0]
      const ipAdapterPipe: [string, number] = [unifiedId, 1]
      // One IPAdapter per ref, chained
      for (const loadId of loadIds) {
        const ipaId = String(nextId++)
        wf[ipaId] = {
          class_type: 'IPAdapter',
          inputs: {
            model: chainModel,
            ipadapter: ipAdapterPipe,
            image: [loadId, 0],
            weight: character!.ipAdapterWeight,
            start_at: 0,
            end_at: 1
          }
        }
        chainModel = [ipaId, 0]
      }
      modelSource = chainModel
    }
  }

  // Final wiring: KSampler.model points at the last node in the chain.
  ;(wf['3'].inputs as Record<string, unknown>).model = modelSource

  return wf
}

export interface BuildAnimateDiffWorkflowOptions {
  masterPrompt: string
  frames: Array<{ timeSec: number; prompt: string }>
  totalDurationSec: number
  fps?: number
  width?: number
  height?: number
  checkpoint?: string
  seed?: number
}

export function buildAnimateDiffWorkflow(
  opts: BuildAnimateDiffWorkflowOptions
): WorkflowJSON {
  const {
    masterPrompt,
    totalDurationSec,
    fps = 8,
    width = 512,
    height = 512,
    checkpoint = DEFAULT_CHECKPOINT,
    seed = randomSeed()
  } = opts

  const rawFrames = Math.ceil(Math.max(0, totalDurationSec) * fps)
  const numFrames = Math.max(1, Math.min(64, rawFrames || 1))

  return {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: checkpoint }
    },
    '2': {
      class_type: 'ADE_AnimateDiffLoaderWithContext',
      inputs: {
        model: ['1', 0],
        model_name: 'mm_sd_v15_v2.ckpt',
        beta_schedule: 'linear (AnimateDiff)',
        motion_scale: 1.0,
        apply_v2_models_properly: true
      }
    },
    '3': {
      class_type: 'EmptyLatentImage',
      inputs: { width, height, batch_size: numFrames }
    },
    '4': {
      class_type: 'CLIPTextEncode',
      inputs: { text: masterPrompt, clip: ['1', 1] }
    },
    '5': {
      class_type: 'CLIPTextEncode',
      inputs: { text: ANIMATEDIFF_NEGATIVE, clip: ['1', 1] }
    },
    '6': {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps: 20,
        cfg: 7.5,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1,
        model: ['2', 0],
        positive: ['4', 0],
        negative: ['5', 0],
        latent_image: ['3', 0]
      }
    },
    '7': {
      class_type: 'VAEDecode',
      inputs: { samples: ['6', 0], vae: ['1', 2] }
    },
    '8': {
      class_type: 'VHS_VideoCombine',
      inputs: {
        images: ['7', 0],
        frame_rate: fps,
        loop_count: 0,
        filename_prefix: 'DigitalAssets',
        format: 'video/h264-mp4',
        pix_fmt: 'yuv420p',
        crf: 19,
        save_metadata: true,
        pingpong: false,
        save_output: true
      }
    }
  }
}
