import { createFileRoute } from "@tanstack/react-router"
import { serve } from "inngest/nitro"
import { inngest, functions } from "#/inngest"

// serve({ client: inngest, functions })

export const Route = createFileRoute("/api/inngest")({
  server: {
    handlers: {}
  }
})
