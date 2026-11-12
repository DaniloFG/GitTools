// QA não funcional na interface de verdade (Chromium + Backend real, como o e2e.mjs), uma fase por argumento:
//   node scripts/validacao/qa.mjs <responsivo|desempenho|teclado>
// Os tetos e as dimensões vêm de orcamentos.json (única fonte). Cada checagem imprime uma linha OK/FALHA e a fase
// grava validacao-out/qa-<fase>.json (medido, tetos, motivos). Falha de verdade no app é um achado: a fase reprova,
// ela nunca conserta nem afrouxa o teto.
// Códigos de saída: 0 passou; 1 falhou; 2 argumento inválido; 3 Playwright/Chromium ausentes.
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { launch } from '../readme-media/harness.mjs'
import { newApp } from '../readme-media/lib.mjs'
import { applyScenario, createStressRepo } from '../perf/stress-repo.mjs'
import { classificarErros, RAIZ, SAIDA } from './lib.mjs'
import { avaliarTetos, carregarOrcamentos } from './orcamentos.mjs'

const execFileAsync = promisify(execFile)
const INDISPONIVEL = 3
/** Tempo máximo de uma espera por condição. */
const TEMPO_CONDICAO = 10_000
/** Intervalo de leitura das esperas por condição: cadência de consulta, não o critério da espera. */
const INTERVALO = 50
/**
 * Intervalo entre duas leituras do log de processos git ao esperar que ele pare de crescer. É maior que os 400 ms
 * de espera sem mudanças da interface (settle.ts): com menos, a leitura veria "parado" enquanto a tela ainda decide.
 */
const INTERVALO_GIT = 600
/** Paradas de Tab por tela na fase de teclado. */
const TABS_POR_TELA = 40

const mensagem = (erro) => String(erro?.message ?? erro)
const ausente = (erro) => /playwright não encontrado|Chromium não encontrado/.test(mensagem(erro))
const dormir = (ms) => new Promise((resolver) => setTimeout(resolver, ms))

/**
 * Repete `leitura` até devolver algo verdadeiro. Com `lancar: false` o tempo esgotado devolve null em vez de lançar
 * (para a espera "pode ser que nada aconteça").
 */
async function ate(leitura, rotulo, { limite = TEMPO_CONDICAO, intervalo = INTERVALO, lancar = true } = {}) {
  const fim = Date.now() + limite
  for (;;) {
    const valor = await leitura()
    if (valor) return valor
    if (Date.now() > fim) {
      if (lancar) throw new Error(`não chegou a: ${rotulo}`)
      return null
    }
    await dormir(intervalo)
  }
}

/** Roda `medir` na página até duas leituras seguidas serem iguais (layout assentado) e devolve a última. */
async function assentar(page, medir, arg, rotulo) {
  let anterior = ''
  return ate(async () => {
    const atual = JSON.stringify(await page.evaluate(medir, arg))
    const assentou = atual === anterior
    anterior = atual
    return assentou ? JSON.parse(atual) : null
  }, rotulo)
}

// ------------------------------------------------------------------------------------------------ relatório

/** Acumula as linhas e o resultado de uma fase. */
function novoRelatorio(fase) {
  const motivos = []
  const checagens = []
  return {
    fase,
    motivos,
    checagens,
    medido: {},
    detalhes: {},
    /** Uma checagem booleana: `problemas` vazio = OK. */
    checagem(nome, problemas, medidoTexto = '') {
      const ok = problemas.length === 0
      checagens.push({ nome, ok, problemas, medido: medidoTexto })
      console.log(`${ok ? 'OK   ' : 'FALHA'} ${nome}${medidoTexto ? ` — ${medidoTexto}` : ''}${ok ? '' : ` — ${problemas.join('; ')}`}`)
      if (!ok) motivos.push(`${nome}: ${problemas.join('; ')}`)
    },
    /** Confere o medido contra os tetos e imprime TODOS os valores, também os que passam (a base registrada). */
    tetos(medido, tetos) {
      const violacoes = avaliarTetos(medido, tetos)
      for (const chave of new Set([...Object.keys(medido), ...Object.keys(tetos)])) {
        const v = violacoes.filter((x) => x.startsWith(`${chave}:`))
        const valor = Object.hasOwn(medido, chave) ? medido[chave] : 'não medido'
        const teto = Object.hasOwn(tetos, chave) ? tetos[chave] : 'sem teto'
        console.log(`${v.length ? 'FALHA' : 'OK   '} ${chave}: medido ${valor} vs teto ${teto}`)
      }
      motivos.push(...violacoes)
    }
  }
}

