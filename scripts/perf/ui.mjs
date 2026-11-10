// Mede a interface de verdade (Chromium + Backend real) com a CPU limitada, para simular um computador fraco.
// Mostra, para cada interação: quantos processos git ela abre, as tarefas longas (>50 ms, que travam a tela),
// o tempo por quadro ao rolar e por passo ao arrastar, e a divisão desse tempo em script, layout e cálculo de
// estilo (o que é do navegador, não do React). Precisa do mesmo que os roteiros de scripts/readme-media:
//   npm run build:extension        (a interface empacotada)
//   playwright instalado           (PLAYWRIGHT_MODULE e CHROMIUM apontam para outra instalação)
//
//   node scripts/perf/ui.mjs [lentidão-da-CPU=4] [clean|moderate|heavy] [--trace]
import { launch } from '../readme-media/harness.mjs'
import { applyScenario, createStressRepo } from './stress-repo.mjs'

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const trace = process.argv.includes('--trace')
const rate = Number(args[0] ?? 4)
const scenario = args[1] ?? 'moderate'
const dir = createStressRepo()
applyScenario(dir, scenario)

const app = await launch({ repo: dir, language: 'en' })
const { page, backend } = app
const cdp = await page.context().newCDPSession(page)
await cdp.send('Emulation.setCPUThrottlingRate', { rate })
// Contadores de tempo do navegador (script, layout, estilo) acumulados desde aqui.
await cdp.send('Performance.enable')

const show = (label, value) => console.log(`${label.padEnd(58)} ${value}`)
const wait = (ms) => page.waitForTimeout(ms)

/** Processos git desde a última chamada (com `--trace`, lista quais foram). */
let lastId = 0
async function gitProcesses() {
  const log = await backend.invoke('app:gitLog', [])
  const fresh = log.filter((e) => e.id > lastId)
  lastId = Math.max(lastId, ...log.map((e) => e.id))
  if (trace) {
    const count = new Map()
    for (const e of fresh) {
      const key = e.args.filter((a) => !a.startsWith('--format') && !/^[0-9a-f]{40}$/.test(a)).slice(0, 4).join(' ').slice(0, 64)
      count.set(key, (count.get(key) ?? 0) + 1)
    }
    for (const [key, n] of count) console.log(`      ${n}× git ${key}`)
  }
  return fresh.length
}

/** Tarefas longas desde a última chamada: quantas, a maior e a soma (ms). */
const longTasks = async () => {
  const { n, max, total } = await page.evaluate(() => {
    const list = window.__long ?? []
    window.__long = []
    return { n: list.length, max: Math.max(0, ...list), total: list.reduce((a, b) => a + b, 0) }
  })
  return `${n} (maior ${max} ms, soma ${total} ms)`
}
const watchLongTasks = () =>
  page.evaluate(() => {
    window.__long = []
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__long.push(Math.round(entry.duration))
    }).observe({ entryTypes: ['longtask'] })
  })

/** Tempo acumulado do navegador (ms) em script, layout e cálculo de estilo. */
async function acumulado() {
  const { metrics } = await cdp.send('Performance.getMetrics')
  const v = Object.fromEntries(metrics.map((m) => [m.name, m.value]))
  return { script: v.ScriptDuration * 1000, layout: v.LayoutDuration * 1000, estilo: v.RecalcStyleDuration * 1000 }
}

/**
 * Roda `fn` e devolve o resultado dela e a divisão do custo do navegador por `n` unidades (quadros ou passos),
 * no formato `script / layout / estilo`. Mostra se o tempo vai para o JavaScript ou para o próprio navegador.
 */
async function custo(fn, n) {
  const antes = await acumulado()
  const result = await fn()
  const depois = await acumulado()
  const por = (k) => ((depois[k] - antes[k]) / n).toFixed(1)
  return { result, linha: `${por('script')} / ${por('layout')} / ${por('estilo')}` }
}

/** Rola o elemento `steps` vezes, um passo por quadro, e devolve o tempo médio por quadro. */
const scroll = (selector, steps, step) =>
  page.evaluate(
    async ([sel, n, px]) => {
      const el = document.querySelector(sel)
      const start = performance.now()
      for (let i = 0; i < n; i++) {
        el.scrollTop += px
        await new Promise((done) => requestAnimationFrame(done))
      }
      return (performance.now() - start) / n
    },
    [selector, steps, step]
  )

/**
 * Arrasta a primeira divisória entre painéis e devolve o tempo médio por passo. Metade dos passos vai para um
 * lado e a outra metade volta ao ponto de partida, para uma medição não deixar a divisória deslocada para a
 * seguinte. `steps` é par.
 */
async function dragDivider(steps) {
  const box = await page.locator('.dock-divider').first().boundingBox()
  if (!box) return null
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  const half = steps / 2
  const offsets = [
    ...Array.from({ length: half }, (_, i) => (i + 1) * 4),
    ...Array.from({ length: half }, (_, i) => (half - i - 1) * 4)
  ]
  const start = Date.now()
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (const d of offsets) await page.mouse.move(x + d, y + d)
  await page.mouse.up()
  return (Date.now() - start) / steps
}

const row = (n) => page.locator('.commit-row').nth(n)
const screen = (name) => page.locator(`.toolbar >> text=${name}`).first()
const dom = () => page.evaluate(() => document.querySelectorAll('*').length)
const montadas = () => page.locator('.commit-row').count()

