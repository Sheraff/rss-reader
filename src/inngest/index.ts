import { Inngest, type InngestFunction } from "inngest"

// Create a client to send and receive events
export const inngest = new Inngest({ id: "rss-reader" })

const helloWorld = inngest.createFunction(
  { id: "hello-world" },
  { event: "test/hello.world" },
  async ({ event, step }) => {
    await step.sleep("wait-a-moment", "1s")
    return { message: `Hello ${event.data.email}!` }
  }
)

// Create an empty array where we'll export future Inngest functions
export const functions = [helloWorld] satisfies Array<InngestFunction<any, any, any>>