function gravar(relatorio, tetos) {
  mkdirSync(SAIDA, { recursive: true })
  const ok = relatorio.motivos.length === 0
  const corpo = { fase: relatorio.fase, quando: new Date().toISOString(), ok, medido: relatorio.medido, tetos, motivos: relatorio.motivos, checagens: relatorio.checagens, detalhes: relatorio.detalhes }
  writeFileSync(join(SAIDA, `qa-${relatorio.fase}.json`), JSON.stringify(corpo, null, 2) + '\n')
  return ok
}

/** Erros de página reprovam (o 404 do favicon é tolerado uma vez, como no e2e). */
function conferirErros(relatorio, errors, onde) {
  const erros = classificarErros(errors)
  if (!erros.ok) relatorio.motivos.push(`erros na página (${onde}): ${erros.reais.join(' | ') || `${erros.naoEncontrados}× 404`}`)
  console.log(`${erros.ok ? 'OK   ' : 'FALHA'} erros de página (${onde}): ${erros.reais.length} reais, ${erros.naoEncontrados}× 404`)
}

// ------------------------------------------------------------------------------------------------ responsivo

const dockNo = {
  grupo: (id, views, active) => ({ kind: 'group', id, views, ...(active ? { active } : {}) }),
  divisao: (id, dir, sizes, children) => ({ kind: 'split', id, dir, sizes, children })
}

/**
 * Arranjo mínimo por posição da barra de branches (formato de src/renderer/src/dock.ts). Os painéis que não estão
 * na árvore voltam sozinhos para perto dos da mesma tela (parseDock), então o resto não precisa ser descrito.
 */
function dockDaPosicao(posicao) {
  const branches = dockNo.grupo('g-branches', ['branches'])
  const principal = dockNo.grupo('g-main', ['history', 'changes.unstaged', 'changes.files', 'files.list', 'compare.setup'], 'history')
  const raiz = {
    esquerda: dockNo.divisao('d1', 'row', [0.2, 0.8], [branches, principal]),
    direita: dockNo.divisao('d1', 'row', [0.8, 0.2], [principal, branches]),
    embaixo: dockNo.divisao('d1', 'column', [0.7, 0.3], [principal, branches])
  }[posicao]
  if (!raiz) throw new Error(`posição desconhecida: ${posicao}`)
  // Branches fixado no History: sem isso o painel só aparece na tela Branches, onde ocupa tudo, e a posição não faz diferença.
  return { version: 2, hidden: [], pinned: { history: ['branches'] }, screenSizes: {}, root: raiz }
}

/**
 * Roda na página: a barra, a tela ativa e a rolagem horizontal (a régua de regressao-97-barra-estreita). No History a
 * tela visível é a linha de commit; na tela Branches (única em que a posição do painel de branches aparece) é o
 * primeiro grupo do dock, e a posição dele entra na medida.
 */
function medirLayout(telaAtiva) {
  const vw = document.documentElement.clientWidth
  const vh = document.documentElement.clientHeight
  const todos = document.querySelectorAll('.screen-tab, .toolbar .tb-menu, .toolbar .repo-button')
  const fora = []
  for (const el of todos) {
    const r = el.getBoundingClientRect()
    if (r.left < -1 || r.right > vw + 1) fora.push(`${el.textContent.trim() || el.className} [${Math.round(r.left)}..${Math.round(r.right)}]`)
  }
  const dentro = (r) => r.width > 0 && r.height > 0 && r.left >= -1 && r.right <= vw + 1 && r.top < vh && r.bottom > 0
  const linha = telaAtiva === 'History' ? document.querySelector('.commit-row') : null
  const grupo = telaAtiva === 'History' ? null : document.querySelector('.dock-group')
  const aba = document.querySelector('.dock-tab.active[data-view]')
  const ramos = document.querySelector('.dock-tab[data-view="branches"]')?.closest('.dock-group') ?? null
  const alvo = linha ?? grupo ?? aba
  const caixa = alvo ? alvo.getBoundingClientRect() : null
  return {
    vw,
    itens: todos.length,
    fora,
    tela: caixa ? dentro(caixa) : false,
    achou: !!alvo,
    posicao: (ramos ?? grupo) ? `${Math.round((ramos ?? grupo).getBoundingClientRect().left)},${Math.round((ramos ?? grupo).getBoundingClientRect().top)}` : '',
    rolagem: document.documentElement.scrollWidth - vw
  }
}

