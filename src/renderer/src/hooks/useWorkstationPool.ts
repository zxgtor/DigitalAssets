import { useEffect, useState, useCallback } from 'react'
import type { Workstation, Job, SchedulerMode, DiscoveryCandidate } from '../types'
import type { StoredCharacter, BuildImageWorkflowOptions } from '@preload/index'

export interface PoolSubmitArgs {
  workflow: unknown
  hints?: { preferWorkstation?: string; character?: StoredCharacter }
  buildOptions?: BuildImageWorkflowOptions
}

export interface UseWorkstationPool {
  workstations: Workstation[]
  jobs: Job[]
  loading: boolean
  add: (input: { name: string; url: string }) => Promise<Workstation>
  remove: (id: string) => Promise<void>
  edit: (id: string, patch: Partial<{ name: string; url: string; enabled: boolean }>) => Promise<void>
  refreshModels: (id: string) => Promise<void>
  setMode: (mode: SchedulerMode) => Promise<void>
  submit: (args: PoolSubmitArgs) => Promise<string>
  cancel: (id: string) => Promise<void>
  removeJob: (id: string) => Promise<void>
  clearDoneJobs: () => Promise<void>
  discover: (onCandidate?: (c: DiscoveryCandidate) => void) => Promise<DiscoveryCandidate[]>
  testConnection: (url: string) => Promise<{ ok: boolean; gpu?: string; error?: string }>
}

export function useWorkstationPool(): UseWorkstationPool {
  const [workstations, setWorkstations] = useState<Workstation[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const init = async (): Promise<void> => {
      const [w, j] = await Promise.all([
        window.api.workstations.list(),
        window.api.workstations.getJobs()
      ])
      if (cancelled) return
      setWorkstations(w)
      setJobs(j)
      setLoading(false)
    }
    void init()

    const unsubW = window.api.workstations.onUpdate(setWorkstations)
    const unsubJ = window.api.workstations.onJobsUpdate(setJobs)
    return () => {
      cancelled = true
      unsubW(); unsubJ()
    }
  }, [])

  const discover = useCallback(
    async (onCandidate?: (c: DiscoveryCandidate) => void): Promise<DiscoveryCandidate[]> => {
      const unsub = onCandidate
        ? window.api.workstations.onDiscoverCandidate(onCandidate)
        : (): void => {}
      try {
        return await window.api.workstations.discover()
      } finally {
        unsub()
      }
    },
    []
  )

  return {
    workstations,
    jobs,
    loading,
    add: (input) => window.api.workstations.add(input),
    remove: (id) => window.api.workstations.remove(id),
    edit: (id, patch) => window.api.workstations.edit(id, patch),
    refreshModels: (id) => window.api.workstations.refreshModels(id),
    setMode: (mode) => window.api.workstations.setMode(mode),
    submit: ({ workflow, hints, buildOptions }) =>
      window.api.workstations.submit({ workflow: workflow as never, hints, buildOptions }),
    cancel: (id) => window.api.workstations.cancel(id),
    removeJob: (id) => window.api.workstations.removeJob(id),
    clearDoneJobs: () => window.api.workstations.clearDoneJobs(),
    discover,
    testConnection: (url) => window.api.workstations.testConnection(url)
  }
}
