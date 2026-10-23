// Prints e GIF dos dashboards para os READMEs, com um repositório grande de exemplo (scripts/readme-media/big-demo.mjs).
//   npm run build:extension && node scripts/readme-media/dashboards.mjs local|extension [png|gif]
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createBigDemo } from './big-demo.mjs'
import { launch } from './harness.mjs'
import { glide, tmp, toGif } from './lib.mjs'

const root = resolve(new URL('../..', import.meta.url).pathname)
const target = process.argv[2] === 'extension' ? 'extension' : 'local'
const what = process.argv[3] ?? 'all'
const OUT = process.env.OUT
const local = target === 'local'
const lang = local ? 'pt-BR' : 'en'
const host = local ? 'electron' : 'vscode'
const dir = OUT ?? (local ? join(root, 'docs/screenshots') : join(root, 'extension/media/readme'))
mkdirSync(dir, { recursive: true })
const name = (id) => (local ? { overview: 'dashboards-visao-geral', light: 'dashboards-claro', people: 'dashboards-pessoas', code: 'dashboards-codigo', cadence: 'dashboards-cadencia', governance: 'dashboards-governanca', repository: 'dashboards-repositorio', tool: 'dashboards-gittools', gallery: 'dashboards-galeria', custom: 'dashboards-personalizado', tooltip: 'dashboards-tooltip' } : { overview: 'dashboards-overview', light: 'dashboards-light', people: 'dashboards-people', code: 'dashboards-code', cadence: 'dashboards-cadence', governance: 'dashboards-governance', repository: 'dashboards-repository', tool: 'dashboards-gittools', gallery: 'dashboards-gallery', custom: 'dashboards-custom', tooltip: 'dashboards-tooltip' })[id]

const repoDir = join(mkdtempSync(join(tmpdir(), 'dash-')), 'acme-shop')
createBigDemo(repoDir)
const VIEWPORT = { width: 1600, height: 1000 }
const TEXT = local
  ? { history: 'Histórico', changes: 'Alterações', files: 'Arquivos', compare: 'Comparar', add: /Adicionar gráfico/, days30: '30 dias', galleryBus: 'Fator de ônibus', treemap: 'Treemap' }
  : { history: 'History', changes: 'Changes', files: 'Files', compare: 'Compare', add: /Add chart/, days30: '30 days', galleryBus: 'Bus factor', treemap: 'Treemap' }

async function open(theme, video) {
  const app = await launch({ repo: repoDir, language: lang, host, viewport: VIEWPORT, theme, video })
  await app.page.waitForTimeout(1000)
  return app
}

async function toDashboards(page) {
  await page.locator('.dashboards-tab').click()
  await page.waitForSelector('.dash-grid')
  await page.waitForTimeout(1800)
}

/** Navega pelas telas normais para o GitTools executar (e registrar) comandos de verdade antes do dashboard "GitTools". */
async function exercise(page) {
  for (const label of [TEXT.changes, TEXT.files, TEXT.compare, TEXT.history]) {
    await page.locator('.screen-tab', { hasText: label }).click()
    await page.waitForTimeout(500)
  }
  const rows = page.locator('.commit-row, .commit-list tr, li').filter({ hasText: /^.*\b[0-9a-f]{7}\b/ })
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('ArrowDown').catch(() => undefined)
    await page.waitForTimeout(250)
  }
  void rows
  await page.keyboard.press('F5').catch(() => undefined)
  await page.waitForTimeout(800)
}

async function stills() {
  const app = await open('dark')
  const { page } = app
  await exercise(page)
  await toDashboards(page)
  const tab = (i) => page.locator('.dash-tab').nth(i)
  const shot = async (id) => {
    await page.waitForTimeout(700)
    await page.screenshot({ path: join(dir, `${name(id)}.png`) })
    console.log('  ✓', name(id))
  }
  await shot('overview')
  // Tooltip numa área.
  const area = await page.locator('[data-widget="commits-over-time"] svg rect[fill="transparent"]').first().boundingBox()
  await page.mouse.move(area.x + area.width * 0.7, area.y + area.height * 0.45, { steps: 10 })
  await shot('tooltip')
  await page.mouse.move(5, 5)
  const order = ['people', 'code', 'cadence', 'governance', 'repository', 'tool']
  for (let i = 0; i < order.length; i++) {
    await tab(i + 1).click()
    await shot(order[i])
  }
  // Galeria
  await tab(0).click()
  await page.getByRole('button', { name: TEXT.add }).click()
  await page.waitForSelector('.dash-gallery')
  await shot('gallery')
  await page.keyboard.press('Escape')
  await app.close()

  const light = await open('light')
  await toDashboards(light.page)
  await light.page.waitForTimeout(500)
  await light.page.screenshot({ path: join(dir, `${name('light')}.png`) })
  console.log('  ✓', name('light'))
  await light.close()
}

async function gif() {
  const video = tmp('dash-gif-')
  const app = await open('dark', video)
  const { page } = app
  await toDashboards(page)
  const begin = (Date.now() - app.t0) / 1000
  const handle = page.video()
  const wait = (ms) => page.waitForTimeout(ms)
  const click = async (loc, pause = 500) => {
    await glide(page, loc, { steps: 16 })
    await wait(100)
    await loc.click()
    await wait(pause)
  }
  const tab = (i) => page.locator('.dash-tab').nth(i)
  const card = (id) => page.locator(`[data-widget="${id}"]`)
  // Visão geral: passa o mouse no gráfico e troca a forma de ver.
  const area = await card('commits-over-time').locator('svg rect[fill="transparent"]').first().boundingBox()
  await page.mouse.move(area.x + 80, area.y + area.height / 2, { steps: 10 })
  await page.mouse.move(area.x + area.width * 0.8, area.y + area.height * 0.4, { steps: 40 })
  await wait(900)
  await click(card('commits-over-time').locator('.dash-views button').nth(2), 1100)
  await click(card('commits-over-time').locator('.dash-views button').nth(3), 1000)
  await click(card('commits-over-time').locator('.dash-views button').nth(0), 700)
  await click(card('top-people').locator('.dash-views button').nth(4), 1500)
  await click(card('top-people').locator('.dash-views button').nth(5), 1000)
  // Período e outras telas.
  await click(page.getByRole('button', { name: TEXT.days30 }), 1400)
  await click(page.getByRole('button', { name: local ? '12 meses' : '12 months' }), 900)
  await click(tab(1), 1500)
  await click(tab(2), 1700)
  await click(tab(3), 1700)
  await click(tab(4), 1700)
  // Galeria: adicionar um gráfico.
  await click(page.getByRole('button', { name: TEXT.add }), 900)
  await click(page.locator('.dash-gallery-item', { hasText: TEXT.galleryBus }), 800)
  await page.keyboard.press('Escape')
  await wait(1500)
  await app.close()
  toGif(await handle.path(), join(dir, `${local ? 'dashboards' : 'dashboards'}.gif`), { start: Math.max(0, begin - 0.3), fps: 8, colors: 72 })
  console.log('  ✓ dashboards.gif')
}

if (what === 'all' || what === 'png') await stills()
if (what === 'all' || what === 'gif') await gif()
