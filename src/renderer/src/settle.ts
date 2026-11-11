import { useEffect, useRef, useState } from 'react'

/**
 * Quanto esperar antes de aplicar uma mudança. Dois tempos, porque máquina lenta desenha devagar: uma seleção
 * pode levar mais de 100 ms para ser desenhada, e então o intervalo entre duas setas passaria desse valor e
 * toda mudança pareceria isolada (e leria o git a cada tecla).
 *  - `quietMs`: sem mudanças há mais que isso, a mudança é isolada (clique deliberado) e vale na hora;
 *  - `waitMs`: senão é rajada (tecla repetindo) e espera isso depois da última mudança, para só ela ser lida.
 * Exatamente no limite de `quietMs` conta como rajada.
 */
export function settleDelay(now: number, lastChangeAt: number | undefined, quietMs: number, waitMs: number): number {
  if (lastChangeAt === undefined) return 0
  return now - lastChangeAt > quietMs ? 0 : waitMs
}

/**
 * Devolve o valor "assentado" (ver `settleDelay`). Enquanto espera, devolve o valor anterior.
 */
export function useSettled<T>(value: T, quietMs: number, waitMs: number): T {
  const [settled, setSettled] = useState(value)
  const lastChangeAt = useRef<number | undefined>(undefined)

  useEffect(() => {
    const now = Date.now()
    const delay = settleDelay(now, lastChangeAt.current, quietMs, waitMs)
    lastChangeAt.current = now
    if (delay === 0) {
      setSettled(() => value)
      return
    }
    // A limpeza cancela o temporizador se outra mudança chegar antes, e também ao desmontar.
    const timer = setTimeout(() => setSettled(() => value), delay)
    return () => clearTimeout(timer)
  }, [value, quietMs, waitMs])

  return settled
}
