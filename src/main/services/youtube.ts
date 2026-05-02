import ytdl from '@distube/ytdl-core'
import { createWriteStream, promises as fs } from 'fs'
import { join } from 'path'

export interface YouTubeDownloadResult {
  filePath: string
  title: string
}

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*]/g, '_').trim()
  return cleaned || 'youtube_video'
}

/**
 * Download a YouTube video to disk and return the local path + title.
 */
export async function downloadYouTubeVideo(
  url: string,
  destDir: string
): Promise<YouTubeDownloadResult> {
  if (!ytdl.validateURL(url)) {
    throw new Error('Invalid YouTube URL')
  }

  const info = await ytdl.getInfo(url)
  const title = info.videoDetails?.title ?? 'youtube_video'
  const safeTitle = sanitizeFilename(title)

  await fs.mkdir(destDir, { recursive: true })
  const filePath = join(destDir, `${safeTitle}.mp4`)

  // Prefer a combined audio+video stream; fall back to video-only if absent.
  let format
  try {
    format = ytdl.chooseFormat(info.formats, {
      quality: 'highest',
      filter: 'audioandvideo'
    })
  } catch {
    format = undefined
  }
  if (!format) {
    format = ytdl.chooseFormat(info.formats, { filter: 'video' })
  }
  if (!format) {
    throw new Error('No suitable video format found for this YouTube URL')
  }

  await new Promise<void>((resolve, reject) => {
    const stream = ytdl.downloadFromInfo(info, { format })
    const out = createWriteStream(filePath)
    stream.on('error', (err) => reject(err))
    out.on('error', (err) => reject(err))
    out.on('finish', () => resolve())
    stream.pipe(out)
  })

  return { filePath, title }
}
