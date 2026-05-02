// yt-dlp-wrap is CommonJS with `module.exports.default = YTDlpWrap`.
// We externalize it from the Vite bundle, so the default-import dance
// produces a namespace object rather than the class itself. Unwrap manually.
import YTDlpWrapImport from 'yt-dlp-wrap'
const YTDlpWrap: typeof YTDlpWrapImport =
  (YTDlpWrapImport as unknown as { default?: typeof YTDlpWrapImport }).default ??
  YTDlpWrapImport

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

/**
 * Locate the bundled yt-dlp binary.
 * - Dev: <project>/resources/bin/yt-dlp.exe
 * - Packaged: <resources>/app.asar.unpacked/resources/bin/yt-dlp.exe
 *   (electron-builder asarUnpack: 'resources/**' takes care of this)
 */
function resolveYtDlpPath(): string {
  const binName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'

  const candidates: string[] = []
  if (app.isPackaged) {
    // Unpacked resources sit alongside app.asar
    candidates.push(
      join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'bin', binName),
      join(process.resourcesPath, 'resources', 'bin', binName),
      join(process.resourcesPath, 'bin', binName)
    )
  } else {
    candidates.push(
      join(app.getAppPath(), 'resources', 'bin', binName),
      join(process.cwd(), 'resources', 'bin', binName)
    )
  }

  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  throw new Error(
    `yt-dlp binary not found. Looked in:\n  ${candidates.join('\n  ')}\n` +
      `Make sure resources/bin/${binName} is committed and bundled.`
  )
}

let ytDlpInstance: InstanceType<typeof YTDlpWrap> | null = null

function getYtDlp(): InstanceType<typeof YTDlpWrap> {
  if (ytDlpInstance) return ytDlpInstance
  const binPath = resolveYtDlpPath()
  console.log('[youtube] using yt-dlp at', binPath)
  ytDlpInstance = new YTDlpWrap(binPath)
  return ytDlpInstance
}

/**
 * Download a YouTube video to disk and return the local path + title.
 * Uses the yt-dlp binary bundled under resources/bin/.
 */
export async function downloadYouTubeVideo(
  url: string,
  destDir: string
): Promise<YouTubeDownloadResult> {
  if (!YT_URL_RE.test(url)) {
    throw new Error('Invalid YouTube URL')
  }

  const ytDlp = getYtDlp()
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
  //   - else best of anything
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