/** Roda na página: onde está o botão do alerta de conflito. */
function medirAlerta() {
  const vw = document.documentElement.clientWidth
  const el = document.querySelector('button.operation-title')
  if (!el) return { vw, existe: false }
  const r = el.getBoundingClientRect()
  return { vw, existe: true, esq: Math.round(r.left), dir: Math.round(r.right), largura: Math.round(r.width) }
}

async function definirLargura(page, largura, altura) {
  await page.setViewportSize({ width: largura, height: altura })
  await page.waitForFunction((w) => document.documentElement.clientWidth === w, largura, { timeout: TEMPO_CONDICAO })
}

async function faseResponsivo(orc, relatorio) {
  const { larguras, posicoes, altura } = orc.responsivo
  for (const posicao of posicoes) {
    // Um app por posição: o arranjo vem do localStorage lido ao carregar a página. Sem alterações não salvas
    // (wip: false), o cherry-pick do alerta de conflito não esbarra em arquivo sujo.
    const app = await newApp({ lang: 'en', wip: false, viewport: { width: larguras[0], height: altura }, layout: { dock: dockDaPosicao(posicao) } })
    try {
      await app.page.route('**/favicon.ico', (rota) => rota.fulfill({ status: 204 }))
      app.page.setDefaultTimeout(TEMPO_CONDICAO)
      for (const largura of larguras) {
        await definirLargura(app.page, largura, altura)
        // History e Branches: a posição do painel de branches só aparece na segunda. Volta ao History no fim para a
        // largura seguinte (e o alerta de conflito) começarem da mesma tela.
        for (const tela of ['History', 'Branches']) {
          const nome = `responsivo ${posicao} ${largura}px ${tela}`
          try {
            await app.page.locator('.screen-tab:not(.dashboards-tab)').filter({ hasText: tela }).first().click()
            const m = await assentar(app.page, medirLayout, tela, `layout assentado (${nome})`)
            const problemas = []
            // A régua precisa achar os itens: 8 é o piso da regressão #97 (repo, menu e as abas).
            if (m.itens < 8) problemas.push(`só ${m.itens} itens da barra medidos (mínimo 8)`)
            if (m.fora.length) problemas.push(`itens fora da tela: ${m.fora.join(', ')}`)
            if (!m.achou) problemas.push('nenhuma linha de commit, grupo ou aba ativa para conferir')
            else if (!m.tela) problemas.push(`a tela ${tela} não está dentro da janela`)
            // A rolagem horizontal do Dashboard a 320 px é o achado #119: essa tela não é aberta nesta fase.
            if (m.rolagem > 1) problemas.push(`a página rola na horizontal: ${m.rolagem}px além da janela`)
            relatorio.checagem(nome, problemas, `${m.itens} itens, tela ${m.tela ? 'visível' : 'fora'}${m.posicao ? ` em ${m.posicao}` : ''}, rolagem ${m.rolagem}px`)
          } catch (erro) {
            relatorio.checagem(nome, [mensagem(erro)])
          }
        }
        await app.page.locator('.screen-tab:not(.dashboards-tab)').filter({ hasText: 'History' }).first().click()
      }

      if (posicao === posicoes[0]) {
        // Alerta de conflito: um cherry-pick que sai com 1 (esperado) deixa a operação aberta; a página a lê ao abrir.
        try {
          await execFileAsync('git', ['cherry-pick', app.ids.memberPrice], { cwd: app.dir }).then(
            () => { throw new Error('o cherry-pick deveria parar em conflito') },
            (erro) => { if (erro.code !== 1) throw erro }
          )
          await definirLargura(app.page, larguras[larguras.length - 1], altura)
          await app.page.reload()
          await app.page.waitForSelector('button.operation-title', { timeout: TEMPO_CONDICAO })
          for (const largura of larguras) {
            const nome = `responsivo alerta de conflito ${posicao} ${largura}px`
            try {
              await definirLargura(app.page, largura, altura)
              const m = await assentar(app.page, medirAlerta, null, `alerta assentado (${nome})`)
              const problemas = []
              if (!m.existe) problemas.push('button.operation-title não existe')
              else if (m.esq < -1 || m.dir > m.vw + 1) problemas.push(`fora da janela [${m.esq}..${m.dir}] > ${m.vw}`)
              relatorio.checagem(nome, problemas, m.existe ? `[${m.esq}..${m.dir}] em ${m.vw}` : '')
            } catch (erro) {
              relatorio.checagem(nome, [mensagem(erro)])
            }
          }
        } catch (erro) {
          relatorio.checagem(`responsivo alerta de conflito ${posicao}`, [mensagem(erro)])
        }
      }
      conferirErros(relatorio, app.errors, posicao)
    } finally {
      await app.close().catch(() => undefined)
    }
  }
}

