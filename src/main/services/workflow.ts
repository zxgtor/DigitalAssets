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

export type WorkflowJSON = Record<
  string,
  { class_type: string; inputs: Record<string, unknown> }
>

const DEFAULT_CHECKPOINT = 'sd_xl_base_1.0.safetensors'
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
}

export function buildImageWorkflow(opts: BuildImageWorkflowOptions): WorkflowJSON {
  const {
    prompt,
    negativePrompt = DEFAULT_NEGATIVE,
    seed = randomSeed(),
    steps = 25,
    cfg = 7.0,
    checkpoint = DEFAULT_CHECKPOINT,
    width = 1024,
    height = 1024
  } = opts

  return {
    '3': {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps,
        cfg,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1,
        model: ['4', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['5', 0]
      }
    },
    '4': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: checkpoint }
    },
    '5': {
      class_type: 'EmptyLatentImage',
      inputs: { width, height, batch_size: 1 }
    },
    '6': {
      class_type: 'CLIPTextEncode',
      inputs: { text: prompt, clip: ['4', 1] }
    },
    '7': {
      class_type: 'CLIPTextEncode',
      inputs: { text: negativePrompt, clip: ['4', 1] }
    },
    '8': {
      class_type: 'VAEDecode',
      inputs: { samples: ['3', 0], vae: ['4', 2] }
    },
    '9': {
      class_type: 'SaveImage',
      inputs: { images: ['8', 0], filename_prefix: 'VideoToPrompt' }
    }
  }
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
        filename_prefix: 'VideoToPrompt',
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
