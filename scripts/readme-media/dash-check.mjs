import { launch } from './harness.mjs'
import { createBigDemo } from './big-demo.mjs'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const out = process.argv[2]
const lang = process.argv[3] ?? 'en'
const dir = process.env.BIG ?? join(mkdtempSync(join(tmpdir(), 'big-')), 'acme-shop')
if (!existsSync(join(dir, '.git'))) createBigDemo(dir)
const app = await launch({ repo: dir, language: lang, host: 'electron', viewport: { width: 1600, height: 1000 }, theme: process.env.THEME ?? 'dark' })
const { page } = app
await page.waitForTimeout(1000)
await page.locator('.dashboards-tab').click()
await page.waitForSelector('.dash-grid', { timeout: 30000 })
await page.waitForTimeout(1500)
const names = ['overview', 'people', 'code', 'cadence', 'governance', 'repository', 'tool']
for (let i = 0; i < names.length; i++) {
  await page.locator('.dash-tab').nth(i).click()
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${out}/dash-${names[i]}.png` })
}
console.log('erros:', app.errors.filter((e) => !/404/.test(e)))
await app.close()
