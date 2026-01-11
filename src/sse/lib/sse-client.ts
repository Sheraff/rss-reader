import * as v from "valibot"

/**
 * Typed EventTarget that provides type-safe event dispatching and listening
 */
type TypedEventTarget<EventMap extends Record<string, any>> = {
	addEventListener<K extends keyof EventMap & string>(
		type: K,
		listener: (event: CustomEvent<EventMap[K]>) => void,
		options?: boolean | AddEventListenerOptions
	): void

	removeEventListener<K extends keyof EventMap & string>(
		type: K,
		listener: (event: CustomEvent<EventMap[K]>) => void,
		options?: boolean | EventListenerOptions
	): void

	dispatchEvent<K extends keyof EventMap & string>(event: CustomEvent<EventMap[K]>): boolean
}

export function createSseClient<Schemas extends Record<string, v.BaseSchema<any, any, any>>>({
	schemas,
	signal,
	autoReconnect = true,
	path
}: {
	schemas: Schemas
	signal?: AbortSignal
	autoReconnect?: boolean
	path: string
}) {
	if (schemas.error || schemas.message || schemas.open || schemas.close) {
		throw new Error("Schemas cannot define reserved event names: error, message, open, close")
	}

	type EventMap = {
		[K in keyof Schemas]: v.InferOutput<Schemas[K]>
	} & {
		error: void
		open: void
		close: void
		message: string
	}

	const target = new EventTarget() as TypedEventTarget<EventMap>
	let status: "closed" | "connecting" | "open" | "error" = "closed"

	function connect() {
		console.log("[SSE] Connecting to notifications...")
		status = "connecting"

		const eventSource = new EventSource(path)
		const controller = new AbortController()

		const close = () => {
			console.log("[SSE] Closing connection...")
			status = "closed"
			eventSource.close()
			target.dispatchEvent(new CustomEvent("close"))
			controller.abort()
			signal?.removeEventListener("abort", close)
		}

		signal?.addEventListener("abort", close, { once: true })

		eventSource.onopen = () => {
			console.log("[SSE] Connected")
			status = "open"
			target.dispatchEvent(new CustomEvent("open"))
		}

		eventSource.onmessage = (event) => {
			if (event.data === 'ping') return
			target.dispatchEvent(new CustomEvent("message", { detail: event.data }))
		}

		eventSource.onerror = (err) => {
			console.error("[SSE] Connection error:", err)
			status = "error"
			target.dispatchEvent(new CustomEvent("error"))
			eventSource.close()
			controller.abort()
			signal?.removeEventListener("abort", close)

			// Auto-reconnect after 3 seconds
			if (autoReconnect) {
				setTimeout(() => {
					console.log("[SSE] Reconnecting...")
					connect()
				}, 3000)
			}
		}

		for (const eventName in schemas) {
			const name = eventName as keyof Schemas & string
			const schema = schemas[name]
			const parser = (data: unknown) => v.safeParse(v.pipe(v.string(), v.parseJson(), schema), data)
			eventSource.addEventListener(
				eventName,
				(event) => {
					const result = parser(event.data)
					if (result.success) {
						target.dispatchEvent(new CustomEvent(name, { detail: result.output }))
					} else {
						console.error(`[SSE] Failed to parse ${eventName} event:`, result.issues)
					}
				},
				{ signal: controller.signal }
			)
		}

		return close
	}

	return Object.assign(target, {
		connect,
		get status() {
			return status
		}
	})
}
