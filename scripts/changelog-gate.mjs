// Portão do changelog de usuário: o que o usuário final lê (extension/CHANGELOG.md e o corpo do release no GitHub)
// só pode falar do app GitTools. Nada de pipeline, CI, fila, lote, Claude, IA, número de issue ou PR, nome de branch...
//
// O corpo do release deixou de ser gerado de títulos de PR e de commit (que vazavam esse jargão): ele sai da seção do
// CHANGELOG (`notes`) e, antes de qualquer publicação, o workflow roda `check`, que reprova se algo interno aparecer.
//
// Uso (ESM puro, sem dependência, Node 22):
//   node scripts/changelog-gate.mjs notes <changelog> <versão> <saida.md>   grava o corpo do release
//   node scripts/changelog-gate.mjs check <changelog> <versão> <notes.md>   sai com 1 se houver termo proibido
//
// Princípio das regras: falso positivo é seguro (o autor reescreve a frase); falso negativo, não. Por isso a busca
// é larga, em linha a linha sobre o texto cru (inclusive o que está entre crases).

import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const VERSION = /^\d+\.\d+\.\d+$/

// Palavra inteira, sem depender de \b (que não entende letra acentuada): "mais" não casa "IA", "gateway" não casa
// "gate", "developer" não casa "develop". `\p{L}`, `\p{N}` e `_` contam como parte da palavra.
const ANTES = '(?<![\\p{L}\\p{N}_])'
const DEPOIS = '(?![\\p{L}\\p{N}_])'

/** Palavra inteira sem diferença de caixa: "Pipeline", "PIPELINES" e "pipeline" casam. */
const palavra = (rule, fonte) => ({ rule, re: new RegExp(`${ANTES}(?:${fonte})${DEPOIS}`, 'giu') })

/** Palavra inteira só com a caixa escrita: siglas em MAIÚSCULAS, para não pegar "mais", "ai" ou "ci" de outras palavras. */
const sigla = (rule, fonte) => ({ rule, re: new RegExp(`${ANTES}(?:${fonte})${DEPOIS}`, 'gu') })

/** Padrão livre (sem a moldura de palavra inteira); a caixa é escolhida por quem chama. */
const padrao = (rule, fonte, flags = 'gu') => ({ rule, re: new RegExp(fonte, flags) })

// Tipos de commit convencional (feat, fix...). `style` e `revert` só valem no prefixo do bullet, onde a forma
// "tipo(escopo)!:" não deixa dúvida; no meio da frase só o par tipo(escopo): é buscado.
const TIPOS_PREFIXO = 'feat|fix|chore|docs|refactor|perf|test|build|ci|style|revert'
const TIPOS_ESCOPO = 'feat|fix|chore|docs|refactor|perf|test|build|ci'

/**
 * Tabela das regras. Cada uma tem `rule` (nome estável, usado nas mensagens e nos testes) e `re` (com flag `g` e `u`).
 * Nomes únicos: o teste exige um exemplo ruim para cada um.
 */
