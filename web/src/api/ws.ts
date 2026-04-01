/**
 * WebSocket JSON-RPC client with auto-reconnect.
 */

type Listener = (params: unknown) => void

let nextId = 1
const pending = new Map<
  number,
  { resolve: (v: unknown) => void; reject: (e: Error) => void }
>()
const listeners = new Map<string, Set<Listener>>()

let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let statusListeners = new Set<(connected: boolean) => void>()

function getWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws`
}

export function connect(): void {
  if (ws?.readyState === WebSocket.OPEN) return

  ws = new WebSocket(getWsUrl())

  ws.onopen = () => {
    statusListeners.forEach(fn => fn(true))
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  ws.onclose = () => {
    statusListeners.forEach(fn => fn(false))
    // Reject all pending requests
    for (const [id, { reject }] of pending) {
      reject(new Error('WebSocket closed'))
      pending.delete(id)
    }
    // Auto-reconnect after 2s
    reconnectTimer = setTimeout(connect, 2000)
  }

  ws.onerror = () => {
    // onclose will fire after onerror
  }

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data)

      // JSON-RPC response
      if ('id' in msg && ('result' in msg || 'error' in msg)) {
        const p = pending.get(msg.id)
        if (p) {
          pending.delete(msg.id)
          if (msg.error) {
            p.reject(new Error(msg.error.message || 'RPC error'))
          } else {
            p.resolve(msg.result)
          }
        }
        return
      }

      // JSON-RPC notification
      if ('method' in msg) {
        const set = listeners.get(msg.method)
        if (set) {
          set.forEach(fn => fn(msg.params))
        }
        return
      }
    } catch {
      // Ignore parse errors
    }
  }
}

export function disconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  ws?.close()
  ws = null
}

/**
 * Wait for WebSocket to be connected, with timeout.
 */
function waitForOpen(timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws?.readyState === WebSocket.OPEN) {
      resolve()
      return
    }

    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('WebSocket not connected — is the backend server running?'))
    }, timeoutMs)

    const onStatus = (connected: boolean) => {
      if (connected) {
        cleanup()
        resolve()
      }
    }

    const cleanup = () => {
      clearTimeout(timeout)
      statusListeners.delete(onStatus)
    }

    statusListeners.add(onStatus)

    // Also try connecting if not already
    if (!ws || ws.readyState === WebSocket.CLOSED) {
      connect()
    }
  })
}

/**
 * Send a JSON-RPC request and return the result.
 * Waits up to 5s for WebSocket connection if not yet open.
 */
export async function request<T = unknown>(
  method: string,
  params?: unknown,
): Promise<T> {
  await waitForOpen()

  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error('WebSocket not connected'))
      return
    }

    const id = nextId++
    pending.set(id, {
      resolve: resolve as (v: unknown) => void,
      reject,
    })

    ws.send(
      JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        ...(params !== undefined ? { params } : {}),
      }),
    )
  })
}

/**
 * Send a JSON-RPC notification (no response expected).
 */
export function notify(method: string, params?: unknown): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  ws.send(
    JSON.stringify({
      jsonrpc: '2.0',
      method,
      ...(params !== undefined ? { params } : {}),
    }),
  )
}

/**
 * Subscribe to JSON-RPC notifications by method name.
 */
export function on(method: string, callback: Listener): () => void {
  if (!listeners.has(method)) {
    listeners.set(method, new Set())
  }
  listeners.get(method)!.add(callback)
  return () => listeners.get(method)?.delete(callback)
}

/**
 * Subscribe to connection status changes.
 */
export function onStatus(callback: (connected: boolean) => void): () => void {
  statusListeners.add(callback)
  return () => statusListeners.delete(callback)
}

export function isConnected(): boolean {
  return ws?.readyState === WebSocket.OPEN
}
