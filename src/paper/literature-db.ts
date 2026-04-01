/**
 * CRUD operations for acquired-papers.json.
 * Used by chat manager, REST API routes, and regeneration endpoints.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs'
import { join } from 'path'
import type { AcquisitionResult } from './deep-research/types'

function acquiredPath(sessionDir: string): string {
  return join(sessionDir, 'literature', 'acquired-papers.json')
}

export function loadAcquiredPapers(sessionDir: string): AcquisitionResult[] {
  const p = acquiredPath(sessionDir)
  if (!existsSync(p)) return []
  try {
    const data = JSON.parse(readFileSync(p, 'utf-8'))
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

export function saveAcquiredPapers(sessionDir: string, papers: AcquisitionResult[]): void {
  const litDir = join(sessionDir, 'literature')
  if (!existsSync(litDir)) mkdirSync(litDir, { recursive: true })
  // Atomic write: write to temp file then rename to prevent corruption
  const filePath = acquiredPath(sessionDir)
  const tmpPath = filePath + '.tmp.' + Date.now()
  writeFileSync(tmpPath, JSON.stringify(papers, null, 2), 'utf-8')
  renameSync(tmpPath, filePath)
}

export function addPaperToAcquired(sessionDir: string, paper: AcquisitionResult): void {
  const papers = loadAcquiredPapers(sessionDir)
  // Deduplicate by source_id
  const exists = papers.some(p => p.paper.source_id === paper.paper.source_id)
  if (!exists) {
    papers.push(paper)
    saveAcquiredPapers(sessionDir, papers)
  }
}

export function removePaperFromAcquired(sessionDir: string, sourceId: string): boolean {
  const papers = loadAcquiredPapers(sessionDir)
  const idx = papers.findIndex(p => p.paper.source_id === sourceId)
  if (idx === -1) return false
  papers.splice(idx, 1)
  saveAcquiredPapers(sessionDir, papers)
  return true
}
