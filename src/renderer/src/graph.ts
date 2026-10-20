// Layout do grafo de commits em "trilhas" (lanes), no estilo GitLens/gitk.

export interface GraphCommit {
  sha: string
  parents: string[]
}

export interface GraphRow {
  sha: string
  /** Coluna do nó deste commit. */
  column: number
  /** Trilhas que chegam pelo topo da linha (sha esperado em cada coluna). */
  lanesIn: (string | null)[]
  /** Trilhas que saem pela base da linha. */
  lanesOut: (string | null)[]
}

export function computeGraph(commits: GraphCommit[]): GraphRow[] {
  let lanes: (string | null)[] = []
  const rows: GraphRow[] = []
  for (const commit of commits) {
    const lanesIn = lanes.slice()
    let column = lanes.indexOf(commit.sha)
    if (column === -1) {
      column = lanes.indexOf(null)
      if (column === -1) column = lanes.length
    }
    const next = lanes.slice()
    while (next.length <= column) next.push(null)
    // Outras trilhas que esperavam este commit terminam aqui (convergem no nó).
    for (let i = 0; i < next.length; i++) if (i !== column && next[i] === commit.sha) next[i] = null
    next[column] = commit.parents[0] ?? null
    for (const parent of commit.parents.slice(1)) {
      if (next.includes(parent)) continue
      const free = next.indexOf(null)
      if (free === -1) next.push(parent)
      else next[free] = parent
    }
    while (next.length && next[next.length - 1] === null) next.pop()
    rows.push({ sha: commit.sha, column, lanesIn, lanesOut: next })
    lanes = next
  }
  return rows
}

export const LANE_COLORS = ['#4fa3ff', '#f2a93b', '#5fd38d', '#e06c9f', '#b48cff', '#3ccbd0', '#ef6b5b', '#c5d15a']
export const laneColor = (index: number) => LANE_COLORS[index % LANE_COLORS.length]
