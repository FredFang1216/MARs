import { create } from 'zustand'

// Right panel: min 320, max 65% of viewport, default ~45% or 480px
const DEFAULT_RIGHT_WIDTH = Math.max(480, Math.round(window.innerWidth * 0.38))
const MIN_RIGHT_WIDTH = 320
const maxRightWidth = () => Math.round(window.innerWidth * 0.65)

interface UiStore {
  sidebarCollapsed: boolean
  rightPanelVisible: boolean
  rightPanelWidth: number
  graphViewActive: boolean
  graphFullscreen: boolean
  interventionModalOpen: boolean
  interventionModalData: any | null
  selectedClaimId: string | null
  researchPanelTab: 'pipeline' | 'literature' | 'claims' | 'experiments' | 'intel'
  contentFullscreen: boolean

  toggleSidebar: () => void
  setSidebarCollapsed: (v: boolean) => void
  toggleRightPanel: () => void
  setRightPanelVisible: (v: boolean) => void
  setRightPanelWidth: (w: number) => void
  setGraphViewActive: (v: boolean) => void
  setGraphFullscreen: (v: boolean) => void
  openInterventionModal: (data: any) => void
  closeInterventionModal: () => void
  setSelectedClaimId: (id: string | null) => void
  setResearchPanelTab: (tab: 'pipeline' | 'literature' | 'claims' | 'experiments') => void
  setContentFullscreen: (v: boolean) => void
}

export const useUiStore = create<UiStore>((set) => ({
  sidebarCollapsed: window.innerWidth < 1024,
  rightPanelVisible: false,
  rightPanelWidth: DEFAULT_RIGHT_WIDTH,
  graphViewActive: false,
  graphFullscreen: false,
  interventionModalOpen: false,
  interventionModalData: null,
  selectedClaimId: null,
  researchPanelTab: 'pipeline',
  contentFullscreen: false,

  toggleSidebar: () => set(s => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
  toggleRightPanel: () => set(s => ({ rightPanelVisible: !s.rightPanelVisible })),
  setRightPanelVisible: (v) => set({ rightPanelVisible: v }),
  setRightPanelWidth: (w) => set({ rightPanelWidth: Math.min(maxRightWidth(), Math.max(MIN_RIGHT_WIDTH, w)) }),
  setGraphViewActive: (v) => set({ graphViewActive: v }),
  setGraphFullscreen: (v) => set({ graphFullscreen: v }),
  openInterventionModal: (data) => set({ interventionModalOpen: true, interventionModalData: data }),
  closeInterventionModal: () => set({ interventionModalOpen: false, interventionModalData: null }),
  setSelectedClaimId: (id) => set({ selectedClaimId: id }),
  setResearchPanelTab: (tab) => set({ researchPanelTab: tab }),
  setContentFullscreen: (v) => set({ contentFullscreen: v }),
}))
