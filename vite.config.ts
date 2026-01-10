import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'

const config = defineConfig({
  clearScreen: false,
  plugins: [
    devtools(),
    nitro(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
