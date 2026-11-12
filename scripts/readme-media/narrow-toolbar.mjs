// Confere (#97) que, em janela estreita, nenhum item da barra superior fica fora da tela: todas as telas (inclusive
// Dashboards) e o menu ⚙ estão dentro da largura, sem rolagem horizontal da página. Sai com código 1 se falhar.
//   npm run build:extension && node scripts/readme-media/narrow-toolbar.mjs
import { newApp } from './lib.mjs'

let failed = false
for (const width of [320, 480, 640]) {
  const app = await newApp({ viewport: { width, height: 700 } })
  const bad = await app.page.evaluate(() => {
    const vw = document.documentElement.clientWidth
    const out = []
    for (const el of document.querySelectorAll('.screen-tab, .toolbar .tb-menu, .toolbar .repo-button')) {
      const r = el.getBoundingClientRect()
      if (r.left < -1 || r.right > vw + 1) out.push(`${el.textContent.trim() || el.className} [${Math.round(r.left)}..${Math.round(r.right)}] > ${vw}`)
    }
    if (document.documentElement.scrollWidth > vw + 1) out.push(`página rola: ${document.documentElement.scrollWidth} > ${vw}`)
    return out
  })
  console.log(width, bad.length ? `FALHA ${bad.join(' | ')}` : 'ok')
  if (bad.length) failed = true
  await app.close?.()
}
process.exit(failed ? 1 : 0)