console.log(`\n== interface — CPU ${rate}× mais lenta, cenário ${scenario} ==`)

// Carga a frio: recarrega a página já com a CPU limitada.
await gitProcesses()
let start = Date.now()
await page.reload()
await page.waitForSelector('.commit-row', { timeout: 120000 })
show('carga a frio até a 1ª linha do histórico', `${Date.now() - start} ms`)
await wait(2500)
await watchLongTasks()
show('  processos git', await gitProcesses())
show('  nós no DOM', await dom())

await page.evaluate(() => window.__emit('repo:changed'))
await wait(2500)
show('a janela ganha o foco: processos git', await gitProcesses())

await row(8).click()
await wait(1500)
await longTasks()
await gitProcesses()
await page.locator('.commit-list .list-body').focus()
for (let i = 0; i < 10; i++) {
  await page.keyboard.press('ArrowDown')
  await wait(60)
}
await wait(3000)
show('10× seta ↓ no histórico: processos git', await gitProcesses())
show('  tarefas longas', await longTasks())

// Arrasto com só as linhas iniciais montadas (antes de qualquer rolagem).
const linhasAntes = await montadas()
const arrastoInicial = await custo(() => dragDivider(30), 30)
if (arrastoInicial.result !== null) show(`arrastar divisória, ${linhasAntes} linhas montadas (30 passos)`, `${arrastoInicial.result.toFixed(0)} ms por passo`)
if (arrastoInicial.result !== null) show('  script / layout / estilo', `${arrastoInicial.linha} ms por passo`)
show('  tarefas longas', await longTasks())

// 30 quadros × 400 px = 12.000 px, dentro dos primeiros 500 commits (15.000 px). Se a rolagem passasse
// do fim da primeira página, o histórico carregaria mais commits no meio da medição e os quadros de
// carga teriam custo diferente, e a média deixaria de ser comparável com a medição anterior.
const rolagem = await custo(() => scroll('.commit-list .list-body', 30, 400), 30)
show('rolar o histórico (30 quadros, dentro dos 1ºs 500 commits)', `${rolagem.result.toFixed(1)} ms por quadro`)
show('  script / layout / estilo', `${rolagem.linha} ms por quadro`)
show('  tarefas longas', await longTasks())
show('  linhas montadas / nós no DOM', `${await montadas()} / ${await dom()}`)

await page.evaluate(() => (document.querySelector('.commit-list .list-body').scrollTop = 0))
await row(8).click()
await wait(1500)
await longTasks()
// Arrasto depois da rolagem: as linhas roladas continuam montadas (o histórico nunca as retira).
const linhasDepois = await montadas()
const typical = await custo(() => dragDivider(30), 30)
if (typical.result !== null) show(`arrastar divisória, ${linhasDepois} linhas montadas (30 passos)`, `${typical.result.toFixed(0)} ms por passo`)
if (typical.result !== null) show('  script / layout / estilo', `${typical.linha} ms por passo`)
show('  tarefas longas', await longTasks())

await gitProcesses()
start = Date.now()
await screen('Changes').click()
// `.diff-file` existe no histórico também (diff do commit selecionado); só a tela Changes põe um dentro de `.csection-diff`.
await page.waitForSelector('.csection-diff .diff-file', { timeout: 60000 })
show('abrir a tela Changes', `${Date.now() - start} ms`)
await wait(2500)
show('  processos git', await gitProcesses())
show('  tarefas longas', await longTasks())

const stage = page.locator('button[title="Stage"]').first()
if (await stage.count()) {
  await stage.dispatchEvent('click')
  await wait(4000)
  show('stage de 1 arquivo: processos git (1 é o próprio add)', await gitProcesses())
  show('  tarefas longas', await longTasks())
}

await screen('History').click()
await page.waitForSelector('.commit-row', { timeout: 60000 })
await wait(2000)
await row(5).click()
await wait(1500)
await longTasks()

// Caso extremo: o commit com 5000 linhas alteradas num arquivo (25 mil linhas de tabela).
start = Date.now()
await row(1).click()
await page.waitForFunction(() => document.querySelectorAll('.diff-table tr.line').length > 20000, null, { timeout: 300000 })
show('abrir diff de 5000 linhas alteradas', `${Date.now() - start} ms`)
await wait(2500)
show('  tarefas longas', await longTasks())
show('  nós no DOM', await dom())
show('rolar esse diff (30 quadros)', `${(await scroll('.diff-body', 30, 600)).toFixed(1)} ms por quadro`)
await longTasks()
const clicks = await page.evaluate(async () => {
  const cells = [...document.querySelectorAll('.diff-table tr[data-change] td.sel')].slice(0, 5)
  const times = []
  for (const cell of cells) {
    const begin = performance.now()
    cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
    times.push(Math.round(performance.now() - begin))
  }
  return times
})
show('marcar 1 linha nesse diff (5 cliques)', `${clicks.join(', ')} ms`)
const extreme = await custo(() => dragDivider(6), 6)
if (extreme.result !== null) show('arrastar divisória com esse diff (6 passos)', `${extreme.result.toFixed(0)} ms por passo`)
if (extreme.result !== null) show('  script / layout / estilo', `${extreme.linha} ms por passo`)

if (app.errors.length) console.log('erros da página:', app.errors.slice(0, 5))
await app.close()
applyScenario(dir, 'clean')
