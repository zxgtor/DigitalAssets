import { useEffect, useState, useCallback } from 'react'
import type { StoredProject } from '@preload/index'

interface UseProjectsReturn {
  projects: StoredProject[]
  loading: boolean
  create: (name: string) => Promise<StoredProject>
  rename: (id: string, name: string) => Promise<StoredProject>
  delete: (id: string) => Promise<void>
}

export function useProjects(): UseProjectsReturn {
  const [projects, setProjects] = useState<StoredProject[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void window.api.projects.list().then((list) => {
      if (cancelled) return
      setProjects(list)
      setLoading(false)
    })
    const unsub = window.api.projects.onUpdate((list) => {
      setProjects(list)
    })
    return () => {
      cancelled = true
      unsub()
    }
  }, [])

  const create = useCallback((name: string) => window.api.projects.create(name), [])
  const rename = useCallback((id: string, name: string) => window.api.projects.rename(id, name), [])
  const del = useCallback((id: string) => window.api.projects.delete(id), [])

  return { projects, loading, create, rename, delete: del }
}
