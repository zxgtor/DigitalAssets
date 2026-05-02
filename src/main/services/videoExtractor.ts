import ffmpeg from 'fluent-ffmpeg'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

ffmpeg.setFfprobePath(ffprobeInstaller.path)

export interface VideoMeta {
  durationSec: number
  width: number
  height: number
}

export async function getVideoMeta(filePath: string): Promise<VideoMeta> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) {
        reject(new Error(`ffprobe failed: ${err.message}`))
        return
      }
      const videoStream = data.streams.find((s) => s.codec_type === 'video')
      const durationSec = parseFloat(String(data.format.duration ?? '0'))
      resolve({
        durationSec,
        width: videoStream?.width ?? 0,
        height: videoStream?.height ?? 0
      })
    })
  })
}

export async function extractKeyframes(
  filePath: string,
  maxFrames: number
): Promise<{ frames: string[]; tmpDir: string }> {
  const tmpDir = join(tmpdir(), `vtp_${Date.now()}`)
  await fs.mkdir(tmpDir, { recursive: true })

  const meta = await getVideoMeta(filePath)
  const count = Math.max(1, Math.min(maxFrames, 16))

  // Distribute frames evenly across the video duration, avoiding the very start/end
  const interval = meta.durationSec / (count + 1)

  const timestamps: number[] = []
  for (let i = 1; i <= count; i++) {
    timestamps.push(Math.min(interval * i, meta.durationSec - 0.1))
  }

  await Promise.all(
    timestamps.map((ts, idx) => {
      const outPath = join(tmpDir, `frame_${String(idx).padStart(3, '0')}.jpg`)
      return new Promise<void>((resolve, reject) => {
        ffmpeg(filePath)
          .seekInput(ts)
          .frames(1)
          .output(outPath)
          .on('end', () => resolve())
          .on('error', (err) => reject(new Error(`Frame extraction failed at ${ts}s: ${err.message}`)))
          .run()
      })
    })
  )

  const files = await fs.readdir(tmpDir)
  const frames = files
    .filter((f) => f.endsWith('.jpg'))
    .sort()
    .map((f) => join(tmpDir, f))

  return { frames, tmpDir }
}

export async function cleanupTmpDir(tmpDir: string): Promise<void> {
  try {
    const files = await fs.readdir(tmpDir)
    await Promise.all(files.map((f) => fs.unlink(join(tmpDir, f))))
    await fs.rmdir(tmpDir)
  } catch {
    // best-effort cleanup
  }
}
