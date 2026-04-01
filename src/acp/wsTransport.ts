import type { ServerWebSocket } from 'bun'

import { JsonRpcPeer } from './jsonrpc'

/**
 * WebSocket transport for JSON-RPC peer.
 * Mirrors StdioTransport but uses Bun ServerWebSocket instead of readline/stdout.
 */
export class WebSocketTransport {
  private active = false
  private readonly pending = new Set<Promise<void>>()

  constructor(
    private readonly peer: JsonRpcPeer,
    private readonly ws: ServerWebSocket<unknown>,
  ) {}

  start(): void {
    if (this.active) return
    this.active = true

    this.peer.setSend((line: string) => {
      if (this.ws.readyState === 1 /* OPEN */) {
        this.ws.send(line)
      }
    })
  }

  /** Called by Bun.serve websocket.message handler. */
  handleMessage(data: string | Buffer): void {
    const raw = typeof data === 'string' ? data : data.toString('utf-8')
    const trimmed = raw.trim()
    if (!trimmed) return

    try {
      const payload = JSON.parse(trimmed)
      const p = this.peer.handleIncoming(payload).catch(() => {})
      this.pending.add(p)
      void p.finally(() => this.pending.delete(p))
    } catch {
      // Send parse error back
      const errMsg = JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      })
      if (this.ws.readyState === 1) {
        this.ws.send(errMsg)
      }
    }
  }

  async stop(): Promise<void> {
    this.active = false
    const pending = Array.from(this.pending)
    if (pending.length > 0) {
      await Promise.allSettled(pending)
    }
  }
}
