import { useCallback, useEffect, useState } from 'react'
import type { RecentRepo } from '../../shared/api'

/**
 * Repositórios recentes: os favoritos (agrupados) e os demais. `reloadKey` recarrega a lista quando muda
 * (ex.: ao abrir outro repositório). Favoritar e remover atualizam a lista na hora.
 */
export function useRecentRepos(reloadKey?: unknown) {
  const [recent, setRecent] = useState<RecentRepo[]>([])
  const reload = useCallback(() => window.gittools.recentRepositories().then(setRecent, () => setRecent([])), [])
  useEffect(() => void reload(), [reload, reloadKey])

  const setFavorite = useCallback(
    async (path: string, favorite: boolean) => {
      await window.gittools.setRepositoryFavorite(path, favorite).catch(() => undefined)
      await reload()
    },
    [reload]
  )
  const remove = useCallback(
    async (path: string) => {
      await window.gittools.removeRecentRepository(path).catch(() => undefined)
      await reload()
    },
    [reload]
  )
  return {
    favorites: recent.filter((r) => r.favorite),
    others: recent.filter((r) => !r.favorite),
    setFavorite,
    remove
  }
}
