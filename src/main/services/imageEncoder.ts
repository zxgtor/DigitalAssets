import { promises as fs } from 'fs'

export async function encodeImageToBase64(filePath: string): Promise<string> {
  try {
    await fs.access(filePath)
  } catch {
    throw new Error(`Image file not found: ${filePath}`)
  }
  const buf = await fs.readFile(filePath)
  return buf.toString('base64')
}
