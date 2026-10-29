// Vários repositórios abertos ao mesmo tempo: regras puras da interface (cor de cada repositório, ciclo entre
// as abas, espera das chamadas em andamento antes de trocar de aba, prefixo dos avisos). Ficam fora dos
// componentes para serem testadas (tests/workspace.test.ts).

import type { OperationKind, RepoStatus } from '../../shared/types'

/** Tempo máximo esperando as chamadas do repositório que está saindo; depois disso a troca acontece mesmo assim. */
export const SWITCH_WAIT_MS = 30_000
/** Depois deste tempo na espera, aparece o botão "Trocar mesmo assim". */
export const SWITCH_FORCE_HINT_MS = 3_000

/** Resumo de um repositório aberto, mostrado na aba (atualizado sem precisar trocar para ele). */
export interface RepoSummary {
  branch: string | null
  detached: boolean
  headSha: string | null
  /** Arquivos com alterações (na área de trabalho, no stage ou em conflito). */
  changes: number
  conflicts: number
  operation: OperationKind
}

export function summarize(status: RepoStatus, operation: OperationKind): RepoSummary {
  return {
    branch: status.detached ? null : status.branch,
    detached: status.detached,
    headSha: status.headSha,
    changes: status.staged.length + status.unstaged.length + status.conflicted.length,
    conflicts: status.conflicted.length,
    operation
  }
}

/** Motivo de o repositório ter trabalho em aberto (a interface escreve a frase de cada um). */
export type UnsavedReason = { kind: 'changes'; count: number } | { kind: 'operation'; operation: OperationKind } | { kind: 'drafts'; count: number }

/** Trabalho que se perderia de vista ao fechar a aba (alterações, operação parada ou texto não salvo no editor). */
export function unsavedWork(summary: RepoSummary | undefined, drafts: number): UnsavedReason[] {
  const reasons: UnsavedReason[] = []
  if (summary && summary.changes > 0) reasons.push({ kind: 'changes', count: summary.changes })
  if (summary && summary.operation !== 'none') reasons.push({ kind: 'operation', operation: summary.operation })
  if (drafts > 0) reasons.push({ kind: 'drafts', count: drafts })
  return reasons
}

/** Caminho para comparar (barras iguais, sem barra no fim; no Windows, sem diferença de maiúsculas). */
export function normalizeRoot(path: string): string {
  let p = path.trim().replace(/\\/g, '/')
  while (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
  return /^[A-Za-z]:/.test(p) ? p.toLowerCase() : p
}

export function sameRoot(a: string, b: string): boolean {
  return normalizeRoot(a) === normalizeRoot(b)
}

/** Nome do repositório a partir do caminho (a última pasta), para repositórios que já não estão abertos. */
export function repoNameOf(root: string): string {
  const parts = root.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || root
}

/** Matiz (0 a 359) derivado do caminho: o mesmo repositório tem sempre a mesma cor. FNV-1a sobre o caminho normalizado. */
export function repoHue(root: string): number {
  let hash = 0x811c9dc5
  for (const ch of normalizeRoot(root)) {
    hash ^= ch.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % 360
}

/** Cor do repositório (faixa, aba e chip). Mesma saturação e luminosidade nos dois temas. */
export function repoColor(root: string): string {
  return `hsl(${repoHue(root)} 68% 52%)`
}

/**
 * Próximo índice numa lista circular (Ctrl+Tab vai para a direita, Ctrl+Shift+Tab para a esquerda).
 * Sem aba ativa (índice -1), vai para a primeira (ou a última, indo para trás).
 */
export function cycleIndex(count: number, current: number, delta: 1 | -1): number {
  if (count <= 0) return -1
  const from = current < 0 || current >= count ? (delta > 0 ? -1 : count) : current
  return (from + delta + count) % count
}

/** Aviso de uma ação: com mais de um repositório aberto, cita o repositório entre colchetes. */
export function prefixToast(text: string, repoName: string, several: boolean): string {
  return several ? `[${repoName}] ${text}` : text
}

/** Opções de `CallGate.idle`. */
export interface IdleOptions {
  /** Depois deste tempo (ms), para de esperar e devolve false. */
  timeoutMs?: number
  /** Quando resolve, para de esperar e devolve false (botão "Trocar mesmo assim"). */
  forced?: Promise<unknown>
}

interface Hold {
  promise: Promise<void>
  release(): void
}

/**
 * Controla as chamadas por repositório. Conta as que estão em andamento e, quando a aba de um repositório vai
 * sair, segura as novas chamadas para ele até a troca terminar. Cada chamada já sai com o repositório que estava
 * ativo quando foi pedida, então nada continua no repositório errado. A espera olha só o repositório que sai:
 * uma chamada antiga de outro repositório (troca forçada) não atrasa a troca seguinte.
 */
export class CallGate {
  private running = new Map<string, number>()
  private holds = new Map<string, Hold>()
  private waiters = new Map<string, Set<() => void>>()

  /** Entrada de uma chamada para `root`: espera o portão desse repositório (se estiver fechado) e conta a chamada até `leave`. */
  async enter(root: string): Promise<() => void> {
    let hold = this.holds.get(root)
    while (hold) {
      await hold.promise
      hold = this.holds.get(root)
    }
    this.running.set(root, (this.running.get(root) ?? 0) + 1)
    let left = false
    return () => {
      if (left) return
      left = true
      const count = (this.running.get(root) ?? 1) - 1
      if (count > 0) {
        this.running.set(root, count)
        return
      }
      this.running.delete(root)
      for (const wake of [...(this.waiters.get(root) ?? [])]) wake()
    }
  }

  /** Chamadas de `root` em andamento agora. */
  inFlight(root: string): number {
    return this.running.get(root) ?? 0
  }

  /** O portão de `root` está fechado (as chamadas novas esperam)? */
  isClosed(root: string): boolean {
    return this.holds.has(root)
  }

  /** Segura as chamadas novas para `root` (as em andamento seguem). */
  close(root: string): void {
    if (this.holds.has(root)) return
    let release: () => void = () => undefined
    const promise = new Promise<void>((resolve) => (release = resolve))
    this.holds.set(root, { promise, release })
  }

  /** Libera as chamadas seguradas para `root`. */
  open(root: string): void {
    const hold = this.holds.get(root)
    this.holds.delete(root)
    hold?.release()
  }

  /** Espera as chamadas de `root` terminarem. Resolve true se acabaram; false se o tempo acabou ou `forced` resolveu. */
  idle(root: string, options: IdleOptions = {}): Promise<boolean> {
    if (this.inFlight(root) === 0) return Promise.resolve(true)
    return new Promise<boolean>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const set = this.waiters.get(root) ?? new Set<() => void>()
      this.waiters.set(root, set)
      const finish = (drained: boolean) => {
        set.delete(wake)
        if (timer !== undefined) clearTimeout(timer)
        resolve(drained)
      }
      const wake = () => {
        if (this.inFlight(root) === 0) finish(true)
      }
      set.add(wake)
      if (options.timeoutMs !== undefined) timer = setTimeout(() => finish(false), options.timeoutMs)
      void options.forced?.then(() => finish(false))
    })
  }
}
