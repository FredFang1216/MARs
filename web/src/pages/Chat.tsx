import { useState, useRef, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useWsStore } from '../stores/wsStore'
import * as ws from '../api/ws'

interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
}

export default function Chat() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const connected = useWsStore(s => s.connected)

  // Initialize WS session on mount
  useEffect(() => {
    if (!sessionId || !connected) return

    ws.request('sessions/open', { sessionId }).catch(() => {
      // Session may not exist yet; that's ok
    })
  }, [sessionId, connected])

  // Subscribe to agent messages
  useEffect(() => {
    const unsubs: (() => void)[] = []

    unsubs.push(
      ws.on('research/progress', (params: any) => {
        setMessages(prev => [
          ...prev,
          {
            role: 'system',
            content: params.message,
            timestamp: Date.now(),
          },
        ])
      }),
    )

    // For future: agent_message_chunk streaming
    // unsubs.push(ws.on('session_update', ...))

    return () => unsubs.forEach(fn => fn())
  }, [])

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async () => {
    const text = input.trim()
    if (!text) return

    setInput('')
    setMessages(prev => [
      ...prev,
      { role: 'user', content: text, timestamp: Date.now() },
    ])

    // If it starts with /, try as command
    if (text.startsWith('/')) {
      const [cmd, ...rest] = text.slice(1).split(' ')
      setMessages(prev => [
        ...prev,
        {
          role: 'system',
          content: `Executing command: ${cmd}...`,
          timestamp: Date.now(),
        },
      ])

      if (cmd === 'run') {
        try {
          const mode = rest.includes('--auto') ? 'auto' : 'interactive'
          await ws.request('orchestrator/start', { mode })
          setMessages(prev => [
            ...prev,
            {
              role: 'system',
              content: 'Orchestrator started.',
              timestamp: Date.now(),
            },
          ])
        } catch (e: any) {
          setMessages(prev => [
            ...prev,
            {
              role: 'system',
              content: `Error: ${e.message}`,
              timestamp: Date.now(),
            },
          ])
        }
      } else if (cmd === 'status') {
        try {
          const summary = await ws.request<any>('research/summary')
          setMessages(prev => [
            ...prev,
            {
              role: 'assistant',
              content: JSON.stringify(summary, null, 2),
              timestamp: Date.now(),
            },
          ])
        } catch (e: any) {
          setMessages(prev => [
            ...prev,
            {
              role: 'system',
              content: `Error: ${e.message}`,
              timestamp: Date.now(),
            },
          ])
        }
      } else {
        setMessages(prev => [
          ...prev,
          {
            role: 'system',
            content: `Command /${cmd} not yet available in web UI.`,
            timestamp: Date.now(),
          },
        ])
      }
      return
    }

    // Regular message — future: send to LLM via WebSocket
    setMessages(prev => [
      ...prev,
      {
        role: 'system',
        content: 'Chat with LLM is coming in a future update. Use slash commands for now.',
        timestamp: Date.now(),
      },
    ])
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-gray-600 mt-20">
            <p className="text-lg mb-2">Research Chat</p>
            <p className="text-sm">
              Use commands like <code className="text-accent-cyan">/run</code>,{' '}
              <code className="text-accent-cyan">/status</code> to interact with the orchestrator.
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 text-sm ${
                msg.role === 'user'
                  ? 'bg-accent-cyan/20 text-white'
                  : msg.role === 'system'
                    ? 'bg-surface-2 text-gray-400 text-xs font-mono'
                    : 'bg-surface-1 text-gray-200'
              }`}
            >
              <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-800 p-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={connected ? 'Type a command (e.g. /run, /status)...' : 'Connecting...'}
            disabled={!connected}
            className="flex-1 bg-surface-1 border border-gray-700 rounded-lg px-4 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-accent-cyan/50"
          />
          <button
            onClick={handleSend}
            disabled={!connected || !input.trim()}
            className="px-4 py-2 bg-accent-cyan/20 text-accent-cyan rounded-lg text-sm hover:bg-accent-cyan/30 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
