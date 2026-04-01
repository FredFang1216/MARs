import { useState, useRef, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useWsStore } from '../../stores/wsStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useChatStore, type ChatMessage } from '../../stores/chatStore'
import { useUiStore } from '../../stores/uiStore'
import { useResearchPolling } from '../../hooks/useResearchPolling'
import * as ws from '../../api/ws'
import MarkdownViewer from '../shared/MarkdownViewer'

let _idCounter = 0
function uid(prefix: string): string {
  return `${prefix}_${Date.now()}_${++_idCounter}`
}

export default function ChatPanel() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const connected = useWsStore(s => s.connected)
  const researchState = useSessionStore(s => s.researchState)
  const sessions = useSessionStore(s => s.sessions)
  const loadSessions = useSessionStore(s => s.loadSessions)
  const selectSession = useSessionStore(s => s.selectSession)
  const setRightPanelVisible = useUiStore(s => s.setRightPanelVisible)
  const rightPanelVisible = useUiStore(s => s.rightPanelVisible)
  const toggleRightPanel = useUiStore(s => s.toggleRightPanel)

  const messages = useChatStore(s => s.messages)
  const isLoading = useChatStore(s => s.isLoading)
  const addMessage = useChatStore(s => s.addMessage)
  const loadHistory = useChatStore(s => s.loadHistory)
  const clearMessages = useChatStore(s => s.clearMessages)
  const initChatListeners = useChatStore(s => s.initListeners)

  // Load session state and show right panel when in a session
  useEffect(() => {
    if (sessionId) {
      selectSession(sessionId)
      setRightPanelVisible(true)
    } else {
      setRightPanelVisible(false)
    }
  }, [sessionId, selectSession, setRightPanelVisible])

  // Load session list for welcome state
  useEffect(() => {
    if (!sessionId) loadSessions()
  }, [sessionId, loadSessions])

  // Poll research state every 10s for live updates
  useResearchPolling(sessionId)

  // Open the session on WS when we have a session
  useEffect(() => {
    if (!sessionId || !connected) return
    ws.request('sessions/open', { sessionId }).catch(() => {})
  }, [sessionId, connected])

  // Load persisted chat history when session changes
  useEffect(() => {
    if (sessionId && connected) {
      loadHistory(sessionId)
    } else if (!sessionId) {
      clearMessages()
    }
  }, [sessionId, connected, loadHistory, clearMessages])

  // Subscribe to WS chat notifications
  useEffect(() => {
    const cleanup = initChatListeners()
    return cleanup
  }, [initChatListeners])


  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async () => {
    const text = input.trim()
    if (!text) return
    setInput('')

    // ── No session: create a lightweight one ──
    if (!sessionId) {
      try {
        const createSession = useSessionStore.getState().createLightweightSession
        const newSessionId = await createSession(text.slice(0, 100))
        // Navigate to the new session — the message will be sent after load
        navigate(`/s/${newSessionId}`, { state: { pendingMessage: text } })
      } catch (e: any) {
        addMessage({
          id: uid('err'),
          role: 'system',
          content: `Failed to create session: ${e.message}`,
          timestamp: new Date().toISOString(),
        })
      }
      return
    }

    // ── Slash commands ──
    if (text.startsWith('/')) {
      addMessage({
        id: uid('user'),
        role: 'user',
        content: text,
        timestamp: new Date().toISOString(),
      })
      await handleSlashCommand(text)
      return
    }

    // ── Normal chat message: send to LLM ──
    addMessage({
      id: uid('user'),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    })

    useChatStore.getState().setLoading(true)
    try {
      await ws.request('chat/send', { message: text })
      // Response arrives via WS notification (chat/message_complete)
    } catch (e: any) {
      useChatStore.getState().setLoading(false)
      addMessage({
        id: uid('err'),
        role: 'system',
        content: `Error: ${e.message}`,
        timestamp: new Date().toISOString(),
      })
    }
  }

  // Handle pending message after session creation + navigation
  useEffect(() => {
    const navState = window.history.state?.usr as { pendingMessage?: string } | undefined
    if (navState?.pendingMessage && sessionId && connected) {
      const text = navState.pendingMessage
      // Clear the pending state
      window.history.replaceState({}, '')

      // Ensure session is open on the WS before sending the message
      let cancelled = false
      ;(async () => {
        try {
          await ws.request('sessions/open', { sessionId })
        } catch {
          // Already opened by the other effect, or will be — continue anyway
        }
        if (cancelled) return
        addMessage({
          id: uid('user'),
          role: 'user',
          content: text,
          timestamp: new Date().toISOString(),
        })
        useChatStore.getState().setLoading(true)
        try {
          await ws.request('chat/send', { message: text })
        } catch (e: any) {
          useChatStore.getState().setLoading(false)
          addMessage({
            id: uid('err'),
            role: 'system',
            content: `Error: ${e.message}`,
            timestamp: new Date().toISOString(),
          })
        }
      })()
      return () => { cancelled = true }
    }
  }, [sessionId, connected, addMessage])

  const handleSlashCommand = async (text: string) => {
    const [cmd, ...rest] = text.slice(1).split(' ')
    if (cmd === 'run') {
      try {
        const mode = rest.includes('--auto') ? 'auto' : 'interactive'
        await ws.request('orchestrator/start', { mode })
        addMessage({ id: uid('sys'), role: 'system', content: 'Orchestrator started.', timestamp: new Date().toISOString() })
      } catch (e: any) {
        addMessage({ id: uid('err'), role: 'system', content: `Error: ${e.message}`, timestamp: new Date().toISOString() })
      }
    } else if (cmd === 'status') {
      try {
        const summary = await ws.request<any>('research/summary')
        addMessage({ id: uid('sys'), role: 'assistant', content: JSON.stringify(summary, null, 2), timestamp: new Date().toISOString() })
      } catch (e: any) {
        addMessage({ id: uid('err'), role: 'system', content: `Error: ${e.message}`, timestamp: new Date().toISOString() })
      }
    } else if (cmd === 'stop') {
      try {
        await ws.request('orchestrator/stop', {})
        addMessage({ id: uid('sys'), role: 'system', content: 'Orchestrator stopped.', timestamp: new Date().toISOString() })
      } catch (e: any) {
        addMessage({ id: uid('err'), role: 'system', content: `Error: ${e.message}`, timestamp: new Date().toISOString() })
      }
    } else {
      addMessage({
        id: uid('sys'),
        role: 'system',
        content: 'Available: /run, /run --auto, /status, /stop',
        timestamp: new Date().toISOString(),
      })
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Research context bar — only when session has research */}
      {sessionId && researchState?.proposal && (
        <div className="px-4 py-2 border-b border-gray-800 bg-surface-1/50 flex items-center gap-3">
          <span className="text-xs text-gray-500">Research:</span>
          <span className="text-xs text-white truncate">{researchState.proposal.title}</span>
          {researchState.stability && (
            <span className="text-xs text-accent-cyan ml-auto flex-shrink-0">
              {(researchState.stability.convergenceScore * 100).toFixed(0)}% converged
            </span>
          )}
        </div>
      )}

      {/* Toggle button to reopen research panel */}
      {sessionId && !rightPanelVisible && (
        <button
          onClick={toggleRightPanel}
          className="fixed right-4 top-1/2 -translate-y-1/2 z-20 p-2 bg-surface-2 border border-gray-700 rounded-lg text-gray-400 hover:text-accent-cyan hover:border-accent-cyan/30 transition-colors shadow-lg"
          title="Open research panel"
          aria-label="Open research panel"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 2v12M2 2h12v12H2z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !isLoading ? (
          /* ── Empty state: Welcome / Landing ── */
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-lg w-full">
              <div className="w-14 h-14 mx-auto mb-5 rounded-2xl bg-accent-cyan/10 flex items-center justify-center">
                <span className="text-2xl font-bold text-accent-cyan">CP</span>
              </div>

              {sessionId ? (
                <>
                  <h2 className="text-lg font-semibold text-white mb-1">Research Chat</h2>
                  <p className="text-xs text-gray-500 mb-6">
                    Ask questions, search papers, or use commands
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {[
                      { cmd: '/run', desc: 'Start orchestrator' },
                      { cmd: '/run --auto', desc: 'Auto mode' },
                      { cmd: '/status', desc: 'Research summary' },
                      { cmd: '/stop', desc: 'Stop orchestrator' },
                    ].map(item => (
                      <button
                        key={item.cmd}
                        onClick={() => setInput(item.cmd)}
                        className="px-3 py-2 bg-surface-1 border border-gray-800 rounded-lg text-left hover:border-accent-cyan/30 transition-colors group"
                      >
                        <code className="text-xs text-accent-cyan">{item.cmd}</code>
                        <div className="text-[11px] text-gray-600 mt-0.5">{item.desc}</div>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <h2 className="text-lg font-semibold text-white mb-1">Claude Paper</h2>
                  <p className="text-sm text-gray-500 mb-6">
                    AI-powered autonomous research system
                  </p>

                  <p className="text-xs text-gray-500 mb-4">
                    Type a message to start a conversation, or create a full research session.
                  </p>

                  <button
                    onClick={() => navigate('/new')}
                    className="px-6 py-2.5 bg-accent-cyan/20 text-accent-cyan rounded-lg text-sm font-medium hover:bg-accent-cyan/30 transition-colors mb-6"
                  >
                    + Start Full Research Pipeline
                  </button>

                  {sessions.length > 0 && (
                    <div className="text-left max-w-md mx-auto mt-2">
                      <div className="text-[11px] text-gray-600 uppercase tracking-wider mb-2 px-1">
                        Recent Sessions
                      </div>
                      <div className="space-y-1">
                        {sessions.slice(0, 5).map(s => (
                          <button
                            key={s.id}
                            onClick={() => navigate(`/s/${s.id}`)}
                            className="w-full text-left px-3 py-2 rounded-lg bg-surface-1 border border-gray-800 hover:border-accent-cyan/30 transition-colors group"
                          >
                            <div className="text-sm text-gray-300 group-hover:text-white truncate">
                              {s.topic}
                            </div>
                            <div className="text-xs text-gray-600 mt-0.5">
                              {new Date(s.last_active).toLocaleDateString()}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ) : (
          /* ── Message list ── */
          <GroupedMessageList messages={messages} isLoading={isLoading} navigate={navigate} bottomRef={bottomRef} />
        )}
      </div>

      {/* Input bar — always visible */}
      <div className="border-t border-gray-800 p-3">
        <div className="flex gap-2 items-end max-w-3xl mx-auto">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              !connected
                ? 'Connecting to server...'
                : sessionId
                  ? 'Ask a question, search papers, or type a command...'
                  : 'Type a message to start a new conversation...'
            }
            disabled={!connected}
            rows={1}
            className="chat-input flex-1 bg-surface-1 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-accent-cyan/40 resize-none"
          />
          {isLoading ? (
            <button
              onClick={() => useChatStore.getState().cancelMessage()}
              className="p-2.5 bg-red-500/20 text-red-400 rounded-xl hover:bg-red-500/30 transition-colors flex-shrink-0"
              title="Stop generating"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor" />
              </svg>
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!connected || !input.trim()}
              className="p-2.5 bg-accent-cyan/20 text-accent-cyan rounded-xl hover:bg-accent-cyan/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M14 2L7 9M14 2l-5 12-2-5-5-2 12-5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Message Bubble Component ─────────────────────────────

function MessageBubble({ msg, navigate }: { msg: ChatMessage; navigate: (path: string) => void }) {
  // Action buttons (e.g., __action:new_research:topic)
  if (msg.role === 'system' && msg.content.startsWith('__action:new_research:')) {
    const topic = msg.content.replace('__action:new_research:', '')
    return (
      <div className="flex justify-start animate-fade-in">
        <button
          onClick={() => navigate(`/new?topic=${encodeURIComponent(topic)}`)}
          className="flex items-center gap-2 px-4 py-2.5 bg-accent-cyan/15 text-accent-cyan rounded-xl text-sm font-medium hover:bg-accent-cyan/25 transition-colors border border-accent-cyan/20"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Start research: &ldquo;{topic.length > 40 ? topic.slice(0, 40) + '...' : topic}&rdquo;
        </button>
      </div>
    )
  }

  // Regular messages
  return (
    <div
      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`}
    >
      <div
        className={`max-w-[75%] rounded-xl px-4 py-2.5 text-sm ${
          msg.role === 'user'
            ? 'bg-accent-cyan/15 text-white rounded-br-sm'
            : msg.role === 'system'
              ? 'bg-surface-2 text-gray-400 text-xs font-mono rounded-bl-sm'
              : 'bg-surface-1 text-gray-200 border border-gray-800 rounded-bl-sm'
        }`}
      >
        {msg.role === 'assistant' ? (
          <MarkdownViewer content={msg.content} />
        ) : (
          <pre className="whitespace-pre-wrap font-[inherit]">{msg.content}</pre>
        )}
        {msg.metadata?.cost_usd != null && (
          <div className="text-[10px] text-gray-600 mt-1 font-mono">
            {msg.metadata.tokens_used?.toLocaleString()} tokens &middot; ${msg.metadata.cost_usd.toFixed(4)}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Grouped Message List ─────────────────────────────────

type GroupedItem = { type: 'message'; msg: ChatMessage } | { type: 'tool_group'; messages: ChatMessage[] }

function isToolMessage(msg: ChatMessage): boolean {
  return msg.role === 'system' && (msg.content.startsWith('__tool_call:') || msg.content.startsWith('__tool_result:'))
}

function groupMessages(messages: ChatMessage[]): GroupedItem[] {
  const groups: GroupedItem[] = []
  let toolBatch: ChatMessage[] | null = null

  for (const msg of messages) {
    if (isToolMessage(msg)) {
      if (!toolBatch) toolBatch = []
      toolBatch.push(msg)
    } else {
      if (toolBatch) {
        groups.push({ type: 'tool_group', messages: toolBatch })
        toolBatch = null
      }
      groups.push({ type: 'message', msg })
    }
  }
  if (toolBatch) {
    groups.push({ type: 'tool_group', messages: toolBatch })
  }
  return groups
}

function GroupedMessageList({
  messages,
  isLoading,
  navigate,
  bottomRef,
}: {
  messages: ChatMessage[]
  isLoading: boolean
  navigate: (path: string) => void
  bottomRef: React.RefObject<HTMLDivElement | null>
}) {
  const grouped = useMemo(() => groupMessages(messages), [messages])

  return (
    <div className="space-y-3 max-w-3xl mx-auto">
      {grouped.map((item, i) =>
        item.type === 'tool_group' ? (
          <ToolActivityBlock key={`tg-${i}`} messages={item.messages} isLoading={isLoading} />
        ) : (
          <MessageBubble key={item.msg.id || i} msg={item.msg} navigate={navigate} />
        ),
      )}

      {/* Typing indicator — only show if no tool activity is currently visible */}
      {isLoading && (messages.length === 0 || !isToolMessage(messages[messages.length - 1])) && (
        <div className="flex justify-start animate-fade-in">
          <div className="bg-surface-1 border border-gray-800 rounded-xl rounded-bl-sm px-4 py-3">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-accent-cyan/60 animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-2 h-2 rounded-full bg-accent-cyan/60 animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-2 h-2 rounded-full bg-accent-cyan/60 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  )
}

// ── Collapsible Tool Activity Block ──────────────────────

interface ToolEntry {
  name: string
  input: string
  result: string | null
}

function parseToolMessages(messages: ChatMessage[]): ToolEntry[] {
  const entries: ToolEntry[] = []

  for (const msg of messages) {
    if (msg.content.startsWith('__tool_call:')) {
      const raw = msg.content.slice('__tool_call:'.length)
      const colonIdx = raw.indexOf(':')
      const name = raw.slice(0, colonIdx)
      let input = ''
      try {
        const parsed = JSON.parse(raw.slice(colonIdx + 1))
        input = parsed.query || parsed.command || parsed.pattern || parsed.path || parsed.url || JSON.stringify(parsed).slice(0, 120)
      } catch {
        input = raw.slice(colonIdx + 1).slice(0, 120)
      }
      entries.push({ name, input, result: null })
    } else if (msg.content.startsWith('__tool_result:')) {
      const raw = msg.content.slice('__tool_result:'.length)
      const colonIdx = raw.indexOf(':')
      const name = raw.slice(0, colonIdx)
      const result = raw.slice(colonIdx + 1)
      // Match to the last entry with same name that has no result yet
      for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i].name === name && entries[i].result === null) {
          entries[i].result = result
          break
        }
      }
    }
  }

  return entries
}

function ToolActivityBlock({ messages, isLoading }: { messages: ChatMessage[]; isLoading: boolean }) {
  const entries = useMemo(() => parseToolMessages(messages), [messages])
  const hasInProgress = entries.some(e => e.result === null)
  const [collapsed, setCollapsed] = useState(false)
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)

  // Auto-collapse when all tools finish (loading stops)
  useEffect(() => {
    if (!isLoading && !hasInProgress) {
      setCollapsed(true)
    } else {
      setCollapsed(false)
    }
  }, [isLoading, hasInProgress])

  if (entries.length === 0) return null

  return (
    <div className="flex justify-start animate-fade-in">
      <div className="bg-surface-2/40 rounded-lg border border-gray-800/50 text-xs font-mono w-full max-w-[85%]">
        {/* Header */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-2/60 rounded-lg transition-colors"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            className={`text-gray-600 transition-transform flex-shrink-0 ${collapsed ? '' : 'rotate-90'}`}
          >
            <path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
          </svg>
          <span className="text-gray-500">
            Tool Activity
          </span>
          <span className="text-gray-600 text-[10px]">
            ({entries.length} tool{entries.length > 1 ? 's' : ''})
          </span>
          {hasInProgress && (
            <span className="ml-auto flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan animate-pulse" />
            </span>
          )}
        </button>

        {/* Tool entries */}
        {!collapsed && (
          <div className="px-3 pb-2 space-y-1">
            {entries.map((entry, i) => (
              <div key={i}>
                <button
                  onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
                  className="w-full flex items-center gap-2 py-1 text-left hover:bg-surface-3/30 rounded px-1 transition-colors"
                >
                  {entry.result !== null ? (
                    <span className="text-accent-green flex-shrink-0">&#10003;</span>
                  ) : (
                    <span className="w-3 h-3 flex-shrink-0 flex items-center justify-center">
                      <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan animate-pulse" />
                    </span>
                  )}
                  <span className="text-accent-cyan">{entry.name}</span>
                  <span className="text-gray-600 truncate flex-1">{entry.input}</span>
                </button>
                {expandedIdx === i && entry.result !== null && (
                  <pre className="ml-5 mt-1 mb-1 p-2 bg-surface-1 rounded text-[11px] text-gray-500 whitespace-pre-wrap max-h-40 overflow-y-auto border border-gray-800/30">
                    {entry.result.slice(0, 800)}{entry.result.length > 800 ? '...' : ''}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
