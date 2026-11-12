// Execução do ponta a ponta: um app só para todos os cenários de cenarios/. Cada cenário é medido (tempo, nós do
// DOM, erros de página e processos git) e conferido contra o próprio orçamento. Roda todos mesmo depois de uma
// falha e grava e2e.json e e2e.junit.xml em SAIDA.
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { newApp } from '../../readme-media/lib.mjs'
import { classificarErros, gitInesperado, SAIDA } from '../lib.mjs'
import { avaliarOrcamento, gerarJunit, montarRelatorioE2e, validarCenario } from './relatorio.mjs'

const INDISPONIVEL = 3
/** O servidor do roteiro não tem favicon: um 404 na execução inteira é esperado (receita run-gittools). */
const TOLERANCIA_404 = 1
/** Tempo máximo de cada espera por condição. */
const TEMPO_CONDICAO = 10_000
const PASTA_CENARIOS = join(dirname(fileURLToPath(import.meta.url)), 'cenarios')

const mensagem = (erro) => String(erro?.message ?? erro)
/** Falha do ambiente (não do app): sem Playwright ou sem Chromium o ponta a ponta não roda, e isso reprova. */
const ausente = (erro) => /playwright não encontrado|Chromium não encontrado/.test(mensagem(erro))

/** Lê os cenários da pasta, por nome, e valida cada um. Um id repetido ou um cenário mal formado é erro. */
export async function carregarCenarios() {
  const arquivos = readdirSync(PASTA_CENARIOS).filter((f) => f.endsWith('.mjs')).sort()
  const cenarios = []
  const erros = []
  const vistos = new Set()
  for (const arquivo of arquivos) {
    const modulo = await import(pathToFileURL(join(PASTA_CENARIOS, arquivo)).href)
    const problemas = validarCenario(modulo.default, vistos)
    if (problemas.length) {
      erros.push(`${arquivo}: ${problemas.join('; ')}`)
      continue
    }
    vistos.add(modulo.default.id)
    cenarios.push(modulo.default)
  }
  return { cenarios, erros }
}

/** `expect` dos cenários: esperas por condição, nunca tempo fixo. */
function criarExpect(page) {
  return {
    async visivel(seletor, minimo) {
      try {
        await page.waitForFunction(([s, m]) => document.querySelectorAll(s).length >= m, [seletor, minimo], { timeout: TEMPO_CONDICAO })
      } catch {
        const achou = await page.locator(seletor).count().catch(() => 0)
        throw new Error(`esperava ao menos ${minimo} de "${seletor}", achou ${achou}`)
      }
    },
    verdadeiro(condicao, msg) {
      if (!condicao) throw new Error(msg)
    }
  }
}

/**
 * Estado que cresce ao longo da execução. Erros e processos do git são contados só uma vez: o que já foi
 * reportado não volta no cenário seguinte.
 */
function criarVigia() {
  let reaisVistos = 0
  let notFoundVistos = 0
  /** Processos já conferidos, por id. Tamanho do log não serve: ele para em 500 entradas e troca entradas no lugar. */
  const conferidos = new Set()
  return {
    /** Erros novos desde a última chamada; o 404 do favicon é tolerado uma vez na execução inteira. */
    erros(errors) {
      const todos = classificarErros(errors)
      const reais = todos.reais.slice(reaisVistos)
      const excedente404 = Math.max(0, todos.naoEncontrados - TOLERANCIA_404) - Math.max(0, notFoundVistos - TOLERANCIA_404)
      reaisVistos = todos.reais.length
      notFoundVistos = todos.naoEncontrados
      return { reais, excedente404 }
    },
    /**
     * Processos ainda não conferidos. Os terminados viram conferidos; os que ainda rodam são avaliados agora (um
     * comando de escrita já conta) e voltam na conferência seguinte, até terminarem.
     */
    async gitNovos(backend) {
      const log = await backend.invoke('app:gitLog', [])
      const novos = log.filter((e) => !conferidos.has(e.id))
      for (const e of novos) if (e.durationMs !== undefined) conferidos.add(e.id)
      return novos
    }
  }
}

/** Confere o que chegou desde a última conferência: erros de página e processos git inesperados. */
async function conferirPagina(app, vigia) {
  const motivos = []
  const { reais, excedente404 } = vigia.erros(app.errors)
  if (reais.length) motivos.push(`erros na página: ${reais.join(' | ')}`)
  if (excedente404) motivos.push(`${excedente404}× 404 além do favicon`)
  let inesperados = []
  try {
    inesperados = gitInesperado(await vigia.gitNovos(app.backend))
  } catch (erro) {
    motivos.push(`não consultou o git: ${mensagem(erro)}`)
  }
  if (inesperados.length) motivos.push(`processo git inesperado: ${inesperados.join(' | ')}`)
  return { erros: reais.length + excedente404, git: inesperados.length, motivos }
}

