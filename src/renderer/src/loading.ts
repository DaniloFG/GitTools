// Quando mostrar o indicador de carregamento (sem React nem DOM, para poder ser testado à parte).
//
// Uma operação que termina antes de `delayMs` não mostra nada, para a tela não piscar. Quem já apareceu fica
// na tela por pelo menos `minMs`, para o indicador não sumir antes de dar para ler o que está sendo feito.
// O hook que usa isto (`useDelayedLoading`, em components/Loader.tsx) guarda `LoadingMemory` entre os desenhos.

export interface LoadingTiming {
  /** Tempo de espera antes de aparecer. */
  delayMs: number
  /** Tempo mínimo que fica na tela depois de aparecer. */
  minMs: number
}

export const LOADING_TIMING: LoadingTiming = { delayMs: 150, minMs: 300 }

/** O que precisa ser lembrado de um desenho para o próximo. */
export interface LoadingMemory {
  /** Quando o carregamento começou (null = não está em andamento). */
  startedAt: number | null
  /** Quando o indicador apareceu (null = ainda não apareceu). */
  shownAt: number | null
}

export const IDLE_LOADING: LoadingMemory = { startedAt: null, shownAt: null }

export interface LoadingPlan extends LoadingMemory {
  /** O indicador deve estar na tela agora. */
  visible: boolean
  /** Em quantos ms desenhar de novo, para mudar de estado sem depender de nova ação (null = nada a fazer). */
  wakeIn: number | null
}

/**
 * Decide, no instante `now`, se o indicador aparece e o que lembrar para depois.
 * `active`: a operação está em andamento agora.
 */
export function planLoading(active: boolean, memory: LoadingMemory, now: number, timing: LoadingTiming = LOADING_TIMING): LoadingPlan {
  if (active) {
    // Já está na tela: continua até a operação terminar.
    if (memory.shownAt !== null) return { startedAt: memory.startedAt, shownAt: memory.shownAt, visible: true, wakeIn: null }
    const startedAt = memory.startedAt ?? now
    const due = startedAt + timing.delayMs
    if (now >= due) return { startedAt, shownAt: now, visible: true, wakeIn: null }
    return { startedAt, shownAt: null, visible: false, wakeIn: due - now }
  }
  // Terminou antes de aparecer: nada a mostrar.
  if (memory.shownAt === null) return { startedAt: null, shownAt: null, visible: false, wakeIn: null }
  // Terminou depois de aparecer: some só quando passar o tempo mínimo.
  const hideAt = memory.shownAt + timing.minMs
  if (now >= hideAt) return { startedAt: null, shownAt: null, visible: false, wakeIn: null }
  return { startedAt: null, shownAt: memory.shownAt, visible: true, wakeIn: hideAt - now }
}
