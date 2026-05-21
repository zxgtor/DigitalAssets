import { useEffect, useState, useCallback } from 'react'
import type { StoredCharacter } from '@preload/index'

interface UseCharactersReturn {
  characters: StoredCharacter[]
  loading: boolean
  create: (
    input: { name: string } & Partial<
      Omit<StoredCharacter, 'id' | 'createdAt' | 'referenceImages'>
    >
  ) => Promise<StoredCharacter>
  update: (
    id: string,
    patch: Partial<Omit<StoredCharacter, 'id' | 'createdAt' | 'referenceImages'>>
  ) => Promise<StoredCharacter>
  delete: (id: string) => Promise<void>
  addReference: (id: string, sourcePath: string) => Promise<string>
  removeReference: (id: string, refPath: string) => Promise<void>
}

export function useCharacters(): UseCharactersReturn {
  const [characters, setCharacters] = useState<StoredCharacter[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void window.api.characters.list().then((list) => {
      if (cancelled) return
      setCharacters(list)
      setLoading(false)
    })
    const unsub = window.api.characters.onUpdate((list) => {
      setCharacters(list)
    })
    return () => {
      cancelled = true
      unsub()
    }
  }, [])

  const create = useCallback(
    (input: Parameters<UseCharactersReturn['create']>[0]) =>
      window.api.characters.create(input),
    []
  )
  const update = useCallback(
    (id: string, patch: Parameters<UseCharactersReturn['update']>[1]) =>
      window.api.characters.update(id, patch),
    []
  )
  const del = useCallback((id: string) => window.api.characters.delete(id), [])
  const addReference = useCallback(
    (id: string, sourcePath: string) =>
      window.api.characters.addReference(id, sourcePath),
    []
  )
  const removeReference = useCallback(
    (id: string, refPath: string) =>
      window.api.characters.removeReference(id, refPath),
    []
  )

  return {
    characters,
    loading,
    create,
    update,
    delete: del,
    addReference,
    removeReference
  }
}
