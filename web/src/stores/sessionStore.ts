import { create } from 'zustand'
import {
  fetchSessions,
  fetchSessionState,
  fetchSessionConversationState,
  fetchSessionKnowledgePack,
  fetchLiteratureArtifacts,
  type SessionMeta,
} from '../api/client'
import * as ws from '../api/ws'
import { useUiStore } from './uiStore'

interface KnowledgePackState {
  loaded: boolean
  packId: string | null
  manifest: any | null
}

interface SessionStore {
  sessions: SessionMeta[]
  currentSessionId: string | null
  researchState: any | null
  literatureArtifacts: any | null
  sessionMode: 'conversation' | 'researching'
  knowledgePack: KnowledgePackState
  loading: boolean
  error: string | null

  loadSessions: () => Promise<void>
  selectSession: (id: string) => Promise<void>
  createLightweightSession: (topic: string) => Promise<string>
  clearSession: () => void
  updateResearchState: (state: any) => void
  refreshResearchState: () => Promise<void>
  refreshLiteratureArtifacts: () => Promise<void>
  loadKnowledgePack: (packId: string) => Promise<void>
  unloadKnowledgePack: () => Promise<void>
  refreshKnowledgePack: () => Promise<void>
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  researchState: null,
  literatureArtifacts: null,
  sessionMode: 'conversation',
  knowledgePack: { loaded: false, packId: null, manifest: null },
  loading: false,
  error: null,

  loadSessions: async () => {
    set({ loading: true, error: null })
    try {
      const sessions = await fetchSessions()
      set({ sessions, loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  selectSession: async (id: string) => {
    set({ currentSessionId: id, loading: true, error: null })
    // Reset research panel tab to default when switching sessions
    useUiStore.getState().setResearchPanelTab('pipeline')

    let hasResearchState = false

    // Try to load research state (might not exist for conversation-only sessions)
    try {
      const state = await fetchSessionState(id)
      set({ researchState: state, sessionMode: 'researching', loading: false })
      hasResearchState = true
    } catch {
      // No research state — this is a conversation-mode session
      set({ researchState: null, sessionMode: 'conversation', loading: false })

      // Try to load conversation state to detect mode
      try {
        const convState = await fetchSessionConversationState(id)
        if (convState?.mode) {
          set({ sessionMode: convState.mode })
        }
      } catch {
        // No session state either — default to conversation
      }
    }

    // Always try to load literature artifacts (needed for both Research and Literature Review modes)
    try {
      const artifacts = await fetchLiteratureArtifacts(id)
      set({ literatureArtifacts: artifacts, ...(!hasResearchState ? { sessionMode: 'researching' } : {}) })
    } catch {
      set({ literatureArtifacts: null })
    }

    // Load knowledge pack state
    await get().refreshKnowledgePack()
  },

  createLightweightSession: async (topic: string) => {
    const result = await ws.request<{ sessionId: string }>('sessions/new', { topic })
    // Refresh session list
    get().loadSessions()
    return result.sessionId
  },

  clearSession: () => {
    set({
      currentSessionId: null,
      researchState: null,
      literatureArtifacts: null,
      sessionMode: 'conversation',
      knowledgePack: { loaded: false, packId: null, manifest: null },
    })
  },

  updateResearchState: (state: any) => {
    set({ researchState: state })
  },

  refreshResearchState: async () => {
    const id = get().currentSessionId
    if (!id) return
    try {
      const state = await fetchSessionState(id)
      set({ researchState: state })
    } catch {
      // No change on error — avoid resetting state during polling
    }
  },

  refreshLiteratureArtifacts: async () => {
    const id = get().currentSessionId
    if (!id) return
    try {
      const artifacts = await fetchLiteratureArtifacts(id)
      set({ literatureArtifacts: artifacts })
    } catch {
      // No change on error — avoid resetting state during polling
    }
  },

  loadKnowledgePack: async (packId: string) => {
    await ws.request('knowledge/load', { packId })
    await get().refreshKnowledgePack()
  },

  unloadKnowledgePack: async () => {
    await ws.request('knowledge/unload')
    set({ knowledgePack: { loaded: false, packId: null, manifest: null } })
  },

  refreshKnowledgePack: async () => {
    const id = get().currentSessionId
    if (!id) return
    try {
      const data = await fetchSessionKnowledgePack(id)
      set({
        knowledgePack: {
          loaded: data.loaded,
          packId: data.packId ?? null,
          manifest: data.manifest ?? null,
        },
      })
    } catch {
      set({ knowledgePack: { loaded: false, packId: null, manifest: null } })
    }
  },
}))
