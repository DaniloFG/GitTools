// Portão do texto de usuário: o que o usuário final lê (extension/CHANGELOG.md, o corpo do release no GitHub, o README e
// os textos do manifesto da extensão) só pode falar do app GitTools. Nada de pipeline, CI, fila, lote, Claude, IA,
// número de issue ou PR, nome de branch...
//
// O corpo do release deixou de ser gerado de títulos de PR e de commit (que vazavam esse jargão): ele sai da seção do
// CHANGELOG (`notes`) e, antes de qualquer publicação, o workflow roda `check` e `files`, que reprovam se algo
// interno aparecer.
//
// Uso (ESM puro, sem dependência, Node 22):
//   node scripts/changelog-gate.mjs notes <changelog> <versão> <saida.md> [estrito|neutro]
//       grava o corpo do release; `neutro` troca um Unreleased vazio por uma nota fixa (só patch automático)
//   node scripts/changelog-gate.mjs check <changelog> <versão> <notes.md>
//       sai com 1 se houver termo proibido no Unreleased, na seção da versão ou nas notas
//   node scripts/changelog-gate.mjs files <versão> <arquivo...>
//       sai com 1 se README, package.json (displayName, description, keywords), package.nls*.json ou o nome do
//       release (v<versão>) tiverem termo proibido
//
// Princípio das regras: falso positivo é seguro (o autor reescreve a frase); falso negativo, não. Por isso a busca
// é larga, em linha a linha sobre o texto cru (inclusive o que está entre crases).

import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { pathToFileURL } from 'node:url'

const VERSION = /^\d+\.\d+\.\d+$/

// Palavra inteira, sem depender de \b (que não entende letra acentuada): "mais" não casa "IA", "gateway" não casa
// "gate", "developer" não casa "develop". Só letra e número contam como parte da palavra: o `_` é separador de
// propósito, para que `claude_code` ou `session_018B...` não escondam o termo atrás do sublinhado.
const ANTES = '(?<![\\p{L}\\p{N}])'
const DEPOIS = '(?![\\p{L}\\p{N}])'

/** Palavra inteira sem diferença de caixa: "Pipeline", "PIPELINES" e "pipeline" casam. */
const palavra = (rule, fonte) => ({ rule, re: new RegExp(`${ANTES}(?:${fonte})${DEPOIS}`, 'giu') })

/** Palavra inteira só com a caixa escrita: siglas em MAIÚSCULAS, para não pegar "ia" (verbo) ou "ai" de outras palavras. */
const sigla = (rule, fonte) => ({ rule, re: new RegExp(`${ANTES}(?:${fonte})${DEPOIS}`, 'gu') })

/** Padrão livre (sem a moldura de palavra inteira); a caixa é escolhida por quem chama. */
const padrao = (rule, fonte, flags = 'gu') => ({ rule, re: new RegExp(fonte, flags) })

// Tipos de commit convencional (feat, fix...). `style` e `revert` só valem no prefixo do bullet, onde a forma
// "tipo(escopo)!:" não deixa dúvida; no meio da frase só o par tipo(escopo): é buscado.
const TIPOS_PREFIXO = 'feat|fix|chore|docs|refactor|perf|test|build|ci|style|revert'
const TIPOS_ESCOPO = 'feat|fix|chore|docs|refactor|perf|test|build|ci'

// Caracteres invisíveis: espaço de largura zero, marcas de direção, junção, hífen suave, BOM. Escondem uma palavra
// proibida no meio ("pipe​line") ou carregam texto que ninguém vê; por isso a presença deles já reprova.
const INVISIVEIS = '\\u00AD\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u2069\\uFEFF'
const INVISIVEIS_RE = new RegExp(`[${INVISIVEIS}]`, 'gu')

/**
 * Tabela das regras. Cada uma tem `rule` (nome estável, usado nas mensagens e nos testes) e `re` (com flag `g` e `u`).
 * `cru: true` roda a regra antes de os invisíveis serem removidos (só a própria regra `invisivel` precisa disso).
 * Nomes únicos: o teste exige um exemplo ruim para cada um.
 */
