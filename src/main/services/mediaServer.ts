import { createServer, Server, IncomingMessage, ServerResponse } from 'http'
import { createReadStream, statSync, existsSync } from 'fs'
import { extname } from 'path'

/**
 * Tiny local HTTP server for serving thumbnails and analyzed videos to
 * the renderer. Listens on 127.0.0.1 on an OS-assigned port so:
 *   - default CSP accepts http: media without exemption
 *   - Chromium's <video> element can do range requests for seeking
 *   - we don't have to fight Electron's file:// / custom-protocol quirks
 *
 * Security: only paths that have been explicitly registered via
 * registerPath() can be served. The renderer never gets to pick an
 * arbitrary path off the filesystem.
 */

let server: Server | null = null
let port = 0
const allowedPaths = new Set<string>()

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo'
}

function mimeFor(p: string): string {
  return MIME[extname(p).toLowerCase()] ?? 'application/octet-stream'
}

function handle(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')

  if (!req.url) {
    res.writeHead(400).end('bad request')
    return
  }
  // URL is /?p=<percent-encoded-absolute-path>
  const url = new URL(req.url, 'http://127.0.0.1')
  const p = url.searchParams.get('p')
  if (!p) {
    res.writeHead(400).end('missing ?p= path')
    return
  }
  if (!allowedPaths.has(p)) {
    res.writeHead(403).end('path not registered')
    return
  }
  if (!existsSync(p)) {
    res.writeHead(404).end('not found')
    return
  }

  const st = statSync(p)
  const total = st.size
  const range = req.headers.range
  const type = mimeFor(p)

  if (range) {
    // e.g. "bytes=12345-"
    const m = /^bytes=(\d+)-(\d+)?$/.exec(range)
    if (m) {
      const start = parseInt(m[1], 10)
      const end = m[2] ? parseInt(m[2], 10) : total - 1
      if (start <= end && end < total) {
        res.writeHead(206, {
          'Content-Type': type,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${total}`,
          'Accept-Ranges': 'bytes'
        })
        createReadStream(p, { start, end }).pipe(res)
        return
      }
    }
  }

  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': String(total),
    'Accept-Ranges': 'bytes'
  })
  createReadStream(p).pipe(res)
}

export function startMediaServer(): Promise<number> {
  if (server && port) return Promise.resolve(port)
  return new Promise((resolve, reject) => {
    server = createServer(handle)
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server!.address()
      if (addr && typeof addr === 'object') {
        port = addr.port
        console.log('[mediaServer] listening on http://127.0.0.1:' + port)
        resolve(port)
      } else {
        reject(new Error('Could not determine media server port'))
      }
    })
  })
}

export function getMediaPort(): number {
  return port
}

/** Register one absolute path as servable. */
export function registerPath(p: string): void {
  if (p) allowedPaths.add(p)
}

/** Register many paths at once. */
export function registerPaths(paths: Iterable<string>): void {
  for (const p of paths) registerPath(p)
}
