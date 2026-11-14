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

// Separador entre as palavras de um termo composto: QUALQUER caractere que não seja letra nem dígito (espaço, `_`, `-`,
// `/`, `.`, `·`, `\`, `:`, `=`...). Quem escreve "pipe.line", "work·flow" ou "Co.Authored.By" não escapa de uma regra
// escrita com um espaço só. Não há como listar todos os separadores; por isso a exceção é a letra e o dígito.
const NS = '[^\\p{L}\\p{N}]'

// Número depois de uma palavra de rastreador ("issue 228", "ticket: 42", "issue n.228", "ticket nº 42", "job id 42"):
// separadores, um prefixo opcional (n., nº, no., №, number, id) e os dígitos. `min` é o mínimo de dígitos.
const numero = (min = 1) => `${NS}*(?:(?:n[º°o.]*|№|number|id)${NS}*)?\\d{${min},}`

/**
 * Escreve o termo composto com NS: `\s+` vira NS+, `\s*` e `\s?` viram NS*, e as classes feitas só de separadores
 * (`[-\s]`, `[\s_/-]`, `[\s_/:#-]`...) viram NS (com o `?` ou `*` que vierem depois virando NS*).
 */
const separar = (fonte) =>
  fonte
    .replace(/\[(?:-|\\s|_|\/|:|#)+\]([?*]?)/g, (_, q) => (q ? `${NS}*` : NS))
    .replace(/\\s\+/g, `${NS}+`)
    .replace(/\\s[?*]/g, `${NS}*`)

/** Palavra inteira sem diferença de caixa: "Pipeline", "PIPELINES" e "pipeline" casam. Termos compostos usam SEP. */
const palavra = (rule, fonte) => ({ rule, re: new RegExp(`${ANTES}(?:${separar(fonte)})${DEPOIS}`, 'giu') })

/**
 * Radical: palavra que COMEÇA assim, com qualquer fim ("queue" pega queued e queueing). Mantém a fronteira no começo
 * (não pega "webhook" por "hook"), mas não no fim. O falso positivo ("Hooker") é aceito.
 */
const radical = (rule, fonte) => ({ rule, re: new RegExp(`${ANTES}(?:${separar(fonte)})[\\p{L}\\p{N}]*`, 'giu') })

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

// Letras de outros alfabetos que se parecem com letras latinas (homóglifos). Quem quer esconder "pipeline" troca o
// "p" por um "р" cirílico; antes da busca, estas letras viram a latina que imitam. Mapa curto e escolhido a dedo:
// só o que se confunde de verdade a olho nu.
const HOMOGLIFOS = new Map(
  Object.entries({
    // Cirílico
    А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X', У: 'Y', І: 'I', Ј: 'J', Ѕ: 'S',
    а: 'a', в: 'b', е: 'e', к: 'k', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', ј: 'j', ѕ: 's', ԁ: 'd', һ: 'h', ӏ: 'l', ԛ: 'q', ԝ: 'w', ѵ: 'v',
    // Grego
    Α: 'A', Β: 'B', Ε: 'E', Ζ: 'Z', Η: 'H', Ι: 'I', Κ: 'K', Μ: 'M', Ν: 'N', Ο: 'O', Ρ: 'P', Τ: 'T', Υ: 'Y', Χ: 'X',
    α: 'a', ε: 'e', ι: 'i', κ: 'k', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x',
    // i sem ponto (turco)
    ı: 'i',
  }),
)

// Hifens e travessões tipográficos (U+2010 a U+2015) e o sinal de menos (U+2212): parecem "-" e escapariam das regras
// que usam o hífen como separador ("Co‐Authored‐By", "claude‐code"). Viram o hífen comum antes da busca.
// Marcas combinantes (acentos) que o NFD separa da letra.
const MARCAS_RE = /\p{M}/gu

const HIFENS_RE = /[\u2010-\u2015\u2212]/gu

/** Troca os homóglifos pela letra latina parecida e os hifens tipográficos pelo hífen. */
const desconfundir = (texto) =>
  [...texto.replace(HIFENS_RE, '-')].map((letra) => HOMOGLIFOS.get(letra) ?? letra).join('')

/**
 * Tabela das regras. Cada uma tem `rule` (nome estável, usado nas mensagens e nos testes) e `re` (com flag `g` e `u`).
 * `cru: true` roda a regra antes de os invisíveis serem removidos e dos homóglifos serem trocados (`invisivel` e
 * `script-misto` precisam do texto como foi escrito).
 * Nomes únicos: o teste exige um exemplo ruim para cada um.
 */
export const RULES = [
  // --- Caracteres escondidos -------------------------------------------------------------------------------------
  { ...padrao('invisivel', `[${INVISIVEIS}]`), cru: true },
  // Letra cirílica ou grega dentro de uma palavra com letra latina: o disfarce clássico de um termo proibido
  // ("рipeline" com "р" cirílico). Palavra inteira em outro alfabeto não reprova por esta regra (e os homóglifos dela
  // ainda são convertidos antes da busca das demais).
  {
    ...padrao(
      'script-misto',
      `${ANTES}(?=[\\p{L}\\p{N}]*\\p{Script=Latin})(?=[\\p{L}\\p{N}]*[\\p{Script=Cyrillic}\\p{Script=Greek}])[\\p{L}\\p{N}]+`,
      'giu',
    ),
    cru: true,
  },

  // --- Siglas internas -------------------------------------------------------------------------------------------
  // "IA"/"AI"/"QA": só MAIÚSCULAS, porque "ia" é verbo em português e "ai" aparece em outras línguas.
  sigla('sigla-ia', 'IA'),
  // "ai" em qualquer caixa e palavra inteira ("Ai-powered", "built with ai"); "ia" só maiúsculo, porque é verbo em português.
  palavra('sigla-ai', 'ai'),
  palavra('ia-sufixo', '(?:ai|ia)\\s*(?:powered|assisted|driven|based|generated|written)'),
  // "QA" e "Q.A." em qualquer caixa: "qa" não é palavra comum em inglês nem em português.
  palavra('sigla-qa', 'q\\.?a\\.?s?'),
  // "A.I.": a mesma sigla escrita com pontos.
  palavra('sigla-a-i', 'a\\.\\s?i\\.?'),
  // C.I., P.R., I.A., A.I., Q.A.: letras separadas por ponto (e "C I", "P R" em maiúsculas separadas por espaço).
  palavra('sigla-pontuada', '(?:c\\.\\s?i|p\\.\\s?r|i\\.\\s?a|a\\.\\s?i|q\\.\\s?a)\\.?s?'),
  sigla('sigla-espacada', '(?:C\\s+I|P\\s+R|I\\s+A|A\\s+I|Q\\s+A)s?'),
  // "CI" e "PR(s)" em qualquer caixa: não existem como palavra comum e "pr 12" ou "ci" minúsculo também vazam.
  palavra('ci', 'cis?'),
  sigla('sigla-ci-cd', 'CI/CD'),
  palavra('pr', 'prs?'),
  // "PR42", "PR-42", "pr_42", "P.R. 42": o número colado à sigla tira a palavra inteira, então tem regra própria.
  {
    rule: 'pr-numero',
    re: new RegExp(`${ANTES}(?:pr|p\\.${NS}*r\\.)${numero()}${DEPOIS}`, 'giu'),
  },

  // --- Ferramentas e fluxo de trabalho internos: palavra inteira, sem diferença de caixa -------------------------
  // Quem gera o código e o texto: nome de ferramenta ou de empresa de IA.
  // Nomes de IA: busca como TRECHO, não como palavra inteira, para pegar "claudecode", "claude-code", "gpt4" e
  // "GitHubCopilot". O falso positivo (uma palavra comum que contenha o trecho) é raro e seguro.
  padrao('claude', 'claude', 'giu'),
  padrao('anthropic', 'anthropic', 'giu'),
  padrao('copilot', 'copilot', 'giu'),
  palavra('chatgpt', 'chatgpt'),
  padrao('openai', 'openai', 'giu'),
  padrao('gemini', 'gemini', 'giu'),
  padrao('codex', 'codex', 'giu'),
  palavra('agentic', 'agentic'),
  // Os agentes do projeto (gt-juiz, gt-escritor, gt-leitor, gt-planejador, gt-validador).
  palavra('gt-agente', 'gt-[a-z]+'),
  // Assistente de código: só junto de código ou IA, porque "assistente" sozinho pode ser recurso do produto.
  palavra(
    'assistente-ia',
    '(?:code|c[óo]digo|ai|ia)\\s+(?:assistants?|assistentes?)|' +
      '(?:assistants?|assistentes?)\\s+(?:for\\s+|de\\s+|para\\s+)?(?:code|c[óo]digo|ai|ia)',
  ),
  // IA por extenso e robôs: o jeito de falar de IA sem usar a sigla.
  palavra('ia-extenso', 'intelig[êe]ncia\\s+artificial|artificial\\s+intelligence|machine\\s+learning|aprendizado\\s+de\\s+m[áa]quina'),
  palavra('chatbot', 'chat-?bots?'),
  // "Hide bots" (filtro do Dashboards) passa só pela frase exata em EXCECOES.
  palavra('bot', 'bots?'),
  palavra('robo', 'rob[ôo]s?|robots?'),
  palavra('bot-publicacao', 'bot\\s+de\\s+publica[çc][ãa]o|publishing\\s+bot|release\\s+bot'),
  // Assistente em geral: costuma ser o assistente de código que escreveu o texto. O recurso "git assistant" do produto
  // passa só pelas frases exatas de EXCECOES.
  palavra('assistente', 'assistants?|assistentes?'),
  // Verificação ponta a ponta e seus nomes: é a rotina de teste do projeto.
  palavra('ponta-a-ponta', 'ponta\\s+a\\s+ponta|end[-\\s]to[-\\s]end'),
  palavra('smoke-test', 'smoke[-\\s]?tests?'),
  palavra('headless', 'headless'),
  palavra('cenario-teste', 'cen[áa]rios?\\s+de\\s+testes?|test\\s+scenarios?|scenario\\s+coverage|cobertura\\s+de\\s+cen[áa]rios?'),
  // Verificação obrigatória do repositório.
  palavra('check-obrigatorio', 'checks?\\s+obrigat[óo]rios?|required\\s+checks?|status\\s+checks?'),
  // Pessoas e papéis do repositório: quem mantém, revisa ou aprova.
  palavra('mantenedor', 'mantenedor(?:es|as?)?|maintainers?'),
  palavra('revisor', 'code\\s+reviewers?|revisor(?:es|as?)?|reviewers?'),
  palavra('aprovado-por', 'reviewed\\s+by|approved\\s+by|aprovad[oa]s?\\s+por|autorizad[oa]s?\\s+pel[oa]s?'),
  palavra('revisao-codigo', 'revis[ãa]o\\s+(?:do|de)\\s+c[óo]digo|code\\s+reviews?'),
  // Limites do serviço de IA ou do repositório (a causa das pausas do trabalho).
  palavra('limite-uso', 'limite\\s+de\\s+uso|usage\\s+limits?|rate\\s+limit(?:s|ing)?'),
  // Incremento numerado do trabalho em etapas.
  { rule: 'incremento', re: new RegExp(`${ANTES}(?:incremento|increments?)${numero()}${DEPOIS}`, 'giu') },
  // Pedido de merge de outros hospedeiros: "merge request", "MR 42", "MR-42".
  palavra('merge-request', 'merge\\s+requests?'),
  { rule: 'mr-numero', re: new RegExp(`${ANTES}mr${numero()}${DEPOIS}`, 'giu') },
  // Rastreador de tarefas: chamado, tracker.
  { rule: 'chamado', re: new RegExp(`${ANTES}chamados?${numero()}${DEPOIS}`, 'giu') },
  palavra('rastreador', 'rastreador(?:es)?|(?:issue\\s+)?trackers?'),
  // Mais ferramentas de IA e agentes de código.
  palavra('genai', 'gen[\\s_-]?ai'),
  palavra('xai', 'xai'),
  palavra('ai-generated', 'ai[-_\\s]generated'),
  palavra('mistral', 'mistral'),
  palavra('llama', 'llama'),
  palavra('grok', 'grok'),
  palavra('deepseek', 'deep[\\s_-]?seek'),
  palavra('cursor', 'cursor'),
  palavra('devin', 'devin'),
  palavra('windsurf', 'windsurf'),
  palavra('aider', 'aider'),
  palavra('tabnine', 'tabnine'),
  palavra('codeium', 'codeium'),
  palavra('cody', 'cody'),
  palavra('qwen', 'qwen'),
  palavra('codewhisperer', 'codewhisperer'),
  palavra('amazon-q', 'amazon\\s+q'),
  palavra('replit', 'replit'),
  palavra('lovable', 'lovable'),
  palavra('bolt', 'bolt'),
  // "v0" sozinho é o gerador de interface; "v0.13.0" é versão e não pode reprovar.
  palavra('v0', 'v0(?!\\.?\\d)'),
  // "generated" em qualquer uso: texto gerado, arquivo gerado... é como o trabalho interno descreve o que a máquina fez.
  palavra('generated', 'generated'),
  // Infraestrutura e segurança do ambiente de build: o usuário não vê nada disso.
  palavra('sandbox', 'sandbox(?:es|ed)?'),
  palavra('container', 'containers?'),
  palavra('proxy', 'prox(?:y|ies)'),
  palavra('token', 'tokens?'),
  palavra('secret', 'secrets?'),
  palavra('webhook', 'web[-_]?hooks?'),
  palavra('cron', 'cron(?:jobs?)?'),
  palavra('scheduled-job', 'scheduled\\s+jobs?'),
  palavra('npm-ci', 'npm\\s+ci'),
  palavra('npx', 'npx'),
  palavra('ubuntu-latest', 'ubuntu[-_\\s]?latest'),
  palavra('autosave', 'auto[\\s_-]?save'),
  palavra('automation', 'automation'),
  palavra('qa-extenso', 'quality[\\s_/-]+assurance|garantia[\\s_/-]+de[\\s_/-]+qualidade'),
  // Execução de CI com número curto ("Job 7", "run 4521", "build 1234"). O id longo (8+ dígitos) tem regra própria abaixo.
  { rule: 'execucao-numero', re: new RegExp(`${ANTES}(?:runs?|jobs?|builds?)${numero()}${DEPOIS}`, 'giu') },
  { rule: 'bug-numero', re: new RegExp(`${ANTES}bugs?${numero()}${DEPOIS}`, 'giu') },
  { rule: 'id-numerico', re: new RegExp(`${ANTES}(?:runs?|jobs?|ids?)${numero(8)}${DEPOIS}`, 'giu') },
  palavra('producao', 'production\\s+environment'),
  palavra('publicando-em', 'publish(?:ing|ed)?\\s+(?:to|on)\\s+(?:open\\s+vsx|(?:vs\\s+(?:code\\s+)?)?marketplace)'),
  palavra('notas-agora-vem', 'release\\s+notes\\s+now\\s+come'),
  // Revisão e planejamento do trabalho.
  palavra('review-comments', 'review\\s+comments?'),
  palavra('after-review', 'after\\s+review'),
  palavra('segunda-revisao', 'segunda\\s+revis[ãa]o'),
  palavra('acceptance-criteria', 'acceptance\\s+criteria|crit[ée]rios?\\s+de\\s+aceite'),
  palavra('tech-debt', 'tech(?:nical)?\\s+debt|d[ée]bitos?\\s+t[ée]cnicos?'),
  { rule: 'fase-numero', re: new RegExp(`${ANTES}(?:phase|fase)${numero()}${DEPOIS}`, 'giu') },
  palavra('test-suite', 'test\\s+suites?'),
  palavra('added-tests', 'added\\s+tests?'),
  palavra('fixed-build', 'fixed\\s+the\\s+build'),
  palavra('refactor-interno', 'internal\\s+refactor(?:ing)?|refatora[çc][ãa]o\\s+interna'),
  palavra('context-window', 'context\\s+windows?'),
  palavra('conversa', 'as\\s+discussed|conforme\\s+a\\s+conversa'),
  // Rotinas e cerimônias do projeto: job noturno, Renovate, sprint, épico, kanban, re-run, sign-off.
  palavra('nightly', 'nightly[\\s_/-]+(?:jobs?|builds?)'),
  palavra('renovate', 'renovate(?:bot)?'),
  { rule: 'sprint', re: new RegExp(`${ANTES}sprints?${numero()}${DEPOIS}`, 'giu') },
  palavra('epico', '[ée]picos?|epics?'),
  palavra('kanban', 'kanban'),
  palavra('re-run', 're[-_\\s]?runs?'),
  palavra('sign-off', 'sign[-_\\s]?offs?'),
  // Dependabot: título de PR de atualização de dependência.
  padrao('bump', 'Bump\\s+\\S+\\s+from\\s+\\S+\\s+to\\s+\\S+', 'giu'),
  // Infraestrutura de entrega.
  radical('pipeline', 'pipe\\s*lin'),
  radical('workflow', 'work\\s*flow'),
  radical('hook', 'hook'),
  // "gateway" (endereço de rede) é palavra comum e não é a porta do processo.
  radical('gate', 'gate(?!ways?(?![\\p{L}\\p{N}]))|gating'),
  palavra('github-actions', 'github\\s+actions?'),
  palavra('pull-request', 'pull\\s+requests?'),
  palavra('esteira', 'esteiras?'),
  palavra('deploy', 'deploy(?:s|ed|ing|ments?)?'),
  palavra('runner', 'runners?'),
  palavra('dependabot', 'dependabot'),
  // "staging" é também vocabulário do produto (staging por linha); os usos do produto passam por frase exata em EXCECOES.
  palavra('staging', 'staging'),
  palavra('branch-protection', 'branch\\s+protections?'),
  palavra('ruleset', 'rulesets?'),
  // Agentes (em inglês e em português); "subagent" não casa "agent" por ser uma palavra só, então tem regra própria.
  palavra('subagente', 'subagents?|subagentes?'),
  palavra('agente', 'agents?|agentes?'),
  // "orquestr" e "orchestr" como trecho: Orchestrator, Orquestração, orquestrador(es).
  padrao('orquestrador', 'orquestr|orchestr', 'giu'),
  palavra('planejador', 'planejad(?:or|ora)(?:es|as)?|planners?'),
  radical('skill', 'skill'),
  palavra('prompt', 'prompts?'),
  // Organização do trabalho: lote, fila, handoff, backlog, etapa, sessão, fábrica, triagem, escada, juiz.
  palavra('lote', 'lotes?'),
  // "lote" e "fila" em inglês; "batch actions" (recurso do produto) passa só pela frase exata em EXCECOES.
  radical('batch', 'batch'),
  radical('queue', 'queue'),
  palavra('lot', 'lots?'),
  palavra('fila', 'filas?'),
  palavra('handoff', 'hand[-\\s]?offs?'),
  palavra('backlog', 'backlogs?'),
  palavra('etapa', 'etapas?'),
  radical('sessao', 'sess(?:i|[ãa]o|[õo]es)'),
  palavra('fabrica', 'f[áa]bricas?'),
  palavra('triagem', 'triag(?:e|ens|em)'),
  palavra('escada', 'escadas?'),
  palavra('juiz', 'ju[ií]z(?:es)?'),
  // Quem manda no projeto: qualquer menção ao dono ("the owner", "o dono") é conversa interna.
  palavra('dono', 'donos?|donas?'),
  palavra('owner', 'owners?'),
  palavra('pedido-dono', 'a\\s+pedido\\s+do\\s+dono|owner[\'’]?s\\s+request'),
  palavra('plano-fase', '(?:phase|stage|step|fase|etapa)\\s+\\d+\\s+(?:of|do|da)\\s+(?:the\\s+)?(?:plan|plano)'),
  // Branches de integração do projeto (a `main` fica de fora de propósito: é palavra comum).
  palavra('homolog', 'homolog(?:a[çc](?:[ãa]o|[õo]es))?s?'),
  palavra('develop', 'develop'),
  // Dúvidas e perguntas do processo de trabalho (do assistente ao dono).
  palavra('duvida', 'd[úu]vidas?'),
  palavra('pergunta', 'perguntas?'),
  radical('question', 'question|quest(?:[ãa]o|[õo]es)'),
  // Dúvida em inglês ("doubt"): mesma origem do processo de trabalho.
  palavra('doubt', 'doubts?'),
  // Modelos de linguagem. "modelo" e "model" sozinhos também reprovam: é o jeito de falar do modelo de IA, e o
  // falso positivo ("data model") se resolve descrevendo o efeito sem a palavra.
  palavra('modelo', 'modelos?'),
  palavra('model', 'models?'),
  palavra('llm', 'llms?|language\\s+models?'),
  padrao('gpt', 'gpt', 'giu'),
  palavra('sonnet', 'sonnet'),
  palavra('opus', 'opus'),
  palavra('haiku', 'haiku'),
  // Ferramentas de teste e de verificação.
  palavra('e2e', 'e2e'),
  palavra('vitest', 'vitest'),
  palavra('typecheck', 'type[-\\s]?check(?:s|ing)?'),
  palavra('playwright', 'playwright'),
  palavra('lint', 'lint[\\p{L}\\p{N}]*'),
  palavra('tsconfig', 'tsconfigs?'),
  palavra('tsc', 'tsc'),
  palavra('runGit', 'runGit'),
  palavra('npm-run', 'npm\\s+run'),
  palavra(
    'teste-unitario',
    '(?:unit|integration)\\s+tests?|testes?\\s+unit[áa]rios?|testes?\\s+de\\s+integra[çc][ãa]o|' +
      'test\\s+coverage|cobertura\\s+de\\s+testes?',
  ),
  palavra(
    'integracao-continua',
    'continuous\\s+(?:integration|delivery|deployment)|(?:integra[çc][ãa]o|entrega)\\s+cont[íi]nua',
  ),
  palavra('validacao-interna', 'valida[çc][ãa]o\\s+interna'),
  // Validação e verificações internas em inglês: o usuário não vê nada disso.
  palavra('internal-validation', 'internal\\s+validation'),
  // "internal config", "internal settings" e variações (configuration, setting...): radical depois do segundo termo.
  radical('internal-config', 'internal\\s*(?:config|setting)'),
  radical('configuracao-interna', 'configura[çc](?:[ãa]o|[õo]es)\\s*internas?'),
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
  padrao('numero-issue-pr', '#\\s*\\d+'),
  // "!42": número de merge request (GitLab) com exclamação.
  padrao('bang-numero', '!\\d+'),
  // "issue 198", "issue #198", "issue number 198": o número escrito por extenso, sem o "#".
  { rule: 'issue-numero', re: new RegExp(`${ANTES}issues?${numero()}${DEPOIS}`, 'giu') },
  // Issue filha: palavra do rastreador do projeto.
  palavra('sub-issue', 'sub[-\\s]?issues?'),
  // "Refs 228", "Closes GH 228", "Fixes #228": o rodapé de commit que aponta para a issue.
  {
    rule: 'refs-numero',
    re: new RegExp(`${ANTES}(?:refs?|closes?|closed|fix(?:es|ed)?|resolves?|resolved)${NS}*(?:gh${NS}*)?${numero()}${DEPOIS}`, 'giu'),
  },
  // "GH-198" e "ticket 198": outros jeitos de apontar para um item do rastreador.
  { rule: 'gh-numero', re: new RegExp(`${ANTES}gh${numero()}${DEPOIS}`, 'giu') },
  { rule: 'ticket-numero', re: new RegExp(`${ANTES}tickets?${numero()}${DEPOIS}`, 'giu') },
  // "@nome": menção de pessoa (também pega e-mail, o que é bom: contato pessoal não vai para o changelog).
  padrao('mencao', '@[\\p{L}\\d_-]+'),
  // Identificador de sessão do assistente ("session_018B...").
  padrao('session-id', 'session_[0-9A-Za-z]+', 'giu'),
  // Hash de commit: 7 a 64 hexadecimais seguidos, com ao menos um dígito e uma letra a-f (assim "added" e "deface",
  // que são só letras, e números puros, como datas, não casam).
  padrao('hash-commit', `${ANTES}(?=[0-9a-f]*\\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,64}${DEPOIS}`, 'giu'),
  // Arquivo de workflow ou de configuração YAML do projeto (validacao.yml, qa.yml...).
  padrao('arquivo-yaml', '[\\w.-]+\\.ya?ml(?![\\p{L}\\p{N}])', 'giu'),
  // "pull/228" sem o domínio, e o arquivo de donos do repositório.
  padrao('pull-numero', `${ANTES}pull[/\\\\]\\d+`, 'giu'),
  palavra('codeowners', 'code[-_]?owners?'),
  // Caminho de pasta do repositório: o usuário não conhece a estrutura do código.
  // Barra comum ou invertida (caminho do Windows).
  padrao('caminho-repo', `${ANTES}(?:src|tests|scripts)[/\\\\]|\\.github[/\\\\]|\\.claude[/\\\\]`, 'giu'),
  // Branch de sessão remota (ccr-...).
  padrao('branch-ccr', `${ANTES}ccr-[\\w-]+`, 'giu'),
  // Nome de branch de trabalho: tipo/assunto.
  padrao('branch-nome', `${ANTES}(?:feature|feat|fix|chore|docs|refactor|revert|hotfix|bugfix|release|wip|perf|test|build|ci)[/\\\\][\\w.-]+`, 'giu'),
  // Referência remota do git (origin/main, origin/develop).
  padrao('origin-ref', `${ANTES}origin/\\S`, 'giu'),
  // Commit convencional no começo do bullet ou da linha: "feat: ...", "fix(core)!: ...".
  // Vale depois de bullet, de lista numerada ("1. fix: z"), de citação ("> fix: z") e de marcação (**, `), com ou sem
  // espaço antes do escopo ("Fix (core): x").
  padrao('commit-prefixo', `^\\s*(?:[-*+>_\`"']+\\s*|\\d+[.)]\\s+)*(?:${TIPOS_PREFIXO})\\s*(?:\\([^)]*\\))?!?\\s*:`, 'giu'),
  // Commit convencional em qualquer ponto: "... fix(core): ...".
  padrao('commit-escopo', `${ANTES}(?:${TIPOS_ESCOPO})\\s*\\([\\w-]+\\)\\s*:`, 'giu'),
  // Pasta e arquivo de configuração do assistente.
  padrao('pasta-claude', '\\.claude(?![\\p{L}\\p{N}])', 'giu'),
  padrao('claude-md', 'CLAUDE\\.md', 'giu'),
  // Link do GitHub para PR, issue, execução de workflow ou comparação: é o que o release gerado inclui.
  padrao('link-github', 'github\\.com/\\S*/(?:pull|issues|actions|compare|commit)', 'giu'),
  // O que o release gerado pelo GitHub escreve sozinho (títulos de PR e autores).
  padrao('notas-geradas', "What'?s Changed|Full Changelog|New Contributors", 'giu'),
  // Plano numerado de trabalho ("Plano 4").
  padrao('plano-numerado', `${ANTES}Plan(?:o)?${numero()}${DEPOIS}`, 'giu'),
  // Rótulos do rastreador do projeto: status:, prioridade:, area:, precisa-refinamento, wip:, "label status".
  padrao('rotulo-status', `${ANTES}(?:status|prioridade|priority|area|[áa]rea):[a-z][a-z-]*`, 'giu'),
  padrao('rotulo-palavra', `${ANTES}${separar('(?:labels?|r[óo]tulos?)\\s+(?:status|prioridade|priority|area|[áa]rea)')}`, 'giu'),
  padrao('precisa-refinamento', `${ANTES}${separar('(?:precisa[-\\s]refinamento|needs[-\\s]refinement)')}`, 'giu'),
  padrao('wip', `${ANTES}wip\\s*:`, 'giu'),
  // Rodapés de atribuição de commit.
  padrao('co-authored-by', separar('Co[-\\s]?Authored[-\\s]?By'), 'giu'),
  padrao('generated-with', separar('Generated\\s+with'), 'giu'),
]

/**
 * Frases EXATAS do produto que contêm uma palavra barrada. Cada uma é apagada do texto (vira "·") antes da busca,
 * e só ela: "git assistant bubble" passa, "Thanks to the git assistant" e "the git assistant wrote the code" não.
 * Entra aqui só o que o README, a interface ou uma seção JÁ PUBLICADA do CHANGELOG (que não se reescreve) exigem;
 * texto novo se reescreve em vez de entrar na tabela. Sem diferença de caixa.
 */
export const EXCECOES = [
  // README: o recurso "git assistant" do editor (bolha no fim da linha com quem, quando e o quê).
  { frase: 'Edit files with a git assistant', onde: 'README, lista de recursos' },
  { frase: 'with a git assistant at the end of the line', onde: 'README, título da seção do editor' },
  { frase: 'The **inline git assistant** shows a bubble', onde: 'README, parágrafo do editor' },
  { frase: 'Git assistant in the editor', onde: 'README, fim do parágrafo do editor' },
  { frase: 'The inline git assistant following the cursor while editing a file', onde: 'README, texto alternativo do GIF' },
  { frase: 'media/readme/inline-assistant.gif', onde: 'README, arquivo do GIF (o nome do arquivo de mídia não muda)' },
  { frase: 'git assistant bubble', onde: 'README, texto alternativo da imagem do editor' },
  // CHANGELOG 0.7.0, seção já publicada.
  { frase: 'File editor with an inline git assistant', onde: 'CHANGELOG [0.7.0], seção já publicada' },
  // Filtro do Dashboards ("Hide bots") na interface, no README e no catálogo em inglês.
  // Telas de conflitos: ações em lote do rodapé (CHANGELOG [Unreleased]).
  { frase: 'batch actions', onde: 'CHANGELOG [Unreleased], "applies batch actions from a footer"' },
  { frase: 'hide bots', onde: 'README e interface (filtro do Dashboards)' },
  { frase: 'ocultar bots', onde: 'interface em português (filtro do Dashboards)' },
  // Staging por linha: recurso central do produto (README e descrição do manifesto, nos dois idiomas).
  { frase: 'Line-by-line staging', onde: 'README, lista de recursos' },
  { frase: 'line-level staging', onde: 'package.nls.json, descrição da extensão' },
  { frase: 'staging por linha', onde: 'package.nls.pt-br.json, descrição da extensão' },
]

const EXCECOES_RE = EXCECOES.map(({ frase }) => new RegExp(frase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu'))

/** Apaga as frases de EXCECOES (troca por "·", que não é letra) para a busca não as ver. */
const semExcecoes = (texto) => EXCECOES_RE.reduce((t, re) => t.replace(re, (m) => '·'.repeat(m.length)), texto)

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
  // comum antes da busca. Os invisíveis saem e os homóglifos viram latim depois, para uma palavra disfarçada ser
  // achada; as regras `invisivel` e `script-misto` olham o texto antes dessa limpeza.
  // Cada linha é buscada duas vezes: com os acentos (as regras escritas com acento, como "fábrica") e sem eles
  // (NFD sem as marcas combinantes: "Cláude" e "Clàude" viram "Claude"). Um achado que aparece nas duas versões
  // é contado uma vez, pela posição.
  String(text)
    .split(/\r?\n/)
    .forEach((content, index) => {
      const cru = content.normalize('NFKC')
      const limpo = semExcecoes(desconfundir(cru.replace(INVISIVEIS_RE, '')))
      const semAcento = semExcecoes(desconfundir(cru.normalize('NFD').replace(MARCAS_RE, '').replace(INVISIVEIS_RE, '')))
      for (const { rule, re, cru: usaCru } of rules) {
        const vistos = new Set()
        const versoes = usaCru ? [cru] : [limpo, semAcento]
        for (const versao of versoes) {
          for (const m of versao.matchAll(re)) {
            const chave = `${m.index}:${m[0].length}`
            if (vistos.has(chave)) continue
            vistos.add(chave)
            found.push({ line: index + 1, rule, match: rule === 'invisivel' ? codigo(m[0]) : m[0] })
          }
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
