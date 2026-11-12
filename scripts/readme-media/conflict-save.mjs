import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
// Roteiro da #92: salvar a resolução não pode abrir a modal de três opções nem reler os detalhes. Sai 1 se falhar.
const root = new URL('../..', import.meta.url).pathname
const { newApp } = await import(pathToFileURL(join(root, 'scripts/readme-media/lib.mjs')).href)
const app = await newApp({ lang: 'en', wip: false })
const { page, backend, errors } = app
let failed = false
const check = (n, ok, d = '') => { console.log(`${ok ? 'OK   ' : 'FALHA'} ${n}${d ? ' — ' + d : ''}`); if (!ok) failed = true }
try {
  await page.waitForSelector('.toolbar')
  await app.backend.repo.cherryPickCommits('main', [app.ids.memberPrice])
  await page.waitForTimeout(1500)
  await page.locator('.dock-tab, .screen-tab, button').filter({ hasText: /^Changes$/ }).first().click().catch(() => {})
  await page.waitForTimeout(800)
  const before = (await backend.invoke('app:gitLog', [])).length
  await page.getByRole('button', { name: /Resolve side by side/i }).first().click()
  await page.waitForSelector('.modal')
  await page.waitForTimeout(800)
  await page.locator('.modal button', { hasText: /Keep both|Both/ }).first().click()
  // observa a modal de três opções (.choice-list) a partir do clique em salvar
  await page.evaluate(() => { window.__choice = false; new MutationObserver(() => { if (document.querySelector('.choice-list')) window.__choice = true }).observe(document.body, { childList: true, subtree: true }) })
  const mid = (await backend.invoke('app:gitLog', [])).length
  await page.locator('.modal button.primary').click()
  await page.waitForFunction(() => !document.querySelector('.modal'), null, { timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(1500)
  const after = (await backend.invoke('app:gitLog', [])).length
  const choice = await page.evaluate(() => window.__choice)
  check('modal de três opções não aparece ao salvar', !choice)
  check('arquivo sai da lista', (await page.locator('.conflict-list li').count()) === 0, String(await page.locator('.conflict-list li').count()))
  console.log(`INFO  processos git: salvar+refresh = ${after - mid}`)
  const real = errors.filter((e) => !/status of 404/.test(e))
  check('processos git de salvar+refresh ≤ 5', after - mid <= 5, String(after - mid))
  check('sem erros', real.length === 0, real.join('|'))
} finally { await app.close() }
process.exit(failed ? 1 : 0)
