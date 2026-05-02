import YTDlpWrap from 'yt-dlp-wrap'
import { app } from 'electron'
import { promises as fs } from 'fs'
import { existsSync } from 'fs'
import { join } from 'path'

export interface YouTubeDownloadResult {
  filePath: string
  title: string
}

const YT_URL_RE = /^(https?:\/\/)?(www\.|m\.)?(youtube\.com|youtu\.be)\//i

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*\n\r\t]/g, '_').trim()
  return cleaned || 'youtube_video'
}

let ytDlpInstance: YTDlpWrap | null = null

async function getYtDlp(): Promise<YTDlpWrap> {
  if (ytDlpInstance) return ytDlpInstance

  // Persist the binary in userData so it survives across app launches.
  const binDir = join(app.getPath('userData'), 'bin')
  await fs.mkdir(binDir, { recursive: true })
  const binName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
  const binPath = join(binDir, binName)

  if (!existsSync(binPath)) {
    console.log('[youtube] downloading yt-dlp binary to', binPath)
    await YTDlpWrap.downloadFromGithub(binPath)
    if (process.platform !== 'win32') {
      await fs.chmod(binPath, 0o755)
    }
  }

  ytDlpInstance = new YTDlpWrap(binPath)
  return ytDlpInstance
}

/**
 * Download a YouTube video to disk and return the local path + title.
 * Uses yt-dlp under the hood — far more reliable than pure-JS ytdl-core
 * libraries against YouTube's frequent player changes.
 */
export async function downloadYouTubeVideo(
  url: string,
  destDir: string
): Promise<YouTubeDownloadResult> {
  if (!YT_URL_RE.test(url)) {
    throw new Error('Invalid YouTube URL')
  }

  const ytDlp = await getYtDlp()
  await fs.mkdir(destDir, { recursive: true })

  // 1. Fetch metadata (title) without downloading
  const metaJson = await ytDlp.execPromise([url, '--dump-json', '--no-warnings'])
  const meta = JSON.parse(metaJson) as { title?: string; id?: string }
  const title = meta.title ?? meta.id ?? 'youtube_video'
  const safeTitle = sanitizeFilename(title)
  const filePath = join(destDir, `${safeTitle}.mp4`)

  // 2. Download. Format selection rules:
  //   - prefer best mp4 with both audio+video already merged
  //   - else best mp4 video-only (we don't need audio for visual analysis)
  //   - else best of anything, remuxed to mp4
  console.log(`[youtube] downloading "${title}" -> ${filePath}`)
  await ytDlp.execPromise([
    url,
    '-f',
    'best[ext=mp4]/bv*[ext=mp4]/best',
    '-o',
    filePath,
    '--no-warnings',
    '--no-playlist'
  ])

  if (!existsSync(filePath)) {
    throw new Error(`yt-dlp completed but output file is missing: ${filePath}`)
  }

  return { filePath, title }
}
