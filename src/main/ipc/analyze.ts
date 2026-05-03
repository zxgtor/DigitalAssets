import { ipcMain, app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { getSettings } from '../store'
import { encodeImageToBase64 } from '../services/imageEncoder'
import { generatePromptFromImage } from '../services/ollama'
import { registerPath } from '../services/mediaServer'

export interface ImageAnalysisResult {
  prompt: string
  model: string
  durationMs: number
  /** Absolute path to the source image, suitable for media server URLs. */
  imagePath?: string
  /** Stable id used for history persistence (so renderer can pass it through). */
  historyId: string
  /** Persistent thumbnail copy under userData/thumbnails. */
  thumbnailPath?: string
}

function makeHistoryId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

async function ensureThumbnailsDir(): Promise<string> {
  const dir = join(app.getPath('userData'), 'thumbnails')
  await fs.mkdir(dir, { recursive: true })
  return dir
}

async function copyThumbnail(srcPath: string, id: string): Promise<string> {
  const dir = await ensureThumbnailsDir()
  const dest = join(dir, `${id}.jpg`)
  try {
    await fs.copyFile(srcPath, dest)
    registerPath(dest)
    return dest
  } catch (err) {
    console.error('[analyze] thumbnail copy failed', err)
    return ''
  }
}

export function registerAnalyzeHandlers(): void {
  ipcMain.handle(
    'analyze:image',
    async (_event, args: { filePath: string }): Promise<ImageAnalysisResult> => {
      const { filePath } = args
      if (!filePath) {
        throw new Error('analyze:image requires a filePath')
      }
      const settings = getSettings()
      const start = Date.now()
      const imageBase64 = await encodeImageToBase64(filePath)
      const prompt = await generatePromptFromImage({
        baseUrl: settings.ollamaBaseUrl,
        model: settings.ollamaModel,
        imageBase64
      })
      // Allow renderer to load the source image via the media server.
      registerPath(filePath)

      const historyId = makeHistoryId()
      const thumbnailPath = await copyThumbnail(filePath, historyId)

      return {
        prompt,
        model: settings.ollamaModel,
        durationMs: Date.now() - start,
        imagePath: filePath,
        historyId,
        thumbnailPath: thumbnailPath || undefined
      }
    }
  )
}
