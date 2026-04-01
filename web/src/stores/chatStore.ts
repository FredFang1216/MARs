import { create } from 'zustand'
import * as ws from '../api/ws'
import { fetchMessages } from '../api/client'

let _idCounter = 0
function uniqueId(prefix: string): string {
  return `${prefix}_${Date.now()}_${++_idCounter}`
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
  metadata?: {
    model?: string
    tokens_used?: number
    cost_usd?: number
    tool_calls?: { name: string; summary: string }[]
  }
}

interface ChatStore {
  messages: ChatMessage[]
  isLoading: boolean
  currentSessionId: string | null

  /** Load persisted message history from backend (REST or WS). */
  loadHistory: (sessionId: string) => Promise<void>

  /** Add a local message (optimistic UI). */
  addMessage: (msg: ChatMessage) => void

  /** Cancel the currently processing message. */
  cancelMessage: () => Promise<void>

  setLoading: (v: boolean) => void
  clearMessages: () => void

  /** Subscribe to WS chat notifications. Returns cleanup function. */
  initListeners: () => () => void
}

export const useChatStore = create<ChatStore>((set, get) => ({
  messages: [],
  isLoading: false,
  currentSessionId: null,

  loadHistory: async (sessionId: string) => {
    // Avoid redundant loads
    if (get().currentSessionId === sessionId && get().messages.length > 0) return

    set({ currentSessionId: sessionId, messages: [] })

    try {
      // Try REST first (works on page refresh)
      const msgs = await fetchMessages(sessionId)
      if (Array.isArray(msgs) && msgs.length > 0) {
        set({ messages: msgs })
        return
      }
    } catch {
      // REST might fail if session has no state yet — that's fine
    }

    // Fallback: try WS RPC
    try {
      const msgs = await ws.request<ChatMessage[]>('chat/history')
      if (Array.isArray(msgs)) {
        set({ messages: msgs })
      }
    } catch {
      // No history yet — start fresh
    }
  },

  addMessage: (msg) => {
    set(s => ({
      messages: [...s.messages, msg],
    }))
  },

  cancelMessage: async () => {
    try {
      await ws.request('chat/cancel')
    } catch {
      // Ignore — session might not be active
    }
    set({ isLoading: false })
  },

  setLoading: (v) => set({ isLoading: v }),

  clearMessages: () => set({ messages: [], currentSessionId: null }),

  initListeners: () => {
    const unsubs: (() => void)[] = []

    // Listen for complete assistant messages
    unsubs.push(
      ws.on('chat/message_complete', (params: any) => {
        const msg = params?.message as ChatMessage | undefined
        if (msg) {
          set(s => {
            // Avoid duplicates — check if message ID already exists
            if (s.messages.some(m => m.id === msg.id)) return s
            return { messages: [...s.messages, msg], isLoading: false }
          })
        } else {
          set({ isLoading: false })
        }
      }),
    )

    // Loading state when message processing starts
    unsubs.push(
      ws.on('chat/message_start', () => {
        set({ isLoading: true })
      }),
    )

    // Message cancelled (user hit Stop)
    unsubs.push(
      ws.on('chat/message_cancelled', (params: any) => {
        const msg = params?.message as ChatMessage | undefined
        if (msg) {
          set(s => {
            if (s.messages.some(m => m.id === msg.id)) return s
            return { messages: [...s.messages, msg], isLoading: false }
          })
        } else {
          set({ isLoading: false })
        }
      }),
    )

    // Tool call notifications (optional: could show inline)
    unsubs.push(
      ws.on('chat/tool_call', (params: any) => {
        // Add a system message showing tool usage
        const toolMsg: ChatMessage = {
          id: uniqueId('tool'),
          role: 'system',
          content: `__tool_call:${params.toolName}:${JSON.stringify(params.toolInput ?? {})}`,
          timestamp: new Date().toISOString(),
        }
        set(s => ({ messages: [...s.messages, toolMsg] }))
      }),
    )

    unsubs.push(
      ws.on('chat/tool_result', (params: any) => {
        const resultMsg: ChatMessage = {
          id: uniqueId('tool_result'),
          role: 'system',
          content: `__tool_result:${params.toolName}:${params.result ?? ''}`,
          timestamp: new Date().toISOString(),
        }
        set(s => ({ messages: [...s.messages, resultMsg] }))
      }),
    )

    return () => unsubs.forEach(fn => fn())
  },
}))
