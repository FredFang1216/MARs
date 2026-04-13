import { create } from 'zustand'
import * as ws from '../api/ws'

interface WritePaperResult {
  success: boolean
  pdfPath?: string
  warnings: string[]
  phases_completed: string[]
}

interface ReviewReport {
  reviewer_id: string
  model_used: string
  overall_score: number
  decision: 'accept' | 'minor_revision' | 'major_revision' | 'reject'
  confidence: number
  summary: string
  strengths: Array<{ aspect: string; detail: string; location?: string }>
  weaknesses: Array<{ aspect: string; detail: string; location?: string }>
  questions: string[]
  missing_references: string[]
  minor_issues: string[]
  actionable_suggestions: string[]
  dimensions: Record<string, number>
}

interface MetaReview {
  average_score: number
  decision: 'accept' | 'minor_revision' | 'major_revision' | 'reject'
  consensus_level: 'high' | 'medium' | 'low'
  key_issues: Array<{
    priority: 'critical' | 'major' | 'minor'
    description: string
    action: string
    assignee: string
  }>
  reviews: ReviewReport[]
}

interface ReviewResult {
  reviews: ReviewReport[]
  meta_review: MetaReview
}

interface DeliveryManifest {
  created_at: string
  format: string
  files: Array<{ path: string; description: string }>
  paper_title: string
  pdf_path: string
  source_dir: string
}

interface NextAction {
  action: string
  delegate_to: string
  targets_claim?: string | null
  reasoning: string
  risk: string
}

interface ResearchActionsStore {
  // Write Paper
  writePaperLoading: boolean
  writePaperResult: WritePaperResult | null
  writePaperError: string | null
  // Review
  reviewLoading: boolean
  reviewResult: ReviewResult | null
  reviewError: string | null
  reviewModalOpen: boolean
  // Deliver
  deliverLoading: boolean
  deliverResult: DeliveryManifest | null
  deliverError: string | null
  // Next Action
  nextActionLoading: boolean
  nextAction: NextAction | null
  // Progress
  actionProgress: string[]
  // PDF modal
  pdfModalOpen: boolean

  writePaper: (templateId?: string) => Promise<void>
  review: (opts?: { strength?: string; num_reviewers?: number }) => Promise<void>
  deliver: (opts?: { format?: string; include_code?: boolean }) => Promise<void>
  fetchNextAction: () => Promise<void>
  openReviewModal: () => void
  closeReviewModal: () => void
  openPdfModal: () => void
  closePdfModal: () => void
  clearActionProgress: () => void
  initListeners: () => () => void
}

export const useResearchActionsStore = create<ResearchActionsStore>((set, get) => ({
  writePaperLoading: false,
  writePaperResult: null,
  writePaperError: null,
  reviewLoading: false,
  reviewResult: null,
  reviewError: null,
  reviewModalOpen: false,
  deliverLoading: false,
  deliverResult: null,
  deliverError: null,
  nextActionLoading: false,
  nextAction: null,
  actionProgress: [],
  pdfModalOpen: false,

  writePaper: async (templateId?: string) => {
    set({ writePaperLoading: true, writePaperError: null, writePaperResult: null, actionProgress: [] })
    try {
      const result = await ws.request<WritePaperResult>('research/write-paper', { templateId })
      set({ writePaperResult: result, writePaperLoading: false })
    } catch (err: any) {
      set({ writePaperError: err?.message ?? 'Write paper failed', writePaperLoading: false })
    }
  },

  review: async (opts) => {
    set({ reviewLoading: true, reviewError: null, reviewResult: null, actionProgress: [] })
    try {
      const result = await ws.request<ReviewResult>('research/review', opts ?? {})
      set({ reviewResult: result, reviewLoading: false, reviewModalOpen: true })
    } catch (err: any) {
      set({ reviewError: err?.message ?? 'Review failed', reviewLoading: false })
    }
  },

  deliver: async (opts) => {
    set({ deliverLoading: true, deliverError: null, deliverResult: null, actionProgress: [] })
    try {
      const result = await ws.request<DeliveryManifest>('research/deliver', opts ?? {})
      set({ deliverResult: result, deliverLoading: false })
    } catch (err: any) {
      set({ deliverError: err?.message ?? 'Delivery failed', deliverLoading: false })
    }
  },

  fetchNextAction: async () => {
    set({ nextActionLoading: true })
    try {
      const result = await ws.request<NextAction>('research/next-action')
      set({ nextAction: result, nextActionLoading: false })
    } catch {
      set({ nextActionLoading: false })
    }
  },

  openReviewModal: () => set({ reviewModalOpen: true }),
  closeReviewModal: () => set({ reviewModalOpen: false }),
  openPdfModal: () => set({ pdfModalOpen: true }),
  closePdfModal: () => set({ pdfModalOpen: false }),
  clearActionProgress: () => set({ actionProgress: [] }),

  initListeners: () => {
    const unsub = ws.on('research/progress', (params: any) => {
      const state = get()
      const anyLoading = state.writePaperLoading || state.reviewLoading || state.deliverLoading
      if (anyLoading && params?.message) {
        set({ actionProgress: [...state.actionProgress, params.message] })
      }
    })
    return unsub
  },
}))