// ------------------------------------------------------------------------------------------------ desempenho

async function faseDesempenho(orc, relatorio) {
  const { cpu, cenario, tetos } = orc.desempenho
  const dir = createStressRepo()
  applyScenario(dir, cenario)
  const app = await launch({ repo: dir, language: 'en' })
  const { page, backend } = app
  const medido = relatorio.medido
  let semStage = false
  try {
    await page.route('**/favicon.ico', (rota) => rota.fulfill({ status: 204 }))
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu })

    // Contagem por id: o log do backend guarda só as últimas 500 entradas, o tamanho dele não serve.
    let ultimoId = 0
    const log = () => backend.invoke('app:gitLog', [])
    const contar = async () => {
      const entradas = await log()
      const novas = entradas.filter((e) => e.id > ultimoId)
      ultimoId = Math.max(ultimoId, ...entradas.map((e) => e.id))
      return novas.length
    }
    /**
     * Espera o git assentar: com `arranque`, primeiro que apareça um processo novo (até 5 s; uma interação que não
     * abre nenhum não pode prender a fase); depois, que o log pare de crescer e nada esteja rodando por duas
     * leituras seguidas.
     */
    const esperarGit = async ({ arranque }) => {
      if (arranque) await ate(async () => (await log()).some((e) => e.id > ultimoId), 'primeiro processo git', { limite: 5000, lancar: false })
      let anterior = ''
      await ate(async () => {
        const entradas = await log()
        const rodando = entradas.filter((e) => e.durationMs === undefined).length
        const atual = `${Math.max(0, ...entradas.map((e) => e.id))}/${rodando}`
        const assentou = atual === anterior && rodando === 0
        anterior = atual
        return assentou
      }, 'git assentado', { limite: 30_000, intervalo: INTERVALO_GIT })
    }

    const dom = () => page.evaluate(() => document.querySelectorAll('*').length)
    let nosMax = 0
    const anotarDom = async () => { nosMax = Math.max(nosMax, await dom()) }
    const row = (n) => page.locator('.commit-row').nth(n)
    const aba = (nome) => page.locator('.screen-tab:not(.dashboards-tab)').filter({ hasText: nome }).first()
    const posSelecionada = () => page.evaluate(() => document.querySelector('.commit-row.selected')?.dataset.pos ?? null)

    const longas = async () => {
      const { n, max } = await page.evaluate(() => {
        const lista = window.__long ?? []
        window.__long = []
        return { n: lista.length, max: Math.max(0, ...lista) }
      })
      return { n, max }
    }
    /** Rola o elemento `passos` vezes, um passo por quadro, e devolve o tempo médio por quadro (ms). */
    const rolar = (seletor, passos, px) =>
      page.evaluate(async ([sel, n, passo]) => {
        const el = document.querySelector(sel)
        const inicio = performance.now()
        for (let i = 0; i < n; i++) {
          el.scrollTop += passo
          await new Promise((pronto) => requestAnimationFrame(pronto))
        }
        return (performance.now() - inicio) / n
      }, [seletor, passos, px])

    // O launch devolve com a carga inicial ainda gerando processos: espera a primeira lista e o git assentarem, para o
    // baseline do contador não pegar processo da carga que veio antes do reload.
    await page.waitForSelector('.commit-row', { timeout: 120_000 })
    await esperarGit({ arranque: false })
    // Carga a frio: recarrega a página já com a CPU limitada.
    await contar()
    const inicio = Date.now()
    await page.reload()
    await page.waitForSelector('.commit-row', { timeout: 120_000 })
    medido.msCargaFrio = Date.now() - inicio
    await esperarGit({ arranque: false })
    medido.gitCargaInicial = await contar()
    await anotarDom()
    await page.evaluate(() => {
      window.__long = []
      new PerformanceObserver((lista) => {
        for (const entrada of lista.getEntries()) window.__long.push(Math.round(entrada.duration))
      }).observe({ entryTypes: ['longtask'] })
    })

    // A janela ganha o foco: o app relê o repositório.
    await page.evaluate(() => window.__emit('repo:changed'))
    await esperarGit({ arranque: true })
    medido.gitFoco = await contar()

    // Selecionar 1 commit.
    await row(8).click()
    await page.waitForSelector('.commit-row.selected')
    await esperarGit({ arranque: true })
    medido.gitSelecionarCommit = await contar()

    // 10× seta para baixo: cada tecla espera a seleção andar, como quem digita olhando a tela.
    await page.locator('.commit-list .list-body').focus()
    for (let i = 0; i < 10; i++) {
      const antes = await posSelecionada()
      await page.keyboard.press('ArrowDown')
      await ate(async () => (await posSelecionada()) !== antes, `seleção andar na seta ${i + 1}`)
    }
    await esperarGit({ arranque: true })
    medido.gitSetas10x = await contar()

    // 30 quadros × 400 px = 12.000 px, dentro dos primeiros 500 commits (como scripts/perf/ui.mjs).
    await longas()
    const porQuadro = await rolar('.commit-list .list-body', 30, 400)
    medido.msPorQuadroRolagem = Math.round(porQuadro * 10) / 10
    const l = await longas()
    medido.tarefasLongasRolagem = l.n
    medido.maiorTarefaLongaMs = l.max
    await anotarDom()
    await page.evaluate(() => { document.querySelector('.commit-list .list-body').scrollTop = 0 })
    await esperarGit({ arranque: false })
    await contar()

    // Tela Changes e stage de 1 arquivo.
    await aba('Changes').click()
    // `.diff-file` existe no histórico também; só a tela Changes põe um dentro de `.csection-diff`.
    await page.waitForSelector('.csection-diff .diff-file', { timeout: 60_000 })
    await esperarGit({ arranque: true })
    await anotarDom()
    await contar()
    const stage = page.locator('button[title="Stage"]').first()
    if (await stage.count()) {
      await stage.dispatchEvent('click')
      await esperarGit({ arranque: true })
      // O 1 do próprio `git add` está na conta, como no orçamento da seção 7.
      medido.gitStage = await contar()
    } else {
      // Um motivo só: o teto de gitStage sai da conta abaixo, senão "teto sem medida" repetiria a mesma falha.
      relatorio.motivos.push('tela Changes sem botão Stage: não mediu o stage')
      semStage = true
    }

    await aba('History').click()
    await page.waitForSelector('.commit-row', { timeout: 60_000 })
    await anotarDom()
    medido.nosDom = nosMax
    conferirErros(relatorio, app.errors, 'desempenho')
  } catch (erro) {
    relatorio.motivos.push(`a medição parou: ${mensagem(erro)}`)
    console.log(`FALHA a medição parou: ${mensagem(erro)}`)
  } finally {
    await app.close().catch(() => undefined)
    applyScenario(dir, 'clean')
  }
  if (!Object.hasOwn(medido, 'nosDom') && nosMax) medido.nosDom = nosMax
  relatorio.detalhes = { cpu, cenario }
  const tetosSemStage = Object.fromEntries(Object.entries(tetos).filter(([chave]) => chave !== 'gitStage'))
  relatorio.tetos(medido, semStage ? tetosSemStage : tetos)
}

