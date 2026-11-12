// Lógica pura do pipeline de validação (scripts/validacao/pipeline.mjs) e do ponta a ponta (e2e.mjs).
// Fica separada dos roteiros para o teste (tests/validacao.test.ts) cobrir sem subir build nem Chromium.
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const RAIZ = resolve(fileURLToPath(new URL('../..', import.meta.url)))
/** Pasta de saída (logs, relatório, print da falha). Está no .gitignore. */
export const SAIDA = join(RAIZ, 'validacao-out')

/** Fase que confere a árvore contra outra ref; só existe com `--igual-a`. */
export const FASE_IGUAL = 'homolog-igual-develop'

/** Fases na ordem de execução: o comando é `npm run <script>` ou o próprio Node, conforme `comando`. */
export const FASES = [
  { nome: 'typecheck', comando: ['npm', 'run', 'typecheck'] },
  { nome: 'test', comando: ['npm', 'test'] },
  { nome: 'build', comando: ['npm', 'run', 'build'] },
  { nome: 'build-extension', comando: ['npm', 'run', 'build:extension'] },
  { nome: 'perf-bundle', comando: ['npm', 'run', 'perf:bundle'] },
  { nome: 'e2e', comando: ['node', 'scripts/validacao/e2e.mjs'] }
]

/**
 * Lê os argumentos do pipeline. Nunca lança: argumento inválido volta em `erro`, para o roteiro mostrar a
 * mensagem e sair com código 2 em vez de rodar algo diferente do que foi pedido.
 * @param {string[]} argv
 * @returns {{ keepGoing: boolean, so: string | null, igualA: string | null, erro: string | null }}
 */
export function parseArgs(argv) {
  const opcoes = { keepGoing: false, so: null, igualA: null, erro: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const [nome, valorInline] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined]
    if (nome === '--keep-going') {
      opcoes.keepGoing = true
    } else if (nome === '--so' || nome === '--igual-a') {
      const valor = valorInline ?? argv[++i]
      if (!valor || valor.startsWith('--')) return { ...opcoes, erro: `${nome} pede um valor` }
      if (nome === '--so') opcoes.so = valor
      else opcoes.igualA = valor
    } else {
      return { ...opcoes, erro: `argumento desconhecido: ${arg}` }
    }
  }
  const validas = [...FASES.map((f) => f.nome), ...(opcoes.igualA ? [FASE_IGUAL] : [])]
  if (opcoes.so && !validas.includes(opcoes.so)) {
    const dica = opcoes.so === FASE_IGUAL ? ' (use --igual-a <ref>)' : ''
    return { ...opcoes, erro: `fase desconhecida: ${opcoes.so}${dica}. Fases: ${validas.join(', ')}` }
  }
  return opcoes
}

/** Fases a rodar, na ordem. A conferência de árvore vai primeiro: é barata e dispensa o resto se já diverge. */
export function fasesDoPlano({ so, igualA }) {
  const todas = [...(igualA ? [{ nome: FASE_IGUAL }] : []), ...FASES]
  return so ? todas.filter((f) => f.nome === so) : todas
}

