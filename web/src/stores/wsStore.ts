import { create } from 'zustand'
import * as ws from '../api/ws'

interface WsStore {
  connected: boolean
  orchestratorStatus: {
    running: boolean
    status: string
    cycle: number
    phase: string
    hasPendingDecision: boolean
  } | null
  pendingDecision: any | null
  decidingInFlight: boolean
  progressMessages: string[]

  init: () => () => void
  clearProgress: () => void
  clearPendingDecision: () => void
  setDecidingInFlight: (v: boolean) => void
  setOrchestratorStarted: () => void
}

export const useWsStore = create<WsStore>((set, get) => ({
  connected: false,
  orchestratorStatus: null,
  pendingDecision: null,
  decidingInFlight: false,
  progressMessages: [],

  init: () => {
    ws.connect()

    const unsubs: (() => void)[] = []

    unsubs.push(
      ws.onStatus(connected => set({ connected })),
    )

    unsubs.push(
      ws.on('research/progress', (params: any) => {
        set(s => ({
          progressMessages: [
            ...s.progressMessages.slice(-99),
            params.message,
          ],
          // Defensive: if progress arrives but status is still null, the orchestrator is running
          ...(s.orchestratorStatus === null ? {
            orchestratorStatus: {
              running: true,
              status: 'running',
              cycle: 0,
              phase: 'executing',
              hasPendingDecision: false,
            },
          } : {}),
        }))
      }),
    )

    unsubs.push(
      ws.on('research/state_update', (params: any) => {
        set({
          orchestratorStatus: {
            running: true,
            status: 'running',
            cycle: params.cycle,
            phase: 'executing',
            hasPendingDecision: false,
          },
          pendingDecision: null,
          decidingInFlight: false,
        })
      }),
    )

    unsubs.push(
      ws.on('research/agent_start', () => {
        // Agent started means any pending decision was resolved
        set(s => ({
          pendingDecision: null,
          decidingInFlight: false,
          orchestratorStatus: s.orchestratorStatus
            ? { ...s.orchestratorStatus, hasPendingDecision: false, phase: 'executing' }
            : s.orchestratorStatus,
        }))
      }),
    )

    unsubs.push(
      ws.on('research/decision_pending', (params: any) => {
        set({
          pendingDecision: params.decision,
          orchestratorStatus: {
            ...get().orchestratorStatus!,
            hasPendingDecision: true,
            phase: 'deciding',
          },
        })
      }),
    )

    unsubs.push(
      ws.on('research/complete', () => {
        set({
          orchestratorStatus: {
            running: false,
            status: 'completed',
            cycle: get().orchestratorStatus?.cycle ?? 0,
            phase: 'done',
            hasPendingDecision: false,
          },
          pendingDecision: null,
        })
      }),
    )

    unsubs.push(
      ws.on('research/error', (params: any) => {
        set(s => ({
          orchestratorStatus: {
            ...s.orchestratorStatus!,
            running: false,
            status: 'error',
          },
          progressMessages: [
            ...s.progressMessages,
            `Error: ${params.error}`,
          ],
        }))
      }),
    )

    return () => {
      unsubs.forEach(fn => fn())
      ws.disconnect()
    }
  },

  clearProgress: () => set({ progressMessages: [] }),
  clearPendingDecision: () => set({ pendingDecision: null, decidingInFlight: false }),
  setDecidingInFlight: (v) => set({ decidingInFlight: v }),
  setOrchestratorStarted: () => set({
    orchestratorStatus: {
      running: true,
      status: 'running',
      cycle: 0,
      phase: 'starting',
      hasPendingDecision: false,
    },
  }),
}))
