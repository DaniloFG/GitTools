// Ajuda a não redesenhar a tela à toa: a interface se atualiza o tempo todo (ao ganhar foco, a cada
// operação, quando algo muda na pasta .git) e quase sempre os dados continuam iguais.

import type { BranchInfo, CommitInfo, RepoStatus, TagInfo } from '../../shared/types'

/** Devolve `prev` quando `next` tem o mesmo conteúdo: assim o React reaproveita o que já está na tela. */
export function keepIfEqual<T>(prev: T | undefined, next: T): T {
  if (prev === next) return prev as T
  return prev !== undefined && JSON.stringify(prev) === JSON.stringify(next) ? prev : next
}

/** Junta os dados novos aos atuais, mantendo a mesma referência em cada parte (e no todo) que não mudou. */
export function mergeData<T extends object>(prev: T | null, next: T): T {
  if (!prev) return next
  const merged = { ...next }
  let same = true
  for (const key of Object.keys(next) as (keyof T)[]) {
    merged[key] = keepIfEqual(prev[key], next[key])
    if (merged[key] !== prev[key]) same = false
  }
  return same ? prev : merged
}

/**
 * Identifica o histórico sem precisar baixá-lo: ele só muda quando o HEAD, uma branch ou uma tag
 * muda de lugar (ou quando muda o que está sendo listado). Igual a antes = o log em memória vale.
 */
export function historySignature(scope: string, status: RepoStatus, branches: BranchInfo[], tags: TagInfo[]): string {
  return [
    scope,
    status.headSha ?? '',
    status.detached ? 'detached' : (status.branch ?? ''),
    ...branches.map((b) => `${b.fullRef}@${b.sha}`),
    ...tags.map((tag) => `${tag.name}@${tag.sha}`)
  ].join('\n')
}

/** Guarda o último histórico baixado junto com a assinatura dele. */
export interface LogCache {
  key: string
  log: CommitInfo[]
}
