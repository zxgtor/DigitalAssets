import { ipcMain } from 'electron'
import { getSettings } from '../store'
import { encodeImageToBase64 } from '../services/imageEncoder'
import { generatePromptFromImage } from '../services/ollama'

export interface ImageAnalysisResult {
  prompt: string
  model: string
  durationMs: number
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
      return {
        prompt,
        model: settings.ollamaModel,
        durationMs: Date.now() - start
      }
    }
  )
}
