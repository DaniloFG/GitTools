// Confere (#98) o Tour na interface de verdade: percorre os passos com repositório em 320/480/640/1280 px, em claro e
// escuro e em RTL, e checa que o cartão e o destaque ficam dentro da janela, que o cartão não cobre o alvo (fora da
// faixa do rodapé), que não há erro de console e que o Tour aberto soma poucos nós ao DOM. Sai com 1 se falhar.
//   npm run build:extension && node scripts/readme-media/tour.mjs
import { newApp } from './lib.mjs'

let failed = false
const fail = (msg) => {
  failed = true
  console.log('  FALHA', msg)
}

for (const [width, height, lang, theme] of [[1280, 800, 'en', 'dark'], [640, 700, 'en', 'light'], [480, 700, 'pt-BR', 'dark'], [320, 700, 'ar', 'light']]) {
  const app = await newApp({ viewport: { width, height }, lang })
  const errors = []
  app.page.on('console', (m) => m.type() === 'error' && !m.location().url.endsWith('/favicon.ico') && errors.push(m.text()))
  app.page.on('pageerror', (e) => errors.push(String(e)))
  await app.page.emulateMedia({ colorScheme: theme })
  const before = await app.page.evaluate(() => document.querySelectorAll('*').length)
  await app.page.evaluate(() => window.dispatchEvent(new CustomEvent('gittools:tour')))
  await app.page.waitForSelector('.tour-card', { timeout: 5000 }).catch(() => fail(`${width}: o cartão não abriu`))
  const opened = await app.page.evaluate(() => document.querySelectorAll('*').length)
  console.log(`${width}x${height} ${lang} ${theme}: nós ${before} → ${opened} (+${opened - before})`)
  if (opened - before > 20 + 40) fail(`${width}: Tour soma ${opened - before} nós (meta: até 20, mais o texto)`)
  let steps = 0
  for (let i = 0; i < 30; i++) {
    const card = app.page.locator('.tour-card')
    if (!(await card.count())) break
    await app.page.waitForTimeout(120)
    const info = await app.page.evaluate((width) => {
      const vw = document.documentElement.clientWidth
      const vh = document.documentElement.clientHeight
      const c = document.querySelector('.tour-card')?.getBoundingClientRect()
      const s = document.querySelector('.tour-spot')
      const sr = s && !s.hidden ? s.getBoundingClientRect() : null
      const out = []
      if (c && (c.left < -1 || c.top < -1 || c.right > vw + 1 || c.bottom > vh + 1)) out.push(`cartão fora [${Math.round(c.left)},${Math.round(c.top)},${Math.round(c.right)},${Math.round(c.bottom)}] em ${vw}x${vh}`)
      if (c && sr && width > 640) {
        const overlap = Math.min(c.right, sr.right) - Math.max(c.left, sr.left) > 1 && Math.min(c.bottom, sr.bottom) - Math.max(c.top, sr.top) > 1
        if (overlap) out.push('cartão cobre o destaque')
      }
      if (document.documentElement.scrollWidth > vw + 1) out.push('página rola na horizontal')
      return { out, text: document.querySelector('.tour-body')?.textContent ?? '' }
    }, width)
    steps++
    for (const o of info.out) fail(`${width} passo ${steps}: ${o}`)
    const next = app.page.locator('.tour-actions button.primary')
    await next.click()
  }
  const after = await app.page.evaluate(() => document.querySelectorAll('*').length)
  const leftover = await app.page.evaluate(() => document.querySelectorAll('[class*="tour-"]').length)
  console.log(`  ${steps} cartões vistos; nós depois de fechar ${after} (antes ${before}); erros de console ${errors.length}`)
  if (steps < 3) fail(`${width}: só ${steps} cartões`)
  // O resto da diferença é o sprite de ícones e o link do chunk, carregados ao abrir as telas (conferido por diferença de tags).
  if (leftover) fail(`${width}: Tour fechado deixou ${leftover} nós tour-*`)
  for (const e of errors) fail(`console: ${e}`)
  await app.close?.()
}
process.exit(failed ? 1 : 0)
