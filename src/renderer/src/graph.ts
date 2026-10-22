// Layout do grafo de commits em "trilhas" (lanes).
// Cada trilha guarda a sua cor do início ao fim: uma linha
// muda de coluna sem mudar de cor, e uma branch nova recebe a próxima cor da paleta.

export interface GraphCommit {
  sha: string
  parents: string[]
}

export interface GraphRow {
  sha: string
  /** Coluna do nó deste commit. */
  column: number
  /** Cor (índice da paleta) do nó — a cor da trilha/branch deste commit. */
  color: number
  /** Trilhas que chegam pelo topo da linha (sha esperado em cada coluna). */
  lanesIn: (string | null)[]
  /** Cor de cada trilha que chega pelo topo. */
  colorsIn: number[]
  /** Trilhas que saem pela base da linha. */
  lanesOut: (string | null)[]
  /** Cor de cada trilha que sai pela base. */
  colorsOut: number[]
}

/**
 * Calcula colunas e cores. `headSha` (o commit do HEAD) faz a linha da branch atual manter a cor dela
 * até o fim: quando várias trilhas chegam ao mesmo commit dessa linha, o nó fica na trilha do HEAD.
 */
export function computeGraph(commits: GraphCommit[], headSha?: string | null): GraphRow[] {
  const headLine = firstParentLine(commits, headSha)
  let lanes: (string | null)[] = []
  let colors: number[] = []
  let nextColor = 0
  let headColor = -1
  const newColor = () => nextColor++
  const rows: GraphRow[] = []
  for (const commit of commits) {
    const lanesIn = lanes.slice()
    const colorsIn = colors.slice()
    let column = lanes.indexOf(commit.sha)
    if (column !== -1 && headLine.has(commit.sha)) {
      const head = lanes.findIndex((sha, i) => sha === commit.sha && colors[i] === headColor)
      if (head !== -1) column = head
    }
    // Ponta de uma branch que ninguém esperava: abre uma trilha com cor nova.
    const fresh = column === -1
    if (fresh) {
      column = lanes.indexOf(null)
      if (column === -1) column = lanes.length
    }
    const next = lanes.slice()
    const nextColors = colors.slice()
    while (next.length <= column) {
      next.push(null)
      nextColors.push(-1)
    }
    const color = fresh ? newColor() : colors[column]
    if (commit.sha === headSha) headColor = color
    // Outras trilhas que esperavam este commit terminam aqui (convergem no nó).
    for (let i = 0; i < next.length; i++) {
      if (i !== column && next[i] === commit.sha) {
        next[i] = null
        nextColors[i] = -1
      }
    }
    // O primeiro pai continua a trilha (e a cor) deste commit.
    next[column] = commit.parents[0] ?? null
    nextColors[column] = commit.parents[0] ? color : -1
    for (const parent of commit.parents.slice(1)) {
      if (next.includes(parent)) continue
      let free = next.indexOf(null)
      if (free === -1) {
        free = next.length
        next.push(null)
        nextColors.push(-1)
      }
      next[free] = parent
      nextColors[free] = newColor()
    }
    while (next.length && next[next.length - 1] === null) {
      next.pop()
      nextColors.pop()
    }
    rows.push({ sha: commit.sha, column, color, lanesIn, colorsIn, lanesOut: next, colorsOut: nextColors })
    lanes = next
    colors = nextColors
  }
  return rows
}

/** Commits da linha principal do HEAD (seguindo só o primeiro pai). */
function firstParentLine(commits: GraphCommit[], headSha?: string | null): Set<string> {
  const line = new Set<string>()
  if (!headSha) return line
  const bySha = new Map(commits.map((c) => [c.sha, c]))
  for (let c = bySha.get(headSha); c && !line.has(c.sha); c = bySha.get(c.parents[0])) line.add(c.sha)
  return line
}

const cache = new WeakMap<GraphCommit[], { head: string | null; rows: GraphRow[] }>()

/** Grafo da lista de commits, calculado uma vez por lista (compartilhado entre histórico e barra lateral). */
export function graphFor(commits: GraphCommit[], headSha: string | null = null): GraphRow[] {
  let entry = cache.get(commits)
  if (!entry || entry.head !== headSha) {
    entry = { head: headSha, rows: computeGraph(commits, headSha) }
    cache.set(commits, entry)
  }
  return entry.rows
}

/** Cor da trilha de cada commit (sha → índice da paleta). */
export function commitColors(commits: GraphCommit[], headSha: string | null = null): Map<string, number> {
  return new Map(graphFor(commits, headSha).map((r) => [r.sha, r.color]))
}

export const LANE_COLORS = ['#4fa3ff', '#f2a93b', '#5fd38d', '#e06c9f', '#b48cff', '#3ccbd0', '#ef6b5b', '#c5d15a']
export const laneColor = (index: number) => LANE_COLORS[((index % LANE_COLORS.length) + LANE_COLORS.length) % LANE_COLORS.length]

/** Campos usados na pesquisa do histórico. */
export interface SearchableCommit extends GraphCommit {
  subject: string
  author: string
  refs: string[]
  /** Data do commit (ms); permite pesquisar por data ou hora. */
  date?: number
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Formas em que a data do commit pode ser pesquisada: "2026-10-21", "21/10/2026" (no formato do
 * idioma), "14:32" e as combinações de data e hora.
 */
const dateTextCache = new Map<string, string>()

export function dateSearchText(ms: number, locale?: string): string {
  // Formatar datas é caro e a pesquisa refaz isso para todos os commits a cada tecla: guarda o resultado.
  const key = `${locale ?? ''}|${ms}`
  const cached = dateTextCache.get(key)
  if (cached !== undefined) return cached
  if (dateTextCache.size > 20000) dateTextCache.clear()
  const text = formatDateSearchText(ms, locale)
  dateTextCache.set(key, text)
  return text
}

function formatDateSearchText(ms: number, locale?: string): string {
  const d = new Date(ms)
  const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const local = d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
  // O mesmo texto da coluna de data, para a pesquisa marcar exatamente o que aparece na tela.
  const shown = d.toLocaleString(locale, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  return [`${iso} ${time}`, `${local} ${time}`, shown, d.toLocaleDateString(locale)].join('\n')
}

/** Nome de branch/tag de uma referência do `git log --decorate` ("HEAD -> main", "tag: v1"). */
export function refName(ref: string): string {
  if (ref.startsWith('HEAD -> ')) return ref.slice(8)
  if (ref.startsWith('tag: ')) return ref.slice(5)
  return ref
}

/**
 * O commit corresponde à pesquisa? Procura (sem diferenciar maiúsculas) no nome das branches e tags,
 * na mensagem, no autor, na data e hora e no início do hash. Vários termos separados por espaço
 * precisam aparecer todos (ex.: "21/10/2026 14:").
 */
export function matchesCommit(commit: SearchableCommit, query: string, locale?: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return true
  const date = commit.date === undefined ? [] : [dateSearchText(commit.date, locale)]
  const text = [commit.subject, commit.author, ...commit.refs.map(refName), ...date].join('\n').toLowerCase()
  const sha = commit.sha.toLowerCase()
  return terms.every((term) => text.includes(term) || sha.startsWith(term))
}
