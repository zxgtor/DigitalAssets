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
import { registerPath, registerPaths } from '../services/mediaServer'

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
  /** Absolute path to the local video file, suitable for media:// URLs. */
  videoPath?: string
  sourceTitle?: string
  sourceUrl?: string
  /** Stable id used for history persistence. */
  historyId: string
  /** Persistent thumbnail copy under userData/thumbnails. */
  thumbnailPath?: string
}

function makeHistoryId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

async function ensureDir(p: string): Promise<string> {
  await fs.mkdir(p, { recursive: true })
  return p
}

async function persistThumbnail(srcPath: string, id: string): Promise<string> {
  try {
    const dir = await ensureDir(join(app.getPath('userData'), 'thumbnails'))
    const dest = join(dir, `${id}.jpg`)
    await fs.copyFile(srcPath, dest)
    registerPath(dest)
    return dest
  } catch (err) {
    console.error('[video] thumbnail copy failed', err)
    return ''
  }
}

async function persistVideo(srcPath: string, id: string): Promise<string> {
  try {
    const dir = await ensureDir(join(app.getPath('userData'), 'videos'))
    const dest = join(dir, `${id}.mp4`)
    await fs.copyFile(srcPath, dest)
    registerPath(dest)
    return dest
  } catch (err) {
    console.error('[video] video copy failed', err)
    return ''
  }
}

const SYNTHESIS_PROMPT_PREFIX = `You are synthesizing a single, dense Stable Diffusion / AnimateDiff prompt that describes an entire short video clip. You will be given per-keyframe prompts in chronological order.

Your job: produce ONE comma-separated prompt that captures:
1. SUBJECT — what/who is the main subject across the clip, with specific visual details (clothing, features, pose).
2. SCENE — environment, setting, time of day, weather, era.
3. ACTION / MOTION — what is happening over time. Use motion descriptors that AnimateDiff understands: "camera panning left", "subject walking forward", "wind blowing hair", "slow dolly in", "tracking shot", "subject turning head", "leaves falling", "rain pouring".
4. CAMERA — lens, framing, shot type, any camera moves observed across the frames.
5. LIGHTING — light source(s), direction, quality, any changes over time (sun setting, flickering neon).
6. COLOR — dominant palette and grading.
7. STYLE — medium, art direction, era, recognizable studio/artist references.
8. QUALITY TAGS — cinematic, highly detailed, smooth motion, 24fps, sharp focus, masterpiece.

Rules:
- Merge overlapping detail across frames; do NOT just concatenate.
- Resolve contradictions by going with the most prevalent description.
- Keep it dense and specific — favor concrete nouns and adjectives over generic words.
- Output ONLY the comma-separated prompt. No labels, no preamble, no explanation, no quotes. Aim for 80–160 words.

Per-frame prompts (chronological):
`

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

  // 5. Synthesize a master prompt (text-only). Include timestamps so the
  //    model can reason about motion and temporal changes.
  const numbered = keyframes
    .map((k, i) => `${i + 1}. [t=${k.timeSec.toFixed(1)}s] ${k.prompt}`)
    .join('\n')
  const synthesisPrompt = `${SYNTHESIS_PROMPT_PREFIX}${numbered}\n\nNow output the synthesized prompt:`
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
    masterPrompt,
    historyId: makeHistoryId()
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
      const result = await analyzeLocalVideo(filePath)
      // Allow the renderer to load the video + thumbnails through the
      // local media server.
      registerPath(filePath)
      registerPaths(result.keyframes.map((k) => k.thumbnailPath))

      // Persistent thumbnail (first keyframe). Local video stays as-is —
      // it lives on the user's filesystem already.
      const firstFrame = result.keyframes[0]?.thumbnailPath
      const thumb = firstFrame ? await persistThumbnail(firstFrame, result.historyId) : ''

      return {
        ...result,
        videoPath: filePath,
        thumbnailPath: thumb || undefined
      }
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
      registerPath(filePath)
      registerPaths(result.keyframes.map((k) => k.thumbnailPath))

      // YouTube downloads live in temp — copy both thumbnail and video to userData.
      const firstFrame = result.keyframes[0]?.thumbnailPath
      const thumb = firstFrame ? await persistThumbnail(firstFrame, result.historyId) : ''
      const persistedVideo = await persistVideo(filePath, result.historyId)

      return {
        ...result,
        videoPath: persistedVideo || filePath,
        sourceTitle: title,
        sourceUrl: url,
        thumbnailPath: thumb || undefined
      }
    }
  )
}