export const RULES = [
  // --- Siglas internas: só MAIÚSCULAS e palavra inteira ---------------------------------------------------------
  // "IA"/"AI": falar de IA ou de assistente no changelog entrega como o projeto é feito, e não é assunto do usuário.
  sigla('sigla-ia', 'IA'),
  sigla('sigla-ai', 'AI'),
  // "QA" e "CI": validação e integração contínua internas.
  sigla('sigla-qa', 'QA'),
  sigla('sigla-ci', 'CI'),
  sigla('sigla-ci-cd', 'CI/CD'),
  // "PR"/"PRs": pull request é vocabulário de quem desenvolve.
  sigla('sigla-pr', 'PRs?'),

  // --- Ferramentas e fluxo de trabalho internos: palavra inteira, sem diferença de caixa -------------------------
  // Quem gera o código e o texto: nome de ferramenta ou de empresa de IA.
  palavra('claude', 'claude'),
  palavra('anthropic', 'anthropic'),
  palavra('copilot', 'copilot'),
  // Infraestrutura de entrega.
  palavra('pipeline', 'pipelines?'),
  palavra('workflow', 'workflows?'),
  palavra('hook', 'hooks?'),
  palavra('gate', 'gates?'),
  palavra('github-actions', 'github\\s+actions?'),
  palavra('pull-request', 'pull\\s+requests?'),
  // Agentes (em inglês e em português); "subagent" não casa "agent" por ser uma palavra só, então tem regra própria.
  palavra('subagente', 'subagents?|subagentes?'),
  palavra('agente', 'agents?|agentes?'),
  palavra('orquestrador', 'orquestrador(?:es)?'),
  palavra('skill', 'skills?'),
  // Organização do trabalho: lote, fila, handoff, backlog, etapa, sessão, fábrica.
  palavra('lote', 'lotes?'),
  palavra('fila', 'filas?'),
  palavra('handoff', 'hand-?offs?'),
  palavra('backlog', 'backlog'),
  palavra('etapa', 'etapas?'),
  palavra('sessao', 'sess(?:[ãa]o|[õo]es)|sessions?'),
  palavra('fabrica', 'f[áa]bricas?'),
  // Branches de integração do projeto (a `main` fica de fora de propósito: é palavra comum).
  palavra('homolog', 'homolog(?:a[çc][ãa]o)?'),
  palavra('develop', 'develop'),
  // Dúvidas e perguntas do processo de trabalho (do assistente ao dono).
  palavra('duvida', 'd[úu]vidas?'),
  palavra('pergunta', 'perguntas?'),
  palavra('question', 'questions?'),
  // Dúvida em inglês ("doubt"): mesma origem do processo de trabalho.
  palavra('doubt', 'doubts?'),
  // Modelos de linguagem.
  palavra('modelo-de-ia', 'modelos?\\s+de\\s+ia'),
  // "the model", "an AI model", "LLM model": o modelo que escreveu ou revisou; sozinho "model" não entra (é palavra comum).
  palavra('modelo-en', '(?:the|an?|ai|llm)\\s+models?'),
  palavra('llm', 'llms?|language\\s+models?'),
  palavra('gpt', 'gpt'),
  palavra('sonnet', 'sonnet'),
  palavra('opus', 'opus'),
  palavra('haiku', 'haiku'),
  // Ferramentas de teste e de verificação.
  palavra('e2e', 'e2e'),
  palavra('vitest', 'vitest'),
  palavra('typecheck', 'typecheck'),
  palavra('playwright', 'playwright'),
  palavra('validacao-interna', 'valida[çc][ãa]o\\s+interna'),
  // Validação e verificações internas em inglês: o usuário não vê nada disso.
  palavra('internal-validation', 'internal\\s+validation'),
  palavra('internal-check', 'internal\\s+(?:qa|tests?|checks?)'),

  // --- Padrões que denunciam o histórico do repositório ----------------------------------------------------------
  // "#123": número de issue ou de PR.
  padrao('numero-issue-pr', '#\\d+'),
  // "issue 198", "issue #198", "issue number 198": o número escrito por extenso, sem o "#".
  palavra('issue-numero', 'issues?\\s*(?:#|number\\s+)?\\d+'),
  // "@nome": menção de pessoa (também pega e-mail, o que é bom: contato pessoal não vai para o changelog).
  padrao('mencao', '@[\\p{L}\\d_-]+'),
  // Branch de sessão remota (ccr-...).
  padrao('branch-ccr', `${ANTES}ccr-[\\w-]+`, 'giu'),
  // Nome de branch de trabalho: tipo/assunto.
  padrao('branch-nome', `${ANTES}(?:feature|feat|fix|chore|docs|refactor|revert|hotfix|perf|test|build|ci)/[\\w.-]+`, 'giu'),
  // Commit convencional no começo do bullet ou da linha: "feat: ...", "fix(core)!: ...".
  padrao('commit-prefixo', `^\\s*(?:[-*+]\\s+)?(?:${TIPOS_PREFIXO})(?:\\([^)]*\\))?!?:`, 'giu'),
  // Commit convencional em qualquer ponto: "... fix(core): ...".
  padrao('commit-escopo', `${ANTES}(?:${TIPOS_ESCOPO})\\([\\w-]+\\):`, 'giu'),
  // Pasta e arquivo de configuração do assistente.
  padrao('pasta-claude', '\\.claude(?![\\p{L}\\p{N}_])', 'giu'),
  padrao('claude-md', 'CLAUDE\\.md', 'giu'),
  // Link do GitHub para PR, issue, execução de workflow ou comparação: é o que o release gerado inclui.
  padrao('link-github', 'github\\.com/\\S*/(?:pull|issues|actions|compare|commit)', 'giu'),
  // O que o release gerado pelo GitHub escreve sozinho (títulos de PR e autores).
  padrao('notas-geradas', "What'?s Changed|Full Changelog|New Contributors", 'giu'),
  // Plano numerado de trabalho ("Plano 4").
  padrao('plano-numerado', `${ANTES}Plano\\s+\\d+`, 'giu'),
  // Rodapés de atribuição de commit.
  padrao('co-authored-by', 'Co-Authored-By', 'giu'),
  padrao('generated-with', 'Generated\\s+with', 'giu'),
]

/**
 * Procura termos internos, linha a linha. Devolve `{ line, rule, match }` (line a partir de 1).
 * `rules` é opcional para o teste de mutação mostrar que, sem a tabela, o texto sujo passa.
 */
export function findForbidden(text, rules = RULES) {
  const found = []
  // NFC: "fábrica" escrito com acento decomposto (a + acento) também precisa casar.
  const lines = String(text).normalize('NFC').split(/\r?\n/)
  lines.forEach((content, index) => {
    for (const { rule, re } of rules) {
      for (const m of content.matchAll(re)) {
        found.push({ line: index + 1, rule, match: m[0] })
      }
    }
  })
  return found
}

