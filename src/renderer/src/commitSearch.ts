/**
 * Busca e lote da lista de commits do Cherry-pick Studio. Sem React e sem DOM, para ser testada em Node.
 *
 * O texto digitado nunca vira RegExp: ele é separado em termos (palavras por espaço) e cada termo é procurado como
 * trecho comum. Assim "(" ou "[" são só caracteres, e nada quebra por causa do que o usuário digita.
 */
import type { BranchCommit } from '../../shared/types'

/** Quantas linhas a lista monta por vez; "Mostrar mais" acrescenta outro lote do mesmo tamanho. */
export const COMMIT_BATCH = 200

/**
 * Teto de linhas montadas na lista de commits. Passando dele a tela pede para refinar a busca. O teto vale dentro de
 * `batchSlice`, então não depende de quem chama lembrar dele.
 */
export const MAX_SHOWN = 500

const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`)

/**
 * Data local do commit no formato AAAA-MM-DD (`date` é em milissegundos). Usa os getters, não `Intl`: esta função roda
 * uma vez por commit, e um formatador criado aqui custaria caro.
 */
export function localDateKey(ms: number): string {
  if (!Number.isFinite(ms)) return ''
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Texto pesquisável de cada commit, em minúsculas. Cacheado por objeto: digitar refaz só o filtro, não a montagem
 * do texto de cada commit.
 */
const haystacks = new WeakMap<BranchCommit, string>()

function haystackOf(c: BranchCommit): string {
  let text = haystacks.get(c)
  if (text === undefined) {
    // A quebra de linha separa os campos. Um termo nunca tem espaço, então não consegue casar a cavalo de dois campos.
    text = `${c.sha}\n${c.subject}\n${c.author}\n${c.email}\n${localDateKey(c.date)}`.toLowerCase()
    haystacks.set(c, text)
  }
  return text
}

/** Termos da busca: palavras separadas por espaço, em minúsculas. Texto só com espaços não tem termo. */
export function searchTerms(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter((term) => term !== '')
}

/**
 * Commits que casam com a busca: todos os termos (E), cada um em qualquer campo (hash, mensagem, autor, e-mail ou
 * data). Sem termo, devolve a MESMA lista, por referência, para a tela não refazer nada.
 */
export function filterCommits(commits: readonly BranchCommit[], query: string): readonly BranchCommit[] {
  const terms = searchTerms(query)
  if (terms.length === 0) return commits
  return commits.filter((c) => {
    const text = haystackOf(c)
    return terms.every((term) => text.includes(term))
  })
}

/** Os primeiros `count` itens, nunca mais que MAX_SHOWN: o que a lista monta agora. */
export function batchSlice<T>(list: readonly T[], count: number): readonly T[] {
  return list.slice(0, Math.min(MAX_SHOWN, Math.max(0, count)))
}

/** Tamanho do lote seguinte ao atual, respeitando o teto. */
export function growBatch(count: number): number {
  return Math.min(MAX_SHOWN, count + COMMIT_BATCH)
}

/** Quantos commits de `list` estão marcados. */
export function countChecked(checked: ReadonlySet<string>, list: readonly BranchCommit[]): number {
  let n = 0
  for (const c of list) if (checked.has(c.sha)) n++
  return n
}

/**
 * "Todos" com busca ativa: soma os pendentes de `shown` ao que já está marcado. Não toca nos marcados fora de `shown`,
 * então um commit escondido pela busca nunca entra no cherry-pick por causa de "Todos". Devolve um Set novo.
 */
export function checkAll(checked: ReadonlySet<string>, shown: readonly BranchCommit[]): Set<string> {
  const next = new Set(checked)
  for (const c of shown) if (!c.alreadyApplied) next.add(c.sha)
  return next
}

/** "Nenhum" com busca ativa: tira de `checked` só os commits de `shown`. Devolve um Set novo. */
export function uncheckAll(checked: ReadonlySet<string>, shown: readonly BranchCommit[]): Set<string> {
  const next = new Set(checked)
  for (const c of shown) next.delete(c.sha)
  return next
}
