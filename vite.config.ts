import { defineConfig } from "vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { nitro } from "nitro/vite"

const config = defineConfig({
	clearScreen: false,
	plugins: [
		devtools({ enhancedLogs: { enabled: false } }),
		tanstackStart(), nitro(), viteReact()]
})

export default config
