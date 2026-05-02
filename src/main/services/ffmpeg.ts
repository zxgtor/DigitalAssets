import ffmpeg from 'fluent-ffmpeg'
import ffprobeStatic from '@ffprobe-installer/ffprobe'
import { promises as fs } from 'fs'
import { join } from 'path'

ffmpeg.setFfprobePath(ffprobeStatic.path)
// Note: ffmpeg binary uses system PATH

export interface VideoMetadata {
  durationSec: number
  width: number
  height: number
  fps: number
}

function parseFps(rate: string | undefined): number {
  if (!rate) return 0
  const parts = rate.split('/')
  if (parts.length === 2) {
    const num = parseFloat(parts[0])
    const den = parseFloat(parts[1])
    if (den > 0) return num / den
  }
  const v = parseFloat(rate)
  return Number.isFinite(v) ? v : 0
}

export async function getVideoMetadata(filePath: string): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) {
        reject(new Error(`ffprobe failed: ${err.message}`))
        return
      }
      const videoStream = data.streams.find((s) => s.codec_type === 'video')
      const durationSec = parseFloat(String(data.format.duration ?? '0'))
      resolve({
        durationSec: Number.isFinite(durationSec) ? durationSec : 0,
        width: videoStream?.width ?? 0,
        height: videoStream?.height ?? 0,
        fps: parseFps(videoStream?.r_frame_rate as string | undefined)
      })
    })
  })
}

/**
 * Extract `count` evenly-spaced frames from a video as JPEGs.
 * Uses one ffmpeg call per frame with `-ss <time>` for reliability.
 * Returns absolute paths in chronological order.
 */
export async function extractKeyframes(
  filePath: string,
  count: number,
  outputDir: string
): Promise<string[]> {
  await fs.mkdir(outputDir, { recursive: true })

  const meta = await getVideoMetadata(filePath)
  const duration = meta.durationSec
  if (!duration || duration <= 0) {
    throw new Error('Video has zero or unknown duration')
  }

  const n = Math.max(1, count)
  const timestamps: number[] = []
  for (let i = 0; i < n; i++) {
    const t = ((i + 0.5) * duration) / n
    timestamps.push(Math.max(0, Math.min(duration - 0.05, t)))
  }

  const outputs: string[] = []

  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i]
    const outPath = join(outputDir, `frame_${String(i).padStart(3, '0')}.jpg`)
    await new Promise<void>((resolve, reject) => {
      ffmpeg(filePath)
        .seekInput(ts)
        .frames(1)
        .outputOptions(['-q:v', '3'])
        .output(outPath)
        .on('end', () => resolve())
        .on('error', (err) => {
          const msg = err.message || String(err)
          if (/ENOENT|not found|Cannot find ffmpeg/i.test(msg)) {
            reject(new Error('ffmpeg not found in PATH; please install it'))
          } else {
            reject(new Error(`Frame extraction failed at ${ts.toFixed(2)}s: ${msg}`))
          }
        })
        .run()
    })
    outputs.push(outPath)
  }

  return outputs
}

export function getFrameTimestamps(durationSec: number, count: number): number[] {
  const n = Math.max(1, count)
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    out.push(((i + 0.5) * durationSec) / n)
  }
  return out
}
