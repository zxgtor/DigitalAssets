import axios, { AxiosError } from 'axios'

export const SD_PROMPT_INSTRUCTION = `You are a Stable Diffusion prompt engineer. Look at this image carefully and write a single, dense Stable Diffusion prompt that would faithfully recreate it.

Required fields, in this order, joined by commas (no labels, no line breaks, no explanation):
1. SUBJECT — main subject(s) with concrete visual details: age, gender, ethnicity, hair color/style, clothing, expression, pose, action; or for objects/scenes: type, materials, condition, key features.
2. SCENE — environment, setting, foreground/background elements, props, weather, time of day.
3. COMPOSITION — framing (close-up / medium shot / wide / aerial), shot angle (low / eye-level / high / overhead), depth of field (shallow / deep), rule-of-thirds or centered subject.
4. CAMERA — lens (35mm / 50mm / 85mm / wide-angle / telephoto / fisheye), aperture (f/1.4 etc), focus point.
5. LIGHTING — source (natural / studio / neon / candlelight), direction (rim, backlit, side, top), quality (soft / hard / diffused), shadows, highlights.
6. COLOR — dominant palette, saturation level, color grading (teal-and-orange, warm tones, desaturated, muted, etc).
7. STYLE — medium (photo / oil painting / 3D render / anime / pixel art), specific artist or studio reference if recognizable, era.
8. QUALITY TAGS — masterpiece, highly detailed, sharp focus, 8k, hdr, cinematic.

Output ONLY the comma-separated prompt. No preamble, no markdown, no quotes, no trailing notes. 60–120 words is ideal.`

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
      const status = ax.response?.status
      const apiError = ax.response?.data?.error
      if (status === 404 || (apiError && /model.*not found/i.test(apiError))) {
        throw new Error(
          `Model '${model}' is not installed on Ollama.\n\n` +
            `Install it by running:\n  ollama pull ${model}`
        )
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
        // Try to surface what IS installed so the user can pick one or pull.
        let installedHint = ''
        try {
          const installed = await listModels(baseUrl)
          installedHint = installed.length
            ? `\n\nInstalled models: ${installed.join(', ')}`
            : '\n\nNo models are currently installed.'
        } catch {
          /* ignore */
        }
        throw new Error(
          `Model '${model}' is not installed on Ollama.\n\n` +
            `Install it by running:\n  ollama pull ${model}\n\n` +
            `Or change the model in Settings to one you already have.` +
            installedHint
        )
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
