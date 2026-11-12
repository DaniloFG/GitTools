// Tour (#98, #171): com `prefers-reduced-motion: reduce` o cartão não anima. Sem a regra de tour.css o cartão entra com
// `tour-in` (0,15 s); por isso o cenário confere o estilo calculado nos dois modos, e a emulação é desfeita no fim.
const CARTAO = '.tour-card'

export default {
  id: 'tour-movimento-reduzido',
  tela: 'Tour',
  area: 'interface',
  orcamento: { ms: 30000, nos: 5000, erros: 0, git: 0 },
  async passos(app, expect) {
    const { page } = app
    const animacao = () => page.locator(CARTAO).evaluate((c) => getComputedStyle(c).animationName)
    const abrir = async () => {
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('gittools:tour')))
      await expect.visivel(CARTAO, 1)
    }
    const fechar = async () => {
      await page.keyboard.press('Escape')
      await expect.ate(async () => (await page.locator(CARTAO).count()) === 0, 'Esc fechar o Tour')
    }
    try {
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await abrir()
      expect.igual(await animacao(), 'tour-in', 'o cartão anima quando o movimento não é reduzido')
      await fechar()

      await page.emulateMedia({ reducedMotion: 'reduce' })
      await abrir()
      expect.igual(await animacao(), 'none', 'o cartão não pode animar com prefers-reduced-motion: reduce')
      await fechar()
    } finally {
      await page.emulateMedia({ reducedMotion: null })
    }
  }
}