/** Cabeçalho `## [titulo]` (com ou sem data depois) de uma seção; devolve o título ou null. */
function sectionTitle(line) {
  const m = /^## \[([^\]]+)\]/.exec(line)
  return m ? m[1] : null
}

/**
 * Seção `## [titulo]`: o texto e a linha (a partir de 1) em que ele começa no arquivo, ou null se não existe.
 * Vai até o próximo `## `; `### Added` não encerra a seção.
 */
function sectionOf(changelog, titulo) {
  const lines = String(changelog).split(/\r?\n/)
  const start = lines.findIndex((line) => sectionTitle(line) === titulo)
  if (start === -1) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) {
      end = i
      break
    }
  }
  return { body: lines.slice(start + 1, end).join('\n'), firstLine: start + 2 }
}

/** Texto da seção `## [titulo]` (sem o cabeçalho), ou null se ela não existe. */
export function sectionBody(changelog, titulo) {
  const section = sectionOf(changelog, titulo)
  return section ? section.body : null
}

/** Os bullets da seção que dizem algo: "- Nothing yet." é o marcador de vazio do Keep a Changelog. */
function realBullets(body) {
  return body
    .split(/\r?\n/)
    .map((line) => /^\s*[-*+]\s+(.*\S)\s*$/.exec(line)?.[1])
    .filter((bullet) => bullet !== undefined && !/^nothing yet\.?$/i.test(bullet))
}

function assertVersion(version) {
  if (typeof version !== 'string' || !VERSION.test(version)) {
    throw new Error(`Versão inválida: "${version}" (esperado x.y.z, ex.: 0.13.0).`)
  }
}

/**
 * Corpo do release: a seção `## [version]`. O patch que o workflow publica sozinho não ganha seção própria, e então
 * vale o `## [Unreleased]`. Seção ausente, sem bullet ou só com "Nothing yet." lança erro: publicar um release sem
 * texto, ou com texto gerado de PR, é justamente o que o portão impede.
 */
export function releaseNotes(changelog, version) {
  assertVersion(version)
  const propria = sectionBody(changelog, version)
  const usada = propria === null ? 'Unreleased' : version
  const body = propria === null ? sectionBody(changelog, 'Unreleased') : propria
  if (body === null) {
    throw new Error(`O CHANGELOG não tem a seção ## [${version}] nem ## [Unreleased]: não há texto para o release.`)
  }
  if (realBullets(body).length === 0) {
    throw new Error(
      `A seção ## [${usada}] do CHANGELOG não tem nenhuma mudança (sem bullet, ou só "Nothing yet."): ` +
        `escreva o que o usuário ganha antes de publicar.`,
    )
  }
  return `${body.trim()}\n`
}

/**
 * Problemas legíveis, vazia = ok. Confere `[Unreleased]`, a seção da versão (se existir) e o corpo do release.
 * As seções antigas já publicadas não entram aqui: o teste do arquivo inteiro as cobre.
 */
export function gateProblems(changelog, version, releaseBody) {
  const problems = []
  const dizer = (origem, deslocamento, achados) => {
    for (const { line, rule, match } of achados) {
      problems.push(`${origem}, linha ${line + deslocamento}: termo interno "${match}" (regra ${rule})`)
    }
  }
  const secoes = ['Unreleased']
  if (version !== 'Unreleased') secoes.push(version)
  for (const titulo of secoes) {
    const secao = sectionOf(changelog, titulo)
    // Linha relativa à seção vira linha do arquivo: firstLine é a primeira linha do corpo.
    if (secao) dizer(`CHANGELOG [${titulo}]`, secao.firstLine - 1, findForbidden(secao.body))
  }
  dizer('Corpo do release', 0, findForbidden(releaseBody))
  return problems
}

function usage() {
  return (
    'Uso:\n' +
    '  node scripts/changelog-gate.mjs notes <changelog> <versão> <saida.md>\n' +
    '  node scripts/changelog-gate.mjs check <changelog> <versão> <notes.md>'
  )
}

/** Roteiro de CI. Devolve o código de saída (0 ou 1). */
function main(argv) {
  const [comando, changelogPath, version, arquivo] = argv
  if ((comando !== 'notes' && comando !== 'check') || !changelogPath || !version || !arquivo) {
    process.stderr.write(`${usage()}\n`)
    return 1
  }
  try {
    assertVersion(version)
    const changelog = readFileSync(changelogPath, 'utf8')
    if (comando === 'notes') {
      writeFileSync(arquivo, releaseNotes(changelog, version))
      return 0
    }
    const problems = gateProblems(changelog, version, readFileSync(arquivo, 'utf8'))
    if (problems.length > 0) {
      process.stderr.write(
        `O changelog de usuário tem ${problems.length} termo(s) interno(s); reescreva só com o que o usuário vê:\n` +
          `${problems.map((p) => `- ${p}`).join('\n')}\n`,
      )
      return 1
    }
    process.stdout.write('Changelog de usuário sem termos internos.\n')
    return 0
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}

// Só roda o roteiro quando o arquivo é executado direto, não ao ser importado (como em scripts/extension-version.mjs).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2))
}
