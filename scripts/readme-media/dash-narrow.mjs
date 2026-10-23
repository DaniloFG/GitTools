import { launch } from './harness.mjs'
const out = process.argv[2]
for (const [w, h, lang] of [[1100, 800, 'pt-BR'], [760, 900, 'en']]) {
  const app = await launch({ repo: process.env.BIG, language: lang, host: 'vscode', viewport: { width: w, height: h } })
  await app.page.waitForTimeout(800)
  await app.page.locator('.dashboards-tab').click()
  await app.page.waitForSelector('.dash-grid')
  await app.page.waitForTimeout(1200)
  await app.page.screenshot({ path: `${out}/n-${w}.png` })
  console.log(w, 'erros', app.errors.filter((e) => !/404/.test(e)))
  await app.close()
}
