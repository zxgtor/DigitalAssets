/**
 * Build URLs that fetch local files through the main process's tiny
 * media HTTP server (registered via window.api.media.getPort()).
 *
 * We use http://127.0.0.1:PORT instead of file:// or a custom protocol
 * because:
 *  - default CSP accepts http: media without exemption
 *  - <video> can do range requests for proper seeking
 *  - it sidesteps Electron's file:// + custom-protocol quirks
 *
 * Paths must have been registered server-side via mediaServer.registerPath
 * (the analyze IPC handlers do this automatically).
 */

let cachedPort: number | null = null

async function getPort(): Promise<number> {
  if (cachedPort != null) return cachedPort
  cachedPort = await window.api.media.getPort()
  return cachedPort
}

/**
 * Synchronous variant for use in render. Returns an empty string until
 * the port is known; pair with usePrimeMediaPort() at the App root so
 * the cache is warm before any media URL is needed.
 */
export function toMediaUrl(absolutePath: string): string {
  if (cachedPort == null) {
    // Fire-and-forget so subsequent calls hit the cache.
    void getPort()
    return ''
  }
  return `http://127.0.0.1:${cachedPort}/?p=${encodeURIComponent(absolutePath)}`
}

/** Async variant — guaranteed valid URL once it resolves. */
export async function toMediaUrlAsync(absolutePath: string): Promise<string> {
  const port = await getPort()
  return `http://127.0.0.1:${port}/?p=${encodeURIComponent(absolutePath)}`
}

/** Resolve the port early so toMediaUrl() returns a real URL on first call. */
export function primeMediaPort(): Promise<number> {
  return getPort()
}

// Kick off port resolution at module load — by the time a user reaches
// any view that renders media, the cache is warm. Failure here is
// non-fatal; toMediaUrl() will retry on subsequent calls.
if (typeof window !== 'undefined' && window.api?.media) {
  void getPort().catch(() => {
    cachedPort = null
  })
}
