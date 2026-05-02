import axios, { AxiosError } from 'axios'

export const SD_PROMPT_INSTRUCTION = `Analyze this image and generate a detailed Stable Diffusion prompt that would recreate it.
Output only the prompt as a single line of comma-separated tags.
Include: subject, style, lighting, composition, camera/lens, mood, color palette, quality tags.
Do not include any explanation, markdown, or labels — only the prompt.`

const REQUEST_TIMEOUT_MS = 120_000

interface TagsResponse {
  models?: Array<{ name?: string; model?: string }>
}

interface GenerateResponse {
  response?: string
}

function trimBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

export async function checkHealth(baseUrl: string): Promise<boolean> {
  try {
    const res = await axios.get(`${trimBaseUrl(baseUrl)}/api/tags`, {
      timeout: 5_000
    })
    return res.status === 200
  } catch {
    return false
  }
}

export async function listModels(baseUrl: string): Promise<string[]> {
  try {
    const res = await axios.get<TagsResponse>(`${trimBaseUrl(baseUrl)}/api/tags`, {
      timeout: 10_000
    })
    const models = res.data?.models ?? []
    return models
      .map((m) => m.name ?? m.model ?? '')
      .filter((n): n is string => typeof n === 'string' && n.length > 0)
  } catch (err) {
    throw new Error(`Ollama not reachable at ${baseUrl}: ${(err as Error).message}`)
  }
}

export interface GeneratePromptOptions {
  baseUrl: string
  model: string
  imageBase64: string
  systemPrompt?: string
}

export const VIDEO_FRAME_INSTRUCTION = `Analyze this video frame and describe what you see.
Be concise: note the subject, setting, action, lighting, and mood in 1-2 sentences.
Do not include any explanation or labels — just the description.`

export const VIDEO_SYNTHESIS_INSTRUCTION = `You are given descriptions of keyframes from a video.
Generate a single detailed Stable Diffusion prompt that best captures the overall visual style, subject, and mood of the video.
Output only the prompt as a single line of comma-separated tags.
Include: subject, style, lighting, composition, camera/lens, mood, color palette, quality tags.
Do not include any explanation, markdown, or labels — only the prompt.`

export interface GenerateVideoPromptOptions {
  baseUrl: string
  model: string
  frameBase64List: string[]
}

export async function generatePromptFromVideo(opts: GenerateVideoPromptOptions): Promise<string> {
  const { baseUrl, model, frameBase64List } = opts

  // Describe each frame individually
  const descriptions = await Promise.all(
    frameBase64List.map((b64) =>
      generatePromptFromImage({
        baseUrl,
        model,
        imageBase64: b64,
        systemPrompt: VIDEO_FRAME_INSTRUCTION
      })
    )
  )

  // Synthesize a single SD prompt from all frame descriptions
  const combined = descriptions.map((d, i) => `Frame ${i + 1}: ${d}`).join('\n')
  const synthBody = {
    model,
    prompt: `${VIDEO_SYNTHESIS_INSTRUCTION}\n\n${combined}`,
    stream: false
  }
  const url = `${trimBaseUrl(baseUrl)}/api/generate`
  const res = await axios.post<GenerateResponse>(url, synthBody, {
    timeout: REQUEST_TIMEOUT_MS,
    headers: { 'Content-Type': 'application/json' }
  })
  const text = (res.data?.response ?? '').trim()
  if (!text) {
    throw new Error('Ollama returned an empty response during synthesis')
  }
  return text
}

export interface GenerateTextOptions {
  baseUrl: string
  model: string
  prompt: string
}

/**
 * Plain text completion via /api/generate (no images). Used for synthesizing
 * a master prompt from per-frame prompts.
 */
export async function generateText(opts: GenerateTextOptions): Promise<string> {
  const { baseUrl, model, prompt } = opts
  const url = `${trimBaseUrl(baseUrl)}/api/generate`
  const body = { model, prompt, stream: false }
  try {
    const res = await axios.post<GenerateResponse>(url, body, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json' }
    })
    const text = (res.data?.response ?? '').trim()
    if (!text) {
      throw new Error('Ollama returned an empty response')
    }
    return text
  } catch (err) {
    const ax = err as AxiosError<{ error?: string }>
    if (ax.isAxiosError) {
      if (ax.code === 'ECONNREFUSED' || ax.code === 'ENOTFOUND') {
        throw new Error(`Ollama not reachable at ${baseUrl}`)
      }
      const apiError = ax.response?.data?.error
      if (apiError) {
        throw new Error(`Ollama error: ${apiError}`)
      }
      if (ax.code === 'ECONNABORTED') {
        throw new Error(`Ollama request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`)
      }
      throw new Error(`Ollama request failed: ${ax.message}`)
    }
    throw err
  }
}

export async function generatePromptFromImage(opts: GeneratePromptOptions): Promise<string> {
  const { baseUrl, model, imageBase64, systemPrompt } = opts
  const url = `${trimBaseUrl(baseUrl)}/api/generate`
  const body = {
    model,
    prompt: systemPrompt ?? SD_PROMPT_INSTRUCTION,
    images: [imageBase64],
    stream: false
  }

  try {
    const res = await axios.post<GenerateResponse>(url, body, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json' }
    })
    const text = (res.data?.response ?? '').trim()
    if (!text) {
      throw new Error('Ollama returned an empty response')
    }
    return text
  } catch (err) {
    const ax = err as AxiosError<{ error?: string }>
    if (ax.isAxiosError) {
      if (ax.code === 'ECONNREFUSED' || ax.code === 'ENOTFOUND') {
        throw new Error(`Ollama not reachable at ${baseUrl}`)
      }
      const status = ax.response?.status
      const apiError = ax.response?.data?.error
      if (status === 404 || (apiError && /model.*not found/i.test(apiError))) {
        throw new Error(`Model '${model}' not found on Ollama at ${baseUrl}`)
      }
      if (apiError) {
        throw new Error(`Ollama error: ${apiError}`)
      }
      if (ax.code === 'ECONNABORTED') {
        throw new Error(`Ollama request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`)
      }
      throw new Error(`Ollama request failed: ${ax.message}`)
    }
    throw err
  }
}
