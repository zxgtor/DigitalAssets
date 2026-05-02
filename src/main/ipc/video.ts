import { ipcMain, app } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import { getSettings } from '../store'
import { encodeImageToBase64 } from '../services/imageEncoder'
import { extractKeyframes, getVideoMetadata } from '../services/ffmpeg'
import {
  generatePromptFromImage,
  generateText,
  SD_PROMPT_INSTRUCTION
} from '../services/ollama'
import { downloadYouTubeVideo } from '../services/youtube'

export interface VideoKeyframeResult {
  timeSec: number
  thumbnailPath: string
  prompt: string
}

export interface VideoAnalysisResult {
  durationMs: number
  model: string
  duration: number
  width: number
  height: number
  keyframes: VideoKeyframeResult[]
  masterPrompt: string
  sourceTitle?: string
  sourceUrl?: string
}

const SYNTHESIS_PROMPT_PREFIX =
  'Below are Stable Diffusion prompts for keyframes from a video. Synthesize them into a single cohesive Stable Diffusion prompt that captures the overall scene, mood, style, and motion. Output only the prompt, comma-separated tags, no explanation.\n\nFrame prompts:\n'

async function analyzeLocalVideo(filePath: string): Promise<VideoAnalysisResult> {
  const start = Date.now()
  const settings = getSettings()
  const maxFrames = Math.max(1, settings.maxKeyframes ?? 8)

  // 1. Get video metadata
  const meta = await getVideoMetadata(filePath)
  if (!meta.durationSec) {
    throw new Error('Unable to determine video duration')
  }

  // 2. Create a unique temp dir
  const tmpRoot = join(app.getPath('temp'), 'videotoprompt', String(Date.now()))
  await fs.mkdir(tmpRoot, { recursive: true })

  // 3. Extract evenly-spaced keyframes
  const framePaths = await extractKeyframes(filePath, maxFrames, tmpRoot)

  // Compute the timestamps that match the extractor's spacing
  const timestamps: number[] = []
  for (let i = 0; i < framePaths.length; i++) {
    timestamps.push(((i + 0.5) * meta.durationSec) / framePaths.length)
  }

  // 4. Per-frame analysis (sequential to avoid hammering Ollama)
  const keyframes: VideoKeyframeResult[] = []
  for (let i = 0; i < framePaths.length; i++) {
    const fp = framePaths[i]
    const b64 = await encodeImageToBase64(fp)
    const prompt = await generatePromptFromImage({
      baseUrl: settings.ollamaBaseUrl,
      model: settings.ollamaModel,
      imageBase64: b64,
      systemPrompt: SD_PROMPT_INSTRUCTION
    })
    keyframes.push({
      timeSec: timestamps[i],
      thumbnailPath: fp,
      prompt
    })
  }

  // 5. Synthesize a master prompt (text-only)
  const numbered = keyframes.map((k, i) => `${i + 1}. ${k.prompt}`).join('\n')
  const synthesisPrompt = `${SYNTHESIS_PROMPT_PREFIX}${numbered}`
  const masterPrompt = await generateText({
    baseUrl: settings.ollamaBaseUrl,
    model: settings.ollamaModel,
    prompt: synthesisPrompt
  })

  return {
    durationMs: Date.now() - start,
    model: settings.ollamaModel,
    duration: meta.durationSec,
    width: meta.width,
    height: meta.height,
    keyframes,
    masterPrompt
  }
}

export function registerVideoHandlers(): void {
  ipcMain.handle(
    'analyze:video',
    async (_event, args: { filePath: string }): Promise<VideoAnalysisResult> => {
      const { filePath } = args
      if (!filePath) {
        throw new Error('analyze:video requires a filePath')
      }
      return analyzeLocalVideo(filePath)
    }
  )

  ipcMain.handle(
    'analyze:youtube',
    async (_event, args: { url: string }): Promise<VideoAnalysisResult> => {
      const { url } = args
      if (!url) {
        throw new Error('analyze:youtube requires a url')
      }

      const tmpDir = join(app.getPath('temp'), 'videotoprompt', String(Date.now()))
      const { filePath, title } = await downloadYouTubeVideo(url, tmpDir)
      const result = await analyzeLocalVideo(filePath)
      return { ...result, sourceTitle: title, sourceUrl: url }
    }
  )
}
