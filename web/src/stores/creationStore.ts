import { create } from 'zustand'
import * as ws from '../api/ws'

interface Proposal {
  id: string
  title: string
  abstract: string
  innovation: string[]
  methodology: string
  feasibility: {
    data_required: string
    compute_estimate: string
    timeline_weeks: number
    score: number
  }
  risk: {
    level: 'low' | 'medium' | 'high'
    description: string
  }
  novelty_score: number
  impact_score: number
  references: string[]
  created_at: string
}

export type CreationPhase =
  | 'idle'
  | 'deep_research'
  | 'proposals'
  | 'selecting'
  | 'orchestrator_init'
  | 'complete'
  | 'error'
  | 'cancelled'

interface CreationStore {
  creationId: string | null
  mode: 'auto' | 'stepwise' | null
  phase: CreationPhase
  progress: string[]
  proposals: Proposal[]
  selectedProposal: Proposal | null
  error: string | null
  resultSessionId: string | null

  startAuto: (topic: string, options?: { budget_usd?: number; max_cycles?: number }) => Promise<void>
  startStepwise: (topic: string, options?: { budget_usd?: number; max_cycles?: number }) => Promise<void>
  selectProposal: (proposalId: string) => Promise<void>
  cancel: () => Promise<void>
  reset: () => void
  initListeners: () => () => void
}

export type { Proposal }

export const useCreationStore = create<CreationStore>((set, get) => ({
  creationId: null,
  mode: null,
  phase: 'idle',
  progress: [],
  proposals: [],
  selectedProposal: null,
  error: null,
  resultSessionId: null,

  startAuto: async (topic, options) => {
    set({
      phase: 'deep_research',
      mode: 'auto',
      progress: [],
      proposals: [],
      selectedProposal: null,
      error: null,
      resultSessionId: null,
    })
    try {
      const result = await ws.request<{ creationId: string }>('creation/start-auto', {
        topic,
        ...options,
      })
      set({ creationId: result.creationId })
    } catch (e: any) {
      set({ phase: 'error', error: e.message })
    }
  },

  startStepwise: async (topic, options) => {
    set({
      phase: 'deep_research',
      mode: 'stepwise',
      progress: [],
      proposals: [],
      selectedProposal: null,
      error: null,
      resultSessionId: null,
    })
    try {
      const result = await ws.request<{ creationId: string }>('creation/start-stepwise', {
        topic,
        ...options,
      })
      set({ creationId: result.creationId })
    } catch (e: any) {
      set({ phase: 'error', error: e.message })
    }
  },

  selectProposal: async (proposalId) => {
    const { creationId } = get()
    if (!creationId) return
    try {
      await ws.request('creation/select-proposal', { creationId, proposalId })
    } catch (e: any) {
      set({ error: e.message })
    }
  },

  cancel: async () => {
    const { creationId } = get()
    if (!creationId) return
    try {
      await ws.request('creation/cancel', { creationId })
      set({ phase: 'cancelled' })
    } catch {
      // best effort
    }
  },

  reset: () => {
    set({
      creationId: null,
      mode: null,
      phase: 'idle',
      progress: [],
      proposals: [],
      selectedProposal: null,
      error: null,
      resultSessionId: null,
    })
  },

  initListeners: () => {
    const unsubs: (() => void)[] = []

    const isOurs = (params: any) => {
      const { creationId } = get()
      return !creationId || params.creationId === creationId
    }

    unsubs.push(
      ws.on('creation/phase', (params: any) => {
        if (!isOurs(params)) return
        set({ phase: params.phase })
      }),
    )

    unsubs.push(
      ws.on('creation/progress', (params: any) => {
        if (!isOurs(params)) return
        set(s => ({
          progress: [...s.progress.slice(-199), params.message],
        }))
      }),
    )

    unsubs.push(
      ws.on('creation/proposals_ready', (params: any) => {
        if (!isOurs(params)) return
        set({
          phase: 'selecting',
          proposals: params.proposals,
        })
      }),
    )

    unsubs.push(
      ws.on('creation/proposal_selected', (params: any) => {
        if (!isOurs(params)) return
        set({ selectedProposal: params.proposal })
      }),
    )

    unsubs.push(
      ws.on('creation/complete', (params: any) => {
        if (!isOurs(params)) return
        set({
          phase: 'complete',
          resultSessionId: params.sessionId,
        })
      }),
    )

    unsubs.push(
      ws.on('creation/error', (params: any) => {
        if (!isOurs(params)) return
        set({
          phase: 'error',
          error: params.error,
        })
      }),
    )

    return () => unsubs.forEach(fn => fn())
  },
}))
