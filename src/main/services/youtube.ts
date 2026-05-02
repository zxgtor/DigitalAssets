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

  // We only need frames for visual analysis, so audio is unnecessary.
  // Try in order: combined a+v (rare, usually 360p), then video-only (best),
  // then any format with a video stream. ytdl.chooseFormat THROWS on no match,
  // so each tier must be guarded.
  const tryChoose = (
    opts: Parameters<typeof ytdl.chooseFormat>[1]
  ): ytdl.videoFormat | null => {
    try {
      return ytdl.chooseFormat(info.formats, opts)
    } catch {
      return null
    }
  }

  const format =
    tryChoose({ quality: 'highest', filter: 'audioandvideo' }) ??
    tryChoose({ quality: 'highestvideo', filter: 'videoonly' }) ??
    tryChoose({ quality: 'highest', filter: (f) => Boolean(f.hasVideo) })

  if (!format) {
    const summary = info.formats
      .slice(0, 5)
      .map((f) => `${f.qualityLabel ?? f.quality ?? '?'}/${f.container ?? '?'}`)
      .join(', ')
    throw new Error(
      `No playable video format found. First few available formats: ${summary || '(none)'}`
    )
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
