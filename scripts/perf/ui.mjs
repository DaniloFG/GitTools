// Mede a interface de verdade (Chromium + Backend real) com a CPU limitada, para simular um computador fraco.
// Mostra, para cada interação: quantos processos git ela abre, as tarefas longas (>50 ms, que travam a tela)
// e o tempo por quadro ao rolar e arrastar. Precisa do mesmo que os roteiros de scripts/readme-media:
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

/** Arrasta a primeira divisória entre painéis `steps` passos e devolve o tempo médio por passo. */
async function dragDivider(steps) {
  const box = await page.locator('.dock-divider').first().boundingBox()
  if (!box) return null
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  const start = Date.now()
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) await page.mouse.move(x + i * 4, y + i * 4)
  await page.mouse.up()
  return (Date.now() - start) / steps
}

const row = (n) => page.locator('.commit-row').nth(n)
const screen = (name) => page.locator(`.toolbar >> text=${name}`).first()
const dom = () => page.evaluate(() => document.querySelectorAll('*').length)

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

show('rolar o histórico (120 quadros)', `${(await scroll('.commit-list .list-body', 120, 400)).toFixed(1)} ms por quadro`)
show('  tarefas longas', await longTasks())
show('  linhas montadas / nós no DOM', `${await page.locator('.commit-row').count()} / ${await dom()}`)

await page.evaluate(() => (document.querySelector('.commit-list .list-body').scrollTop = 0))
await row(8).click()
await wait(1500)
await longTasks()
const typical = await dragDivider(30)
if (typical !== null) show('arrastar divisória, diff pequeno (30 passos)', `${typical.toFixed(0)} ms por passo`)
show('  tarefas longas', await longTasks())

await gitProcesses()
start = Date.now()
await screen('Changes').click()
await page.waitForSelector('.diff-file, .empty', { timeout: 60000 })
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
const extreme = await dragDivider(5)
if (extreme !== null) show('arrastar divisória com esse diff (5 passos)', `${extreme.toFixed(0)} ms por passo`)

if (app.errors.length) console.log('erros da página:', app.errors.slice(0, 5))
await app.close()
applyScenario(dir, 'clean')
