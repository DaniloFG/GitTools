// Lógica pura do blame em blocos (ver components/FilesView.tsx, BlameView). Sem React e sem DOM, para ser testada em Node.
//
// O blame de um arquivo grande tem uma linha por linha do arquivo. Como no diff (ver diffBlocks.ts), as linhas são
// cortadas em blocos e só os blocos perto da tela são montados. As funções aqui guardam o que é caro e que não
// deve ser refeito a cada linha ou a cada desenho: cor de calor por commit, posição da primeira e da segunda linha
// de cada bloco de commit, e a assinatura que decide quando o blame precisa ser lido de novo.

import type { BlameCommit, RepoStatus } from '../../shared/types'

const UNCOMMITTED = /^0+$/

/** Linha ainda não commitada (o git usa o sha de zeros). */
export const isUncommitted = (sha: string) => UNCOMMITTED.test(sha)

/**
 * Cor da borda de calor de cada commit (`color-mix` em CSS). Calculada uma vez por blame: a linha só busca a cor
 * pelo sha. Commits mais novos ficam mais fortes; linhas não commitadas ficam no máximo, e um blame sem intervalo
 * de datas (um único commit) também fica no máximo.
 */
export function blameColors(commits: Readonly<Record<string, BlameCommit>>): Map<string, string> {
  let min = Infinity
  let max = -Infinity
  for (const [sha, c] of Object.entries(commits)) {
    if (isUncommitted(sha)) continue
    if (c.date < min) min = c.date
    if (c.date > max) max = c.date
  }
  const out = new Map<string, string>()
  for (const [sha, c] of Object.entries(commits)) {
    const h = isUncommitted(sha) ? 1 : max > min ? (c.date - min) / (max - min) : 1
    out.set(sha, `color-mix(in srgb, var(--accent) ${Math.round(15 + h * 85)}%, transparent)`)
  }
  return out
}

/**
 * Se a linha `i` abre um bloco de commit (`first`) e se é a segunda do bloco (`second`, a que mostra o resumo).
 * Depende das linhas anteriores, por isso olha a lista inteira e não o bloco de linhas que a desenha.
 */
export function blameRowFlags(lines: readonly { sha: string }[], i: number): { first: boolean; second: boolean } {
  const sha = lines[i].sha
  const first = i === 0 || lines[i - 1].sha !== sha
  const second = !first && (i === 1 || lines[i - 2].sha !== sha)
  return { first, second }
}

/**
 * Assinatura do que o blame de `path` (na versão `rev`, se houver) depende. Só muda quando precisa de nova leitura:
 * - sem `rev`: o HEAD e o estado do próprio arquivo no status (índice, árvore, conflito e contagens de linhas).
 *   Mudança em outro arquivo não muda a assinatura, então o blame não é relido à toa.
 * - com `rev`: só o arquivo e a versão importam; o status do repositório não muda o blame de uma versão antiga.
 * O caminho do repositório entra nas duas formas, para trocar de repositório sempre reler.
 */
export function blameSignature(
  root: string,
  status: Pick<RepoStatus, 'headSha' | 'staged' | 'unstaged' | 'conflicted'>,
  path: string,
  rev: string | undefined
): string {
  if (rev) return JSON.stringify([root, rev, path])
  const parts: string[] = []
  const lists: [string, RepoStatus['staged']][] = [
    ['S', status.staged],
    ['U', status.unstaged],
    ['C', status.conflicted]
  ]
  for (const [tag, list] of lists) {
    for (const f of list) {
      if (f.path !== path) continue
      parts.push(`${tag}${f.index}${f.worktree}${f.untracked ? 1 : 0}${f.conflicted ? 1 : 0}:${f.additions ?? ''}:${f.deletions ?? ''}:${f.binary ? 1 : 0}`)
    }
  }
  return JSON.stringify([root, status.headSha, parts])
}
