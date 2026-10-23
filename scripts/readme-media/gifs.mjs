// Gera os GIFs de uso do README da extensão (extension/media/readme/*.gif) gravando a interface real.
//   node scripts/readme-media/gifs.mjs [nome ...]
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { clickSlow, dragHtml5, ensureDir, glide, newApp, tmp, toGif } from './lib.mjs'
import { FILES_DOCK } from './presets.mjs'

const root = resolve(new URL('../..', import.meta.url).pathname)
const OUT = process.env.OUT ?? ensureDir(join(root, 'extension/media/readme'))
const only = process.argv.slice(2)
const VIEWPORT = { width: 1440, height: 856 }

const scenes = []
const scene = (name, opts, run) => scenes.push({ name, opts, run })
const wait = (app, ms) => app.page.waitForTimeout(ms)

const branch = (app, name) => app.page.locator('.branch-item', { hasText: name }).first()
const main = (app) => app.page.locator('.branch-item.current')
const commitRow = (app, sha) => app.page.getByText(sha.slice(0, 7)).first()
const screenTab = (app, name) => app.page.locator('.screen-tab', { hasText: name })

scene('cherry-pick-branch', { wip: false }, async (app) => {
  const { page } = app
  await wait(app, 900)
  await dragHtml5(page, branch(app, 'feature/login'), main(app), { hold: 900 })
  await page.waitForSelector('.modal')
  await wait(app, 1300)
  await clickSlow(page, page.locator('.modal button', { hasText: /Cherry-pick every commit/ }), 400)
  await wait(app, 2800)
})

scene('cherry-pick-lines', { wip: false }, async (app) => {
  const { page } = app
  await wait(app, 700)
  await clickSlow(page, commitRow(app, app.ids.loginForm), 1200)
  // Arrasta sobre as linhas adicionadas do Button.tsx (no diff do commit).
  await clickSlow(page, page.locator('.file-item, .file-row, .dock-slot li').filter({ hasText: 'Button.tsx' }).first(), 900).catch(() => undefined)
  const added = page.locator('tr.line-add td.code')
  const first = await added.first().boundingBox()
  const last = await added.nth(Math.min(3, (await added.count()) - 1)).boundingBox()
  await page.mouse.move(first.x + 60, first.y + first.height / 2, { steps: 20 })
  await wait(app, 300)
  await page.mouse.down()
  await page.mouse.move(last.x + 60, last.y + last.height / 2, { steps: 40 })
  await page.mouse.up()
  await wait(app, 1200)
  await clickSlow(page, page.getByRole('button', { name: /Apply \d+ lines/ }), 1400)
  await clickSlow(page, page.locator('.modal button', { hasText: /Apply and commit/ }), 400)
  await wait(app, 2600)
})

scene('conflict-resolution', { wip: false }, async (app) => {
  const { page } = app
  await wait(app, 700)
  await dragHtml5(page, branch(app, 'feature/member-price'), main(app), { hold: 700 })
  await page.waitForSelector('.modal')
  await wait(app, 900)
  await clickSlow(page, page.locator('.modal button', { hasText: /Cherry-pick every commit/ }), 400)
  // O conflito leva a tela de Alterações para a frente.
  await page.getByRole('button', { name: /Resolve side by side/i }).first().waitFor()
  await wait(app, 1200)
  await clickSlow(page, page.getByRole('button', { name: /Resolve side by side/i }).first(), 900)
  await page.waitForSelector('.modal')
  await wait(app, 1100)
  // Escolhe, no bloco, manter as duas versões e depois salva.
  await clickSlow(page, page.locator('.modal button', { hasText: /Keep both|Both/ }).first(), 1000)
  await wait(app, 600)
  await clickSlow(page, page.locator('.modal button.primary'), 900)
  await wait(app, 500)
  await clickSlow(page, page.getByRole('button', { name: 'Continue', exact: true }), 400)
  await wait(app, 2500)
})


