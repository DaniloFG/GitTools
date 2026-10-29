import type { CSSProperties } from 'react'
import { repoColor } from '../workspace'

/** Nome do repositório com a cor dele: mostra de qual repositório é a informação (diálogos, log, abas). */
export function RepoChip({ repo, className = '' }: { repo: { root: string; name: string }; className?: string }) {
  return (
    <span className={`repo-chip ${className}`} style={{ '--repo': repoColor(repo.root) } as CSSProperties} title={repo.root}>
      {repo.name}
    </span>
  )
}