export const RULES = [
  // --- Caracteres escondidos -------------------------------------------------------------------------------------
  { ...padrao('invisivel', `[${INVISIVEIS}]`), cru: true },

  // --- Siglas internas -------------------------------------------------------------------------------------------
  // "IA"/"AI"/"QA": só MAIÚSCULAS, porque "ia" é verbo em português e "ai" aparece em outras línguas.
  sigla('sigla-ia', 'IA'),
  sigla('sigla-ai', 'AI'),
  sigla('sigla-qa', 'QA'),
  // "A.I.": a mesma sigla escrita com pontos.
  palavra('sigla-a-i', 'a\\.\\s?i\\.?'),
  // "CI" e "PR(s)" em qualquer caixa: não existem como palavra comum e "pr 12" ou "ci" minúsculo também vazam.
  palavra('ci', 'ci'),
  sigla('sigla-ci-cd', 'CI/CD'),
  palavra('pr', 'prs?'),

  // --- Ferramentas e fluxo de trabalho internos: palavra inteira, sem diferença de caixa -------------------------
  // Quem gera o código e o texto: nome de ferramenta ou de empresa de IA.
  palavra('claude', 'claude'),
  palavra('anthropic', 'anthropic'),
  palavra('copilot', 'copilot'),
  palavra('chatgpt', 'chatgpt'),
  palavra('openai', 'openai'),
  palavra('gemini', 'gemini'),
  palavra('codex', 'codex'),
  palavra('agentic', 'agentic'),
  // Os agentes do projeto (gt-juiz, gt-escritor, gt-leitor, gt-planejador, gt-validador).
  palavra('gt-agente', 'gt-[a-z]+'),
  // Assistente de código: só junto de código ou IA, porque "assistente" sozinho pode ser recurso do produto.
  palavra(
    'assistente-ia',
    '(?:code|c[óo]digo|ai|ia)\\s+(?:assistants?|assistentes?)|' +
      '(?:assistants?|assistentes?)\\s+(?:for\\s+|de\\s+|para\\s+)?(?:code|c[óo]digo|ai|ia)',
  ),
  // Infraestrutura de entrega.
  palavra('pipeline', 'pipelines?'),
  palavra('workflow', 'workflows?'),
  palavra('hook', 'hooks?'),
  palavra('gate', 'gates?'),
  palavra('github-actions', 'github\\s+actions?'),
  palavra('pull-request', 'pull\\s+requests?'),
  palavra('esteira', 'esteiras?'),
  palavra('deploy', 'deploy(?:s|ed|ing|ments?)?'),
  palavra('runner', 'runners?'),
  palavra('dependabot', 'dependabot'),
  // "staging" sozinho é vocabulário do produto (staging por linha, área de staging do git); só o ambiente de testes
  // do projeto ("staging environment", "ambiente de staging") é interno.
  palavra('staging', 'staging\\s+(?:environment|env|server|branch|deploys?)|(?:ambiente|servidor|branch)\\s+de\\s+staging'),
  palavra('branch-protection', 'branch\\s+protections?'),
  palavra('ruleset', 'rulesets?'),
  // Agentes (em inglês e em português); "subagent" não casa "agent" por ser uma palavra só, então tem regra própria.
  palavra('subagente', 'subagents?|subagentes?'),
  palavra('agente', 'agents?|agentes?'),
  palavra('orquestrador', 'orquestrador(?:es)?'),
  palavra('skill', 'skills?'),
  palavra('prompt', 'prompts?'),
  // Organização do trabalho: lote, fila, handoff, backlog, etapa, sessão, fábrica, triagem, escada, juiz.
  palavra('lote', 'lotes?'),
  palavra('fila', 'filas?'),
  palavra('handoff', 'hand-?offs?'),
  palavra('backlog', 'backlog'),
  palavra('etapa', 'etapas?'),
  palavra('sessao', 'sess(?:[ãa]o|[õo]es)|sessions?'),
  palavra('fabrica', 'f[áa]bricas?'),
  palavra('triagem', 'triagem'),
  palavra('escada', 'escada'),
  palavra('juiz', 'juiz'),
  palavra('pedido-dono', 'a\\s+pedido\\s+do\\s+dono|owner[\'’]?s\\s+request'),
  palavra('plano-fase', 'phase\\s+\\d+\\s+of\\s+the\\s+plan|fase\\s+\\d+\\s+do\\s+plano'),
  // Branches de integração do projeto (a `main` fica de fora de propósito: é palavra comum).
  palavra('homolog', 'homolog(?:a[çc][ãa]o)?'),
  palavra('develop', 'develop'),
  // Dúvidas e perguntas do processo de trabalho (do assistente ao dono).
  palavra('duvida', 'd[úu]vidas?'),
  palavra('pergunta', 'perguntas?'),
  palavra('question', 'questions?'),
  // Dúvida em inglês ("doubt"): mesma origem do processo de trabalho.
  palavra('doubt', 'doubts?'),
  // Modelos de linguagem. "modelo" e "model" sozinhos também reprovam: é o jeito de falar do modelo de IA, e o
  // falso positivo ("data model") se resolve descrevendo o efeito sem a palavra.
  palavra('modelo', 'modelos?'),
  palavra('model', 'models?'),
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
  palavra('lint', 'lint(?:ers?|ing)?'),
  palavra('tsconfig', 'tsconfig'),
  palavra('tsc', 'tsc'),
  palavra('runGit', 'runGit'),
  palavra('npm-run', 'npm\\s+run'),
  palavra('teste-unitario', 'unit\\s+tests?|test\\s+coverage|cobertura\\s+de\\s+testes?'),
  palavra('validacao-interna', 'valida[çc][ãa]o\\s+interna'),
  // Validação e verificações internas em inglês: o usuário não vê nada disso.
  palavra('internal-validation', 'internal\\s+validation'),
  palavra('internal-check', 'internal\\s+(?:qa|tests?|checks?)'),
  // "Validação da pipeline/homolog/develop": é a validação do projeto, não de um formulário do app.
  palavra('validacao-pipeline', 'valida[çc][ãa]o\\s+(?:do|da)\\s+(?:pipeline|homolog\\w*|develop)'),
  // Configuração do próprio projeto ou dos agentes.
  palavra(
    'config-interna',
    'configura[çc][ãa]o\\s+interna|internal\\s+config(?:uration)?|internal\\s+settings|configura[çc][ãa]o\\s+de\\s+agentes?',
  ),

  // --- Padrões que denunciam o histórico do repositório ----------------------------------------------------------
  // "#123": número de issue ou de PR.
  padrao('numero-issue-pr', '#\\d+'),
  // "issue 198", "issue #198", "issue number 198": o número escrito por extenso, sem o "#".
  palavra('issue-numero', 'issues?\\s*(?:#|number\\s+)?\\d+'),
  // "GH-198" e "ticket 198": outros jeitos de apontar para um item do rastreador.
  palavra('gh-numero', 'gh-\\d+'),
  palavra('ticket-numero', 'tickets?\\s*(?:#|number\\s+)?\\d+'),
  // "@nome": menção de pessoa (também pega e-mail, o que é bom: contato pessoal não vai para o changelog).
  padrao('mencao', '@[\\p{L}\\d_-]+'),
  // Identificador de sessão do assistente ("session_018B...").
  padrao('session-id', 'session_[0-9A-Za-z]+', 'giu'),
  // Hash de commit: 7 a 64 hexadecimais seguidos, com ao menos um dígito e uma letra a-f (assim "added" e "deface",
  // que são só letras, e números puros, como datas, não casam).
  padrao('hash-commit', `${ANTES}(?=[0-9a-f]*\\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,64}${DEPOIS}`, 'giu'),
  // Caminho de pasta do repositório: o usuário não conhece a estrutura do código.
  padrao('caminho-repo', `${ANTES}(?:src|tests|scripts)/|\\.github/|\\.claude/`, 'giu'),
  // Branch de sessão remota (ccr-...).
  padrao('branch-ccr', `${ANTES}ccr-[\\w-]+`, 'giu'),
  // Nome de branch de trabalho: tipo/assunto.
  padrao('branch-nome', `${ANTES}(?:feature|feat|fix|chore|docs|refactor|revert|hotfix|perf|test|build|ci)/[\\w.-]+`, 'giu'),
  // Commit convencional no começo do bullet ou da linha: "feat: ...", "fix(core)!: ...".
  padrao('commit-prefixo', `^\\s*(?:[-*+]\\s+)?(?:${TIPOS_PREFIXO})(?:\\([^)]*\\))?!?:`, 'giu'),
  // Commit convencional em qualquer ponto: "... fix(core): ...".
  padrao('commit-escopo', `${ANTES}(?:${TIPOS_ESCOPO})\\([\\w-]+\\):`, 'giu'),
  // Pasta e arquivo de configuração do assistente.
  padrao('pasta-claude', '\\.claude(?![\\p{L}\\p{N}])', 'giu'),
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

/** "U+200B" para o caractere invisível aparecer legível na mensagem. */
const codigo = (texto) =>
  [...texto].map((c) => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`).join(' ')

/**
 * Procura termos internos, linha a linha. Devolve `{ line, rule, match }` (line a partir de 1).
 * `rules` é opcional para o teste de mutação mostrar que, sem a tabela, o texto sujo passa.
 */
export function findForbidden(text, rules = RULES) {
  const found = []
  // NFKC: acento decomposto ("fábrica" com a + acento solto) e variantes de largura ("ＰＲ", "ﬁ") viram o texto
  // comum antes da busca. Os invisíveis saem depois, para uma palavra partida por eles ser achada; a regra
  // `invisivel` olha o texto antes dessa limpeza.
  String(text)
    .split(/\r?\n/)
    .forEach((content, index) => {
      const cru = content.normalize('NFKC')
      const limpo = cru.replace(INVISIVEIS_RE, '')
      for (const { rule, re, cru: usaCru } of rules) {
        for (const m of (usaCru ? cru : limpo).matchAll(re)) {
          found.push({ line: index + 1, rule, match: rule === 'invisivel' ? codigo(m[0]) : m[0] })
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
 * Nota fixa do patch automático sem nada novo para o usuário. É o único texto que não vem do CHANGELOG e passa no
 * portão (há teste); só vale para push na branch (`neutro`), nunca para tag nem para disparo manual.
 */
export const NEUTRAL_NOTE = '- Maintenance release: stability improvements.\n'

/**
 * Corpo do release: a seção `## [version]`. O patch que o workflow publica sozinho não ganha seção própria, e então
 * vale o `## [Unreleased]`. Seção ausente, sem bullet ou só com "Nothing yet." lança erro: publicar um release sem
 * texto, ou com texto gerado de PR, é justamente o que o portão impede.
 *
 * Exceção pedida por quem chama (`neutro: true`): o patch automático cujo `## [Unreleased]` existe mas está vazio
 * (não houve mudança visível, só manutenção) leva `NEUTRAL_NOTE`. A seção da versão presente e vazia continua falhando.
 */
export function releaseNotes(changelog, version, { neutro = false } = {}) {
  assertVersion(version)
  const propria = sectionBody(changelog, version)
  const usada = propria === null ? 'Unreleased' : version
  const body = propria === null ? sectionBody(changelog, 'Unreleased') : propria
  if (body === null) {
    throw new Error(`O CHANGELOG não tem a seção ## [${version}] nem ## [Unreleased]: não há texto para o release.`)
  }
  if (realBullets(body).length === 0) {
    if (neutro && propria === null) return NEUTRAL_NOTE
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

/** Todos os textos de string de um JSON, com o caminho do campo (`a.b[0]`). Chaves e ids não entram. */
function jsonStrings(valor, caminho = '') {
  if (typeof valor === 'string') return [{ where: caminho, text: valor }]
  if (Array.isArray(valor)) return valor.flatMap((item, i) => jsonStrings(item, `${caminho}[${i}]`))
  if (valor && typeof valor === 'object') {
    return Object.entries(valor).flatMap(([chave, item]) => jsonStrings(item, caminho ? `${caminho}.${chave}` : chave))
  }
  return []
}

/**
 * Os textos que o usuário lê num arquivo, para a busca. Markdown e demais arquivos de texto valem inteiros;
 * `package.json` só entra pelo que o Marketplace mostra (`displayName`, `description`, `keywords`: o resto são ids
 * de comando e caminhos); `package.nls*.json` entra por todos os valores (são as frases traduzidas).
 */
export function textsOfFile(arquivo, conteudo) {
  const nome = basename(arquivo)
  if (nome === 'package.json') {
    const pacote = JSON.parse(conteudo)
    return ['displayName', 'description', 'keywords'].flatMap((campo) => jsonStrings(pacote[campo], campo))
  }
  if (/\.json$/i.test(nome)) return jsonStrings(JSON.parse(conteudo))
  return [{ where: null, text: conteudo }]
}

/**
 * Procura termos internos nos textos de usuário fora do CHANGELOG: README, manifesto da extensão (package.json e
 * package.nls*.json) e o nome do release (`v<versão>`, o que o GitHub mostra no título). Devolve frases legíveis.
 * `ler` existe para o teste não depender do disco.
 */
export function scanTextFiles(arquivos, { version, ler = (caminho) => readFileSync(caminho, 'utf8') } = {}) {
  const problems = []
  const alvos = arquivos.map((arquivo) => ({ arquivo, textos: textsOfFile(arquivo, ler(arquivo)) }))
  if (version !== undefined) alvos.push({ arquivo: 'nome do release', textos: [{ where: null, text: `v${version}` }] })
  for (const { arquivo, textos } of alvos) {
    for (const { where, text } of textos) {
      for (const { line, rule, match } of findForbidden(text)) {
        const local = where ? `${arquivo} (campo ${where})` : `${arquivo}, linha ${line}`
        problems.push(`${local}: termo interno "${match}" (regra ${rule})`)
      }
    }
  }
  return problems
}

function usage() {
  return (
    'Uso:\n' +
    '  node scripts/changelog-gate.mjs notes <changelog> <versão> <saida.md> [estrito|neutro]\n' +
    '  node scripts/changelog-gate.mjs check <changelog> <versão> <notes.md>\n' +
    '  node scripts/changelog-gate.mjs files <versão> <arquivo...>'
  )
}

function reportar(problems, assunto) {
  process.stderr.write(
    `${assunto} tem ${problems.length} termo(s) interno(s); reescreva só com o que o usuário vê:\n` +
      `${problems.map((p) => `- ${p}`).join('\n')}\n`,
  )
}

/** Roteiro de CI. Devolve o código de saída (0 ou 1). */
function main(argv) {
  const [comando, ...resto] = argv
  try {
    if (comando === 'files') {
      const [version, ...arquivos] = resto
      if (!version || arquivos.length === 0) throw new Error(usage())
      assertVersion(version)
      const problems = scanTextFiles(arquivos, { version })
      if (problems.length > 0) {
        reportar(problems, 'O texto de usuário (README, manifesto e nome do release)')
        return 1
      }
      process.stdout.write('Textos de usuário sem termos internos.\n')
      return 0
    }
    const [changelogPath, version, arquivo, modo = 'estrito'] = resto
    if ((comando !== 'notes' && comando !== 'check') || !changelogPath || !version || !arquivo) throw new Error(usage())
    if (modo !== 'estrito' && modo !== 'neutro') throw new Error(`Modo inválido: "${modo}" (estrito ou neutro).\n${usage()}`)
    assertVersion(version)
    const changelog = readFileSync(changelogPath, 'utf8')
    if (comando === 'notes') {
      writeFileSync(arquivo, releaseNotes(changelog, version, { neutro: modo === 'neutro' }))
      return 0
    }
    const problems = gateProblems(changelog, version, readFileSync(arquivo, 'utf8'))
    if (problems.length > 0) {
      reportar(problems, 'O changelog de usuário')
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