// ------------------------------------------------------------------------------------------------ teclado

/** Roda na página: controles visíveis e habilitados sem nome acessível, ainda não vistos (a barra se repete em toda tela). */
function semNomeAcessivel() {
  window.__qaNomes ??= new WeakSet()
  const seletor = 'button, [role=button], a[href], input:not([type=hidden]), select, textarea, [role=tab]'
  const texto = (el) => (el.textContent || '').trim()
  const visivel = (el) => {
    if (!el.getClientRects().length) return false
    const s = getComputedStyle(el)
    return s.visibility !== 'hidden' && s.display !== 'none'
  }
  const temNome = (el) => {
    if ((el.getAttribute('aria-label') || '').trim()) return true
    const por = el.getAttribute('aria-labelledby')
    if (por && por.split(/\s+/).some((id) => texto(document.getElementById(id) ?? { textContent: '' }))) return true
    if ((el.getAttribute('title') || '').trim() || (el.getAttribute('alt') || '').trim()) return true
    if (el.labels && [...el.labels].some((rotulo) => texto(rotulo))) return true
    if (el.tagName === 'INPUT' && ['button', 'submit', 'reset'].includes(el.type) && el.value) return true
    if (texto(el)) return true
    // Ícone com nome próprio dentro do botão.
    return !!el.querySelector('[aria-label]:not([aria-label=""]), img[alt]:not([alt=""]), svg title')
  }
  let verificados = 0
  const sem = []
  for (const el of document.querySelectorAll(seletor)) {
    if (window.__qaNomes.has(el) || !visivel(el) || el.disabled) continue
    window.__qaNomes.add(el)
    verificados++
    if (!temNome(el)) sem.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}`)
  }
  return { verificados, sem }
}

/** Roda na página: descreve a parada de foco atual. */
function paradaDeFoco() {
  window.__qaFoco ??= new WeakSet()
  const el = document.activeElement
  if (!el || el === document.body || el === document.documentElement) {
    // Parada em body (fim do ciclo): não vira referência de "primeira parada" nem de "mesmo elemento".
    window.__qaAnterior = null
    window.__qaIgual = 0
    return { corpo: true }
  }
  // A primeira parada é a primeira que não é body (a referência é zerada no preparo de cada tela).
  if (!window.__qaPrimeiro) {
    window.__qaPrimeiro = el
    window.__qaIgual = 0
  } else if (el === window.__qaPrimeiro) {
    return { volta: true }
  }
  window.__qaIgual = el === window.__qaAnterior ? (window.__qaIgual ?? 0) + 1 : 0
  window.__qaAnterior = el
  const r = el.getBoundingClientRect()
  const s = getComputedStyle(el)
  const vw = document.documentElement.clientWidth
  const vh = document.documentElement.clientHeight
  const visivel = r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
  // Na horizontal vale a régua da janela; na vertical basta cruzá-la (a lista rolável pode ser mais alta que a tela).
  const dentro = r.left >= -1 && r.right <= vw + 1 && r.top < vh && r.bottom > 0
  const contorno = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0
  const sombra = s.boxShadow !== 'none'
  const novo = !window.__qaFoco.has(el)
  window.__qaFoco.add(el)
  const nome = `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}`
  return { nome, visivel, dentro, indicacao: contorno || sombra, novo, preso: window.__qaIgual >= 2 }
}

async function faseTeclado(orc, relatorio) {
  const app = await newApp({ lang: 'en' })
  const semNome = []
  const semFoco = []
  let verificados = 0
  const paradas = {}
  try {
    await app.page.route('**/favicon.ico', (rota) => rota.fulfill({ status: 204 }))
    app.page.setDefaultTimeout(TEMPO_CONDICAO)
    for (const tela of ['History', 'Changes', 'Files', 'Compare']) {
      try {
        await app.page.locator('.screen-tab:not(.dashboards-tab)').filter({ hasText: tela }).first().click()
        // Tela pronta: o botão ativo e a quantidade de nós assentaram.
        await assentar(app.page, () => ({ ativa: document.querySelector('.screen-tab.active')?.textContent?.trim(), nos: document.querySelectorAll('*').length }), null, `tela ${tela} assentada`)

        const nomes = await app.page.evaluate(semNomeAcessivel)
        verificados += nomes.verificados
        for (const n of nomes.sem) semNome.push(`${tela}: ${n}`)

        // Tab: começa sem foco e anda até fechar o ciclo ou chegar ao limite.
        await app.page.evaluate(() => { document.activeElement?.blur?.(); window.__qaAnterior = null; window.__qaPrimeiro = null; window.__qaIgual = 0 })
        let corpos = 0
        let contadas = 0
        for (let i = 0; i < TABS_POR_TELA; i++) {
          await app.page.keyboard.press('Tab')
          const p = await app.page.evaluate(paradaDeFoco)
          if (p.volta) break
          contadas++
          if (p.corpo) {
            // Sair do documento uma vez é o fim do ciclo; duas é foco perdido no meio da tela.
            if (++corpos >= 2) { relatorio.motivos.push(`${tela}: o foco caiu em body mais de uma vez`); break }
            continue
          }
          if (!p.visivel) relatorio.motivos.push(`${tela}: foco em elemento invisível (${p.nome})`)
          if (!p.dentro) relatorio.motivos.push(`${tela}: foco fora da janela (${p.nome})`)
          if (p.preso) { relatorio.motivos.push(`${tela}: foco preso em ${p.nome} por 3 Tabs`); break }
          if (p.novo && !p.indicacao) semFoco.push(`${tela}: ${p.nome}`)
        }
        paradas[tela] = contadas
      } catch (erro) {
        relatorio.motivos.push(`${tela}: ${mensagem(erro)}`)
        console.log(`FALHA ${tela}: ${mensagem(erro)}`)
      }
    }
    conferirErros(relatorio, app.errors, 'teclado')
  } finally {
    await app.close().catch(() => undefined)
  }
  const medido = relatorio.medido
  medido.semNomeAcessivel = semNome.length
  medido.semFocoVisivel = semFoco.length
  relatorio.detalhes = { controlesVerificados: verificados, paradasDeTabPorTela: paradas, semNomeAcessivel: semNome.slice(0, 10), semFocoVisivel: semFoco.slice(0, 10) }
  console.log(`controles verificados: ${verificados}; paradas de Tab por tela: ${JSON.stringify(paradas)}`)
  for (const [rotulo, lista] of [['sem nome acessível', semNome], ['sem foco visível', semFoco]]) {
    if (lista.length) console.log(`  ${rotulo} (${lista.length}, até 10): ${lista.slice(0, 10).join(' | ')}`)
  }
  relatorio.tetos(medido, orc.teclado.tetos)
}

// ------------------------------------------------------------------------------------------------ entrada

const FASES_QA = { responsivo: faseResponsivo, desempenho: faseDesempenho, teclado: faseTeclado }

async function rodar(fase, relatorio, contexto) {
  rmSync(join(SAIDA, `qa-${fase}.json`), { force: true })
  if (!existsSync(join(RAIZ, 'extension/dist/webview/index.html'))) {
    console.error(`qa ${fase}: a interface não foi compilada (rode \`npm run build:extension\` antes)`)
    return 1
  }
  let orcamentos
  try {
    orcamentos = carregarOrcamentos()
    contexto.tetos = fase === 'desempenho' ? orcamentos.desempenho.tetos : fase === 'teclado' ? orcamentos.teclado.tetos : null
  } catch (erro) {
    console.error(`qa ${fase}: ${mensagem(erro)}`)
    return 1
  }
  try {
    await FASES_QA[fase](orcamentos, relatorio)
  } catch (erro) {
    if (ausente(erro)) {
      console.error('qa indisponível: instale Playwright e Chromium (ver .claude/skills/run-gittools)')
      return INDISPONIVEL
    }
    relatorio.motivos.push(`erro no roteiro: ${erro?.stack ?? mensagem(erro)}`)
  }
  const ok = gravar(relatorio, contexto.tetos)
  if (!ok) {
    console.error(`qa ${fase}: ${relatorio.motivos.length} motivo(s) de falha; relatório em ${join(SAIDA, `qa-${fase}.json`)}`)
    for (const m of relatorio.motivos) console.error(`  - ${m}`)
    return 1
  }
  console.log(`qa ${fase}: ok`)
  return 0
}

