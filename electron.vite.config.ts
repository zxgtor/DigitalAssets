import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: [
          'fluent-ffmpeg',
          '@ffprobe-installer/ffprobe',
          '@ffmpeg-installer/ffmpeg',
          'yt-dlp-wrap'
        ]
      }
    }
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@preload': resolve('src/preload')
      }
    },
    plugins: [react()]
  }
})
