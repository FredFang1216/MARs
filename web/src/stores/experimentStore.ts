import { create } from 'zustand'
import {
  fetchExperiments,
  fetchExperimentDetail,
  fetchExperimentNote,
  fetchExperimentSummaries,
  fetchExperimentJournal,
} from '../api/client'
import type {
  ExperimentLogEntry,
  ExperimentNoteSummary,
  ExperimentDetail,
} from '../components/experiments/types'

interface ExperimentStore {
  experiments: ExperimentLogEntry[]
  summaries: ExperimentNoteSummary[]
  selectedExperimentId: string | null
  experimentDetail: ExperimentDetail | null
  experimentNote: string | null
  detailLoading: boolean
  groupBy: 'purpose' | 'claim' | 'chronological'
  filterStatus: string | null
  journalContent: string | null

  loadExperiments: (sessionId: string) => Promise<void>
  loadSummaries: (sessionId: string) => Promise<void>
  selectExperiment: (sessionId: string, experimentId: string) => Promise<void>
  clearSelection: () => void
  setGroupBy: (group: 'purpose' | 'claim' | 'chronological') => void
  setFilterStatus: (status: string | null) => void
  loadJournal: (sessionId: string) => Promise<void>
  reset: () => void
}

export const useExperimentStore = create<ExperimentStore>((set, get) => ({
  experiments: [],
  summaries: [],
  selectedExperimentId: null,
  experimentDetail: null,
  experimentNote: null,
  detailLoading: false,
  groupBy: 'purpose',
  filterStatus: null,
  journalContent: null,

  loadExperiments: async (sessionId) => {
    try {
      const experiments = await fetchExperiments(sessionId)
      set({ experiments })
    } catch {
      set({ experiments: [] })
    }
  },

  loadSummaries: async (sessionId) => {
    try {
      const summaries = await fetchExperimentSummaries(sessionId)
      set({ summaries })
    } catch {
      set({ summaries: [] })
    }
  },

  selectExperiment: async (sessionId, experimentId) => {
    set({ selectedExperimentId: experimentId, detailLoading: true, experimentNote: null })
    try {
      const detail = await fetchExperimentDetail(sessionId, experimentId)
      set({ experimentDetail: detail, detailLoading: false })
      // Load note in background if available
      if (detail.has_note) {
        fetchExperimentNote(sessionId, experimentId)
          .then(({ content }) => set({ experimentNote: content }))
          .catch(() => {})
      }
    } catch {
      set({ experimentDetail: null, detailLoading: false })
    }
  },

  clearSelection: () => {
    set({ selectedExperimentId: null, experimentDetail: null, experimentNote: null })
  },

  setGroupBy: (group) => set({ groupBy: group }),
  setFilterStatus: (status) => set({ filterStatus: status }),

  loadJournal: async (sessionId) => {
    try {
      const { content } = await fetchExperimentJournal(sessionId)
      set({ journalContent: content })
    } catch {
      set({ journalContent: null })
    }
  },

  reset: () => set({
    experiments: [],
    summaries: [],
    selectedExperimentId: null,
    experimentDetail: null,
    experimentNote: null,
    detailLoading: false,
    journalContent: null,
  }),
}))