/** Últimas `n` linhas não vazias do final do texto (o resto da saída fica só no arquivo de log). */
export function ultimasLinhas(texto, n = 15) {
  return texto.split(/\r?\n/).filter((l) => l.trim() !== '').slice(-n).join('\n')
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/** Hash da árvore (o conteúdo, sem o histórico) do commit que `ref` aponta. */
export function arvoreDe(ref, cwd) {
  // Ref começando com "-" viraria opção do git.
  if (!ref || ref.startsWith('-')) throw new Error(`ref inválida: "${ref}"`)
  try {
    return git(['rev-parse', '--verify', '--quiet', `${ref}^{tree}`], cwd)
  } catch {
    throw new Error(`ref não encontrada: "${ref}"`)
  }
}

/** Compara as árvores de duas refs e devolve as duas, para a mensagem de falha mostrá-las. */
export function compararArvores(refA, refB, cwd) {
  const arvoreA = arvoreDe(refA, cwd)
  const arvoreB = arvoreDe(refB, cwd)
  return { igual: arvoreA === arvoreB, arvoreA, arvoreB }
}

/** Dois commits com a mesma árvore têm exatamente o mesmo conteúdo, mesmo com históricos diferentes. */
export function mesmaArvore(refA, refB, cwd) {
  return compararArvores(refA, refB, cwd).igual
}

/**
 * @param {{ commit: string, arvore: string, branch: string, quando: string, fases: { nome: string, ok: boolean, ms: number }[] }} dados
 */
export function montarRelatorio({ commit, arvore, branch, quando, fases }) {
  // Sem nenhuma fase rodada não há o que afirmar: não é verde.
  return { commit, arvore, branch, quando, fases, ok: fases.length > 0 && fases.every((f) => f.ok) }
}

export function formatarRelatorio(relatorio) {
  const linhas = [
    `Validação: ${relatorio.ok ? 'OK' : 'FALHOU'}`,
    `commit:  ${relatorio.commit}`,
    `árvore:  ${relatorio.arvore}`,
    `branch:  ${relatorio.branch}`,
    `quando:  ${relatorio.quando}`,
    ''
  ]
  const largura = Math.max(0, ...relatorio.fases.map((f) => f.nome.length))
  for (const f of relatorio.fases) linhas.push(`${f.ok ? 'OK    ' : 'FALHA '} ${f.nome.padEnd(largura)}  ${f.ms} ms`)
  return linhas.join('\n') + '\n'
}

/**
 * Erros da página no ponta a ponta. O servidor do roteiro não tem favicon: um 404 por carga é esperado (receita
 * run-gittools); mais de um é recurso faltando, e qualquer outro erro é falha.
 * @param {string[]} erros
 * @returns {{ reais: string[], naoEncontrados: number, ok: boolean }}
 */
export function classificarErros(erros) {
  const naoEncontrado = (e) => /status of 404/.test(e)
  const reais = erros.filter((e) => !naoEncontrado(e))
  const naoEncontrados = erros.length - reais.length
  return { reais, naoEncontrados, ok: reais.length === 0 && naoEncontrados <= 1 }
}

/** Subcomandos do git que alteram o repositório: a navegação do ponta a ponta só lê. */
const ESCRITA = new Set(['add', 'am', 'apply', 'branch', 'checkout', 'cherry-pick', 'clean', 'clone', 'commit', 'fetch', 'init', 'merge', 'pull', 'push', 'rebase', 'reset', 'restore', 'revert', 'rm', 'stash', 'switch', 'tag', 'update-ref'])

/** Subcomando de uma chamada: pula as opções globais do git (`-c k=v`, `-C dir`, `--no-pager`...). */
function subcomando(args) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-c' || args[i] === '-C') i++
    else if (!args[i].startsWith('-')) return args[i]
  }
  return ''
}

/**
 * Processos git que a navegação só de leitura não devia ter: os que terminaram com erro e os que alteram o
 * repositório. `stash list`, `branch --list` e `tag --list` são leitura e passam.
 * @param {{ args: string[], exitCode?: number }[]} log entradas de `app:gitLog`
 */
export function gitInesperado(log) {
  const leitura = (args) => ['stash', 'branch', 'tag'].includes(subcomando(args)) && args.some((a) => a === 'list' || a === '--list' || a === '-l')
  const motivo = (e) => {
    if (e.exitCode !== undefined && e.exitCode !== 0) return `saiu com ${e.exitCode}`
    if (ESCRITA.has(subcomando(e.args)) && !leitura(e.args)) return 'altera o repositório'
    return null
  }
  return log.flatMap((e) => {
    const porque = motivo(e)
    return porque ? [`git ${e.args.join(' ').slice(0, 100)} (${porque})`] : []
  })
}
