/**
 * Convert an absolute filesystem path into a `media://` URL that the
 * Electron main process serves via its registered protocol handler.
 *
 * - Backslashes are normalized to forward slashes (Windows)
 * - Each segment is percent-encoded to survive `:`, spaces, etc.
 *
 *   D:\Apps\foo\bar.jpg   ->  media:///D%3A/Apps/foo/bar.jpg
 *   /tmp/vtp/0001.jpg     ->  media:///tmp/vtp/0001.jpg
 */
export function toMediaUrl(absolutePath: string): string {
  const fwd = absolutePath.replace(/\\/g, '/')
  // Strip any leading slash so we control the join below.
  const trimmed = fwd.replace(/^\/+/, '')
  const encoded = trimmed
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
  return `media:///${encoded}`
}
