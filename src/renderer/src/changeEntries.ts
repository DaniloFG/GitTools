// Arquivos alterados vistos como um só: o que está no stage e o que ainda não está, juntos.
// Usado pela aba Alterações (visão de caixas) e pela linha de alterações do histórico.

import type { FileStatus, LineStats, RepoStatus } from '../../shared/types'

/** Um arquivo com tudo o que se sabe dele: a parte no stage e a parte fora dele. */
export interface ChangeEntry {
  path: string
  origPath?: string
  staged?: FileStatus
  unstaged?: FileStatus
}

/** Une as duas listas do git: um arquivo com partes nos dois lados aparece uma vez só. */
export function buildEntries(status: Pick<RepoStatus, 'staged' | 'unstaged'>): ChangeEntry[] {
  const byPath = new Map<string, ChangeEntry>()
  for (const f of status.unstaged) byPath.set(f.path, { path: f.path, origPath: f.origPath, unstaged: f })
  for (const f of status.staged) {
    const entry = byPath.get(f.path)
    if (entry) {
      entry.staged = f
      entry.origPath ??= f.origPath
    } else byPath.set(f.path, { path: f.path, origPath: f.origPath, staged: f })
  }
  return [...byPath.values()]
}

/** Soma as linhas das duas partes de um arquivo (binário vence; sem contagem = nada). */
export function sumStats(a?: LineStats, b?: LineStats): LineStats {
  if (a?.binary || b?.binary) return { binary: true }
  const known = [a, b].filter((s) => s && (s.additions !== undefined || s.deletions !== undefined))
  if (!known.length) return {}
  return { additions: (a?.additions ?? 0) + (b?.additions ?? 0), deletions: (a?.deletions ?? 0) + (b?.deletions ?? 0) }
}

/** Resumo para mostrar numa linha só: quantos arquivos, e quantos em cada situação. */
export function summarizeChanges(status: Pick<RepoStatus, 'staged' | 'unstaged' | 'conflicted'>) {
  const entries = buildEntries(status)
  return {
    entries,
    files: entries.length + status.conflicted.length,
    unstaged: status.unstaged.length,
    staged: status.staged.length,
    conflicted: status.conflicted.length
  }
}
