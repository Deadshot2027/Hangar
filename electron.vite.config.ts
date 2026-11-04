import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared }
  },
  renderer: {
    resolve: { alias: shared },
    plugins: [react()],
    // Not Vite's usual 5173: the projects Hangar previews use that one (QuantApp insists on it).
    server: { port: 5190 },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          launcher: resolve('src/renderer/launcher.html')
        }
      }
    }
  }
})
