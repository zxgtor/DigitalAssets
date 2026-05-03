import axios, { AxiosError } from 'axios'
import { Readable } from 'stream'

export const SD_SYSTEM_PROMPT = `You are an expert Stable Diffusion / SDXL prompt engineer. Your job is to reverse-engineer images into extremely detailed, production-ready prompts that will faithfully recreate the source when fed to an image generation model.

You ALWAYS output dense, specific, comma-separated prompts. You NEVER output short or vague descriptions. You NEVER use generic words when specific ones exist. You treat every visual detail as critical.`

export const SD_PROMPT_INSTRUCTION = `Analyze this image with extreme attention to detail and write a single, dense Stable Diffusion prompt that would faithfully recreate it in an image generation model.

You MUST cover ALL of the following aspects in your output, joined by commas:

1. SUBJECT — Describe the main subject(s) with maximum specificity. For people: exact apparent age, gender, ethnicity, hair color/length/style, facial features, expression, body pose, hand positions, clothing (brand/style/color/fit/material/patterns), accessories, jewelry. For objects/scenes: type, material, texture, condition, distinguishing features.

2. SCENE/ENVIRONMENT — Exact setting (indoor/outdoor, specific location type), background elements, foreground elements, props, furniture, vegetation, weather conditions, time of day, season, architectural style.

3. COMPOSITION & FRAMING — Shot type (extreme close-up, close-up, medium close-up, medium shot, medium wide, wide shot, extreme wide, aerial), camera angle (worm's eye, low angle, eye level, high angle, bird's eye, dutch angle), depth of field (bokeh amount), focal plane, rule of thirds placement, leading lines.

4. CAMERA & LENS — Specific lens equivalent (14mm, 24mm, 35mm, 50mm, 85mm, 135mm, 200mm), aperture (f/1.2, f/1.4, f/2.8, f/8, f/16), shutter speed effect (frozen motion, motion blur), camera type feel (DSLR, mirrorless, film camera, medium format, phone camera).

5. LIGHTING — Primary light source and direction, secondary/fill lights, light quality (hard/soft/diffused), color temperature (warm/cool/neutral), shadows (harsh/soft/minimal), highlights, rim lighting, backlighting, lens flare, god rays, volumetric lighting.

6. COLOR & GRADING — Dominant color palette (list specific colors), saturation level, contrast level, color grading style (teal and orange, warm golden, cool blue, desaturated, cross-processed, bleach bypass), overall mood of color.

7. STYLE & MEDIUM — Art medium (photograph, digital art, oil painting, watercolor, 3D render, anime, cel-shaded, pixel art, vector art), specific style references, era/period, rendering quality, texture quality.

8. QUALITY TAGS — Include: masterpiece, best quality, highly detailed, sharp focus, professional, 8k uhd, high resolution, RAW photo, (add more relevant quality boosters).

OUTPUT FORMAT: One continuous comma-separated prompt. NO labels, NO numbering, NO line breaks, NO markdown, NO explanations, NO quotes around the output. Just the raw prompt text.

TARGET LENGTH: 80–200 words. More detail is ALWAYS better. Short outputs are failures.`

interface TagsResponse {
  models?: Array<{ name?: string; model?: string }>
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
 * Read an NDJSON stream from Ollama and accumulate the response text.
 * Using streaming prevents timeout because data flows continuously —
 * even if the model takes minutes to generate, the connection stays alive.
 */
async function readStreamResponse(stream: Readable, _baseUrl: string, model: string): Promise<string> {
  let accumulated = ''
  let buffer = ''

  for await (const chunk of stream) {
    buffer += chunk.toString()
    const lines = buffer.split('\n')
    // Keep the last incomplete line in the buffer
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const parsed = JSON.parse(trimmed)
        // Check for errors in the stream
        if (parsed.error) {
          if (/model.*not found/i.test(parsed.error)) {
            throw new Error(
              `Model '${model}' is not installed on Ollama.\n\n` +
                `Install it by running:\n  ollama pull ${model}\n\n` +
                `Or change the model in Settings to one you already have.`
            )
          }
          throw new Error(`Ollama error: ${parsed.error}`)
        }
        if (parsed.response) {
          accumulated += parsed.response
        }
      } catch (e) {
        if (e instanceof SyntaxError) continue // skip malformed lines
        throw e
      }
    }
  }

  // Process any remaining buffer
  if (buffer.trim()) {
    try {
      const parsed = JSON.parse(buffer.trim())
      if (parsed.response) accumulated += parsed.response
    } catch {
      // ignore
    }
  }

  const result = accumulated.trim()
  if (!result) {
    throw new Error('Ollama returned an empty response')
  }
  return result
}

/**
 * Handle connection-level errors (before streaming begins).
 */
function handleConnectionError(err: unknown, baseUrl: string, model: string): never {
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
          `Install it by running:\n  ollama pull ${model}\n\n` +
          `Or change the model in Settings to one you already have.`
      )
    }
    if (apiError) {
      throw new Error(`Ollama error: ${apiError}`)
    }
    throw new Error(`Ollama request failed: ${ax.message}`)
  }
  throw err
}

/**
 * Plain text completion via /api/generate (no images). Used for synthesizing
 * a master prompt from per-frame prompts. Uses streaming to avoid timeout.
 */
export async function generateText(opts: GenerateTextOptions): Promise<string> {
  const { baseUrl, model, prompt } = opts
  const url = `${trimBaseUrl(baseUrl)}/api/generate`
  const body = {
    model,
    prompt,
    stream: true,
    options: {
      temperature: 0.3,
      num_predict: 600,
      top_p: 0.9,
      repeat_penalty: 1.1
    }
  }
  try {
    const res = await axios.post(url, body, {
      timeout: 30_000, // 30s to establish connection only
      headers: { 'Content-Type': 'application/json' },
      responseType: 'stream'
    })
    return await readStreamResponse(res.data as Readable, baseUrl, model)
  } catch (err) {
    handleConnectionError(err, baseUrl, model)
  }
}

export async function generatePromptFromImage(opts: GeneratePromptOptions): Promise<string> {
  const { baseUrl, model, imageBase64, systemPrompt } = opts
  const url = `${trimBaseUrl(baseUrl)}/api/generate`
  const body = {
    model,
    system: SD_SYSTEM_PROMPT,
    prompt: systemPrompt ?? SD_PROMPT_INSTRUCTION,
    images: [imageBase64],
    stream: true,
    options: {
      temperature: 0.3,
      num_predict: 600,
      top_p: 0.9,
      repeat_penalty: 1.1
    }
  }

  try {
    const res = await axios.post(url, body, {
      timeout: 30_000, // 30s to establish connection only (not generation time)
      headers: { 'Content-Type': 'application/json' },
      responseType: 'stream'
    })
    return await readStreamResponse(res.data as Readable, baseUrl, model)
  } catch (err) {
    handleConnectionError(err, baseUrl, model)
  }
}
