import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { getSession } from './repoSession'
import { useApp } from './context'

/**
 * Como `useState`, mas o valor fica guardado na sessão do repositório: ao sair da tela (ou da aba do repositório)
 * e voltar, o painel reaparece como estava (arquivo aberto, filtro digitado…), sem recarregar nem recomeçar.
 * Cada repositório tem os seus valores; a `key` identifica o painel (ex.: "changes.active").
 */
export function useSessionState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const { repo } = useApp()
  const panes = getSession(repo.root).ui.panes
  const [value, setValue] = useState<T>(() => (panes.has(key) ? (panes.get(key) as T) : initial))
  // O valor mais recente, para o `set` poder ser estável e ainda assim aceitar uma função.
  const latest = useRef(value)
  latest.current = value
  useEffect(() => {
    panes.set(key, value)
  }, [panes, key, value])
  const set = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => setValue((prev) => (typeof next === 'function' ? (next as (p: T) => T)(prev) : next)),
    []
  )
  return [value, set]
}
