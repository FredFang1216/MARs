/**
 * Web UI entrypoint for Claude Paper.
 *
 * Starts a Bun HTTP server with:
 * - REST API at /api/*
 * - WebSocket at /ws for JSON-RPC real-time communication
 * - Static file serving from dist/web/ (production frontend)
 */

import { existsSync, readFileSync } from 'fs'
import { join, extname } from 'path'

import { JsonRpcPeer } from '../acp/jsonrpc'
import { WebSocketTransport } from '../acp/wsTransport'
import { WebAgent } from '../web/agent/webAgent'
import { OrchestratorManager } from '../web/orchestrator/manager'
import { CreationManager } from '../web/creation/manager'
import { handleApiRoute } from '../web/api/routes'

const PORT = Number(process.env.CPAPER_WEB_PORT) || 3456
const HOST = process.env.CPAPER_WEB_HOST || '127.0.0.1'
const CWD = process.env.CPAPER_WEB_CWD || process.cwd()

// Single orchestrator manager shared across all connections
const orchestratorManager = new OrchestratorManager()
const creationManager = new CreationManager(orchestratorManager)

// Track active connections for cleanup
const activeConnections = new Map<
  object,
  { transport: WebSocketTransport; agent: WebAgent }
>()

// ── MIME Types ────────────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
}

// ── Static File Serving ──────────────────────────────────

function serveStatic(pathname: string): Response | null {
  const webDir = join(__dirname, '..', '..', 'dist', 'web')
  const filePath = join(webDir, pathname === '/' ? 'index.html' : pathname)

  // Security: prevent path traversal
  if (!filePath.startsWith(webDir)) {
    return new Response('Forbidden', { status: 403 })
  }

  if (!existsSync(filePath)) return null

  const ext = extname(filePath)
  const mime = MIME_TYPES[ext] || 'application/octet-stream'
  const content = readFileSync(filePath)

  return new Response(content, {
    headers: {
      'Content-Type': mime,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000',
    },
  })
}

// ── Server ───────────────────────────────────────────────

const server = Bun.serve<{ peer: JsonRpcPeer }>({
  hostname: HOST,
  port: PORT,

  fetch(req, server) {
    const url = new URL(req.url)

    // WebSocket upgrade
    if (url.pathname === '/ws') {
      const peer = new JsonRpcPeer()
      const upgraded = server.upgrade(req, { data: { peer } })
      if (!upgraded) {
        return new Response('WebSocket upgrade failed', { status: 400 })
      }
      return undefined as any
    }

    // REST API
    if (url.pathname.startsWith('/api/')) {
      const response = handleApiRoute(req, CWD)
      // handleConfigUpdate is async, handle both sync and async
      if (response instanceof Promise) {
        return response
      }
      return response
    }

    // Static files (SPA)
    const staticResponse = serveStatic(url.pathname)
    if (staticResponse) return staticResponse

    // SPA fallback: serve index.html for all non-API, non-static routes
    const fallback = serveStatic('/')
    if (fallback) return fallback

    return new Response('Not Found', { status: 404 })
  },

  websocket: {
    open(ws) {
      const { peer } = ws.data
      const transport = new WebSocketTransport(peer, ws)
      transport.start()

      const agent = new WebAgent(peer, orchestratorManager, creationManager, { cwd: CWD })
      activeConnections.set(ws, { transport, agent })
    },

    message(ws, data) {
      const conn = activeConnections.get(ws)
      if (!conn) return

      const message = typeof data === 'string' ? data : new TextDecoder().decode(data)
      conn.transport.handleMessage(message)
    },

    close(ws) {
      const conn = activeConnections.get(ws)
      if (conn) {
        // Reattach orchestrator peer on reconnection (don't stop orchestrator)
        const sessionId = conn.agent.getSessionId()
        if (sessionId) {
          // Orchestrator keeps running; will reattach on next connection
        }
        void conn.transport.stop()
        activeConnections.delete(ws)
      }
    },
  },
})

console.log(`Claude Paper Web UI`)
console.log(`  API:       http://${HOST}:${PORT}/api/health`)
console.log(`  WebSocket: ws://${HOST}:${PORT}/ws`)
console.log(`  Frontend:  http://${HOST}:${PORT}/`)
console.log(`  CWD:       ${CWD}`)
console.log()
console.log(`Press Ctrl+C to stop.`)