/** Roda um cenário e devolve o resultado: o tempo é só dos passos, a conferência vem depois. */
async function executarCenario(app, cenario, expect, vigia) {
  const motivos = []
  const inicio = performance.now()
  try {
    await cenario.passos(app, expect)
  } catch (erro) {
    motivos.push(mensagem(erro))
  }
  const ms = Math.round(performance.now() - inicio)
  const nos = await app.page.evaluate(() => document.querySelectorAll('*').length).catch((erro) => {
    motivos.push(`não mediu o DOM: ${mensagem(erro)}`)
    return 0
  })
  const pagina = await conferirPagina(app, vigia)
  motivos.push(...pagina.motivos)
  // `git` no orçamento é o número de processos inesperados (escrita ou erro) nesta conferência, não o total de
  // processos rodados: a navegação de leitura roda muitos e é legítima.
  motivos.push(...avaliarOrcamento({ ms, nos, erros: pagina.erros, git: pagina.git }, cenario.orcamento))
  return { id: cenario.id, tela: cenario.tela, area: cenario.area, ms, nos, ok: motivos.length === 0, motivo: motivos.join(' | ') }
}

async function capturar(page, id) {
  mkdirSync(SAIDA, { recursive: true })
  await page.screenshot({ path: join(SAIDA, `e2e-falha-${id}.png`) }).catch(() => undefined)
}

/**
 * Apaga relatórios e prints de uma execução anterior. Se esta cair antes de gravar (watchdog, erro de carga, Chromium
 * ausente), nenhum relatório velho com ok: true fica no lugar para ser lido como resultado desta.
 */
function limparSaidaAnterior() {
  rmSync(join(SAIDA, 'e2e.json'), { force: true })
  rmSync(join(SAIDA, 'e2e.junit.xml'), { force: true })
  if (!existsSync(SAIDA)) return
  for (const arquivo of readdirSync(SAIDA)) {
    if (/^e2e-falha-.*\.png$/.test(arquivo)) rmSync(join(SAIDA, arquivo), { force: true })
  }
}

function gravarRelatorios(relatorio) {
  mkdirSync(SAIDA, { recursive: true })
  writeFileSync(join(SAIDA, 'e2e.json'), JSON.stringify(relatorio, null, 2) + '\n')
  writeFileSync(join(SAIDA, 'e2e.junit.xml'), gerarJunit(relatorio))
}

/**
 * Roda o ponta a ponta. Devolve o código de saída: 0 passou; 1 falhou; 3 Playwright/Chromium ausentes.
 * Quem chama decide sair (o entry point tem a trava de tempo e precisa de process.exit para soltar o Chromium).
 */
export async function rodarE2e() {
  // Primeira coisa, antes de qualquer await: a limpeza vale mesmo se a execução cair logo depois.
  limparSaidaAnterior()
  let carregados
  try {
    carregados = await carregarCenarios()
  } catch (erro) {
    console.error(`e2e: não carregou os cenários: ${mensagem(erro)}`)
    return 1
  }
  for (const erro of carregados.erros) console.error(`e2e: cenário inválido: ${erro}`)
  if (carregados.erros.length) return 1
  if (carregados.cenarios.length === 0) {
    console.error(`e2e: nenhum cenário em ${PASTA_CENARIOS}`)
    return 1
  }

  let app
  try {
    app = await newApp({ lang: 'en' })
  } catch (erro) {
    if (ausente(erro)) {
      console.error('e2e indisponível: instale Playwright e Chromium (ver .claude/skills/run-gittools)')
      return INDISPONIVEL
    }
    console.error(`e2e: não abriu a interface: ${erro?.stack ?? erro}`)
    return 1
  }

  const quando = new Date().toISOString()
  const vigia = criarVigia()
  const resultados = []
  try {
    const expect = criarExpect(app.page)
    for (const cenario of carregados.cenarios) {
      const r = await executarCenario(app, cenario, expect, vigia)
      resultados.push(r)
      if (r.ok) console.log(`OK    ${r.tela} (${r.nos} nós no DOM, ${r.ms} ms)`)
      else {
        console.log(`FALHA ${r.id}: ${r.motivo}`)
        await capturar(app.page, r.id)
      }
    }
    // Erros e processos que chegaram depois do último cenário também contam, sem esperar tempo fixo.
    const fim = await conferirPagina(app, vigia)
    if (fim.motivos.length) {
      resultados.push({ id: 'apos-o-ultimo-cenario', tela: 'Execução', area: 'geral', ms: 0, nos: 0, ok: false, motivo: fim.motivos.join(' | ') })
      console.log(`FALHA apos-o-ultimo-cenario: ${fim.motivos.join(' | ')}`)
      await capturar(app.page, 'apos-o-ultimo-cenario')
    }
  } finally {
    await app.close().catch(() => undefined)
  }

  const relatorio = montarRelatorioE2e({ quando, cenarios: resultados })
  gravarRelatorios(relatorio)
  if (!relatorio.ok) {
    console.error(`e2e: ${relatorio.falhas} falha(s) de ${relatorio.total}; relatórios em ${SAIDA}`)
    return 1
  }
  console.log(`e2e: ok (${relatorio.total} cenários)`)
  return 0
}
