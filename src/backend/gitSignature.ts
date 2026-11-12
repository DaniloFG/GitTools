// Assinatura do estado da pasta .git (HEAD, index, packed-refs, refs e refs/heads), obtida só com fs.stat, sem
// processo git. O backend guarda a assinatura logo depois de cada comando próprio; quando o observador avisa, uma
// assinatura diferente da guardada quer dizer que algo mudou na .git sem um comando nosso (um commit no terminal).
//
// Limite: `refs` e `refs/heads` cobrem as trocas de branch e os commits no ramo atual. Uma mudança só dentro de
// uma subpasta de refs (refs/heads/feature/x) ou em tags não altera a assinatura; por isso o aviso de fora é um
// indício, não uma garantia.

import { stat } from 'node:fs/promises'
import { join } from 'node:path'

/** O que a assinatura usa de um `Stats` (o `Stats` do Node serve). */
export interface StatLike {
  mtimeMs: number
  size: number
  ino: number
}

/** Caminhos, dentro da pasta .git, que entram na assinatura, na ordem em que aparecem nela. */
const WATCHED: readonly (readonly string[])[] = [['HEAD'], ['index'], ['packed-refs'], ['refs'], ['refs', 'heads']]

/** Assinatura a partir dos stats na ordem de `WATCHED` (`null` = o caminho não existe). Função pura. */
export function signatureOf(stats: readonly (StatLike | null)[]): string {
  return stats.map((s) => (s ? `${s.mtimeMs}:${s.size}:${s.ino}` : '-')).join('|')
}

/**
 * Subcomandos que só leem o repositório. O `runGit` roda o git com `GIT_OPTIONAL_LOCKS=0`, então nenhum deles regrava
 * o index. Um comando de leitura não muda a assinatura própria: se mudasse, uma alteração de fora que chegasse logo
 * antes da leitura seria absorvida por ela e sairia como não externa. Todo o resto conta como escrita.
 */
const READ_ONLY = new Set([
  'status', 'log', 'diff', 'show', 'rev-parse', 'for-each-ref', 'cat-file', 'ls-files', 'ls-tree', 'rev-list', 'blame',
  'shortlog', 'describe', 'merge-base', 'check-ignore', 'name-rev', 'grep', 'count-objects', 'version'
])

/**
 * O comando (argumentos passados ao git) só lê? Pula as opções iniciais: `-c chave=valor` e `-C pasta` levam valor
 * na linha seguinte; as demais opções (`--no-pager`…) são uma palavra só. Sem subcomando reconhecível, é escrita.
 */
export function isReadOnlyCommand(args: readonly string[]): boolean {
  let i = 0
  while (i < args.length && args[i].startsWith('-')) i += args[i] === '-c' || args[i] === '-C' ? 2 : 1
  return i < args.length && READ_ONLY.has(args[i])
}

/**
 * A assinatura `now` é diferente da própria `own`? Sem `own` (ainda não há base) não se afirma nada: devolve false.
 */
export function isExternal(own: string | null, now: string): boolean {
  return own !== null && own !== now
}

/**
 * Assinatura atual da pasta .git `gitDir`. Os 5 stats saem em paralelo: a lista é fixa e pequena, não cresce com o
 * repositório. Nunca lança: caminho ausente ou erro de disco entra como `null`.
 */
export async function readSignature(gitDir: string): Promise<string> {
  const stats = await Promise.all(
    WATCHED.map((parts) => stat(join(gitDir, ...parts)).catch(() => null))
  )
  return signatureOf(stats)
}