const fase = process.argv[2]
if (!Object.hasOwn(FASES_QA, fase ?? '')) {
  console.error(`uso: node scripts/validacao/qa.mjs <${Object.keys(FASES_QA).join('|')}>`)
  process.exit(2)
}

// Relatório e tetos ficam fora de `rodar` para a trava de tempo gravar o que já foi medido antes de sair.
const relatorio = novoRelatorio(fase)
const contexto = { tetos: null }

// Trava de segurança: uma tela que nunca carrega não pode prender o pipeline até o limite do CI. 10 minutos cobrem o
// pior caso das esperas da fase de desempenho (carga a frio 120 s, duas esperas de 60 s e cinco de 30 s de git).
setTimeout(() => {
  console.error(`qa ${fase}: excedeu o tempo (10 minutos)`)
  relatorio.motivos.push('excedeu o tempo')
  try {
    gravar(relatorio, contexto.tetos)
  } catch (erro) {
    console.error(`qa ${fase}: não gravou o relatório: ${mensagem(erro)}`)
  }
  process.exit(1)
}, 600_000).unref()

let codigo
try {
  codigo = await rodar(fase, relatorio, contexto)
} catch (erro) {
  console.error(`qa ${fase}: erro no roteiro: ${erro?.stack ?? erro}`)
  codigo = 1
}
// Chromium e servidor podem demorar a soltar o processo: a decisão já foi tomada.
process.exit(codigo)
