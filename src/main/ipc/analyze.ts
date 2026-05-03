import { ipcMain } from 'electron'
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
      return {
        prompt,
        model: settings.ollamaModel,
        durationMs: Date.now() - start,
        imagePath: filePath
      }
    }
  )
}
