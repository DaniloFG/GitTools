import { useEffect, useRef, useState } from 'react'

/**
 * Quanto esperar antes de aplicar uma mudança. Mudança isolada (a anterior foi há mais de `intervalMs`)
 * vale na hora; mudança logo depois de outra (rajada, tecla repetindo) espera `intervalMs`, para que
 * só a última da rajada dispare as leituras. Exatamente no limite conta como rajada.
 */
export function settleDelay(now: number, lastChangeAt: number | undefined, intervalMs: number): number {
  if (lastChangeAt === undefined) return 0
  return now - lastChangeAt > intervalMs ? 0 : intervalMs
}

/**
 * Devolve o valor "assentado": muda na hora quando a mudança é isolada e só depois de `intervalMs`
 * sem novas mudanças quando elas vêm em rajada. Enquanto espera, devolve o valor anterior.
 */
export function useSettled<T>(value: T, intervalMs: number): T {
  const [settled, setSettled] = useState(value)
  const lastChangeAt = useRef<number | undefined>(undefined)

  useEffect(() => {
    const now = Date.now()
    const delay = settleDelay(now, lastChangeAt.current, intervalMs)
    lastChangeAt.current = now
    if (delay === 0) {
      setSettled(() => value)
      return
    }
    // A limpeza cancela o temporizador se outra mudança chegar antes, e também ao desmontar.
    const timer = setTimeout(() => setSettled(() => value), delay)
    return () => clearTimeout(timer)
  }, [value, intervalMs])

  return settled
}
