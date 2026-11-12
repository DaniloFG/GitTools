// Fluxo de conflitos em operações com várias paradas (cherry-pick, revert, rebase): quando continuar sozinho e
// quais escolhas do usuário vale lembrar. Lógica pura, sem React, para ser testada direto (tests/conflict-flow.test.ts).

import type { OperationKind } from '../../shared/types'

/** Lados que o usuário escolhe de propósito e que valem para os próximos commits. */
export type RememberedSide = 'ours' | 'theirs'

/** Caminho já decidido → lado escolhido. A ordem de inserção é a ordem de idade (o primeiro é o mais antigo). */
export type Decisions = ReadonlyMap<string, RememberedSide>

/**
 * Teto de decisões guardadas: o custo do banner não pode crescer com o tamanho do repositório
 * (um "usar o nosso em tudo" pode resolver milhares de arquivos de uma vez).
 */
export const MAX_DECISIONS = 200

export interface AutoContinueInput {
  /** A opção "Continuar automaticamente" está ligada. */
  enabled: boolean
  kind: OperationKind
  /** Quantos arquivos estavam em conflito na leitura anterior. */
  prevConflicts: number
  /** Quantos estão agora. */
  conflicts: number
  /** Rótulo da operação em andamento (null/false = nenhuma). */
  busy: string | null | false
}

/**
 * Continua sozinho só quando o usuário acabou de resolver o último arquivo da parada (n > 0 → 0).
 * Merge fica de fora (o commit de merge pede mensagem e revisão) e `none` não tem o que continuar.
 * Chegar numa parada que já não tem conflito (prev = 0) não continua: ninguém olhou o resultado.
 */
export function shouldAutoContinue({ enabled, kind, prevConflicts, conflicts, busy }: AutoContinueInput): boolean {
  if (!enabled) return false
  if (kind === 'merge' || kind === 'none') return false
  if (busy) return false
  return prevConflicts > 0 && conflicts === 0
}

/**
 * Guarda as escolhas "nosso"/"deles" feitas à mão. Devolve um mapa novo (o recebido não muda).
 * "Resolvido" (edição manual) não é lembrado: o resultado dessa edição não serve para outro commit.
 * Repetir um caminho sobrescreve a escolha e o torna o mais recente; passando do teto, saem os mais antigos.
 */
export function rememberDecisions(
  decisions: Decisions,
  resolutions: readonly { path: string; side: RememberedSide | 'resolved' }[]
): Map<string, RememberedSide> {
  const next = new Map(decisions)
  for (const { path, side } of resolutions) {
    if (side !== 'ours' && side !== 'theirs') continue
    // Apagar antes de gravar move o caminho para o fim: a idade é a da última escolha.
    next.delete(path)
    next.set(path, side)
  }
  // O Map itera na ordem de inserção: o que sobra a podar está no começo.
  let excess = next.size - MAX_DECISIONS
  if (excess > 0) {
    for (const path of next.keys()) {
      next.delete(path)
      if (--excess === 0) break
    }
  }
  return next
}

export interface ReusePlan {
  ours: string[]
  theirs: string[]
}

/** Dos arquivos em conflito nesta parada, os que já têm decisão, separados por lado (cada caminho uma vez). */
export function reusePlan(conflictedPaths: readonly string[], decisions: Decisions): ReusePlan {
  const plan: ReusePlan = { ours: [], theirs: [] }
  if (decisions.size === 0) return plan
  const seen = new Set<string>()
  for (const path of conflictedPaths) {
    if (seen.has(path)) continue
    seen.add(path)
    const side = decisions.get(path)
    if (side) plan[side].push(path)
  }
  return plan
}