scene('diff-navigation', { wip: false }, async (app) => {
  const { page } = app
  await wait(app, 700)
  await clickSlow(page, commitRow(app, app.ids.discount), 1200)
  await clickSlow(page, page.locator('.file-view-toggle button', { hasText: 'Tree' }).first(), 900)
  await clickSlow(page, page.locator('.file-item', { hasText: 'cart.js' }).first(), 1100)
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('F7')
    await wait(app, 900)
  }
  await page.keyboard.press('Shift+F7')
  await wait(app, 900)
  await page.keyboard.press('F8')
  await wait(app, 1100)
  await page.keyboard.press('F8')
  await wait(app, 1500)
})

scene('custom-layout', { wip: false }, async (app) => {
  const { page } = app
  const menu = async (label) => {
    await clickSlow(page, page.locator('.panels-button'), 500)
    return page.locator('.context-menu').getByText(label).first()
  }
  await wait(app, 800)
  // Arrasta a aba Changes para o lado direito do painel do histórico.
  const tab = page.locator('.dock-tab[data-view="changes.unstaged"]')
  const body = await page.locator('[data-group="g-main"]').boundingBox()
  const from = await tab.boundingBox()
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2, { steps: 10 })
  await page.mouse.down()
  await page.mouse.move(body.x + body.width * 0.94, body.y + body.height * 0.5, { steps: 28 })
  await wait(app, 900)
  await page.mouse.up()
  await wait(app, 1000)
  // Guarda o arranjo com um nome.
  await clickSlow(page, await menu('Save current layout…'), 700)
  await page.locator('.modal input').pressSequentially('History + Changes', { delay: 70 })
  await wait(app, 500)
  await clickSlow(page, page.locator('.modal button.primary'), 900)
  // Volta ao padrão e reaplica o salvo.
  await clickSlow(page, await menu('Restore default layout'), 700)
  await clickSlow(page, page.locator('.modal button.danger, .modal button.primary').last(), 1400)
  await clickSlow(page, page.locator('.panels-button'), 500)
  await glide(page, page.locator('.context-menu .menu-parent', { hasText: 'My layouts' }), { steps: 12 })
  await wait(app, 800)
  await clickSlow(page, page.locator('.context-submenu').getByText('History + Changes').first(), 400)
  await wait(app, 2200)
})

scene('inline-assistant', { wip: false, layout: { dock: FILES_DOCK } }, async (app) => {
  const { page } = app
  await wait(app, 700)
  await clickSlow(page, screenTab(app, 'Files'), 600)
  await clickSlow(page, page.locator('.file-item', { hasText: 'cart.js' }), 900)
  const area = page.locator('.editor-area')
  const line = (n) => ({ x: 360, y: 8 + 19 * (n - 1) + 9 })
  const box = await area.boundingBox()
  for (const n of [2, 7, 12]) {
    await page.mouse.move(box.x + line(n).x, box.y + line(n).y, { steps: 14 })
    await area.click({ position: line(n) })
    await wait(app, 1300)
  }
  // Escreve uma linha nova: o balão passa a dizer que é do usuário, ainda sem salvar.
  await area.click({ position: line(8) })
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('// TODO: round the total', { delay: 55 })
  await wait(app, 1300)
  await page.keyboard.press('Control+s')
  await wait(app, 2000)
})

const scenesToRun = scenes.filter((s) => !only.length || only.includes(s.name))
for (const s of scenesToRun) {
  console.log(s.name)
  const dir = tmp('gif-')
  const app = await newApp({ lang: 'en', host: 'vscode', viewport: VIEWPORT, video: dir, ...s.opts })
  const begin = (Date.now() - app.t0) / 1000
  const video = app.page.video()
  try {
    await s.run(app)
  } finally {
    await app.close()
  }
  const webm = await video.path()
  toGif(webm, join(OUT, `${s.name}.gif`), { start: Math.max(0, begin - 0.4), fps: 8, colors: 72 })
  console.log('  ✓', s.name, execFileSync('du', ['-k', join(OUT, `${s.name}.gif`)]).toString().split('\t')[0] + 'KB')
}
