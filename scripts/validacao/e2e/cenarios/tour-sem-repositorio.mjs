// Tour (#98, #171): sem repositório aberto o passeio funciona só com os passos que ficam à vista (App.tsx, `noView`):
// abre pelo mesmo evento de Configurações → Tour, anda até o fim e fecha com Esc, sem nenhum processo git.
// O repositório do roteiro é fechado no backend e reaberto no fim, mesmo se um passo falhar.
const CARTAO = '.tour-card'
const progresso = (page) => page.locator(`${CARTAO} .tour-head .small`).innerText().then((t) => (t.match(/\d+/g) ?? []).map(Number))

export default {
  id: 'tour-sem-repositorio',
  tela: 'Tour',
  area: 'interface',
  orcamento: { ms: 30000, nos: 5000, erros: 0, git: 0 },
  async passos(app, expect) {
    const { page, backend, dir } = app
    try {
      await backend.invoke('app:closeRepository', [dir])
      await page.reload()
      await page.waitForSelector('#root > *', { timeout: 15000 })
      await expect.ate(async () => (await page.locator('.screen-tab').count()) === 0 && (await page.locator('.toolbar .repo-button').count()) === 0, 'a tela sem repositório aparecer')
      expect.igual(await page.locator('.screen-tab').count(), 0, 'ainda há repositório aberto (abas de tela à vista)')

      await page.evaluate(() => window.dispatchEvent(new CustomEvent('gittools:tour')))
      await expect.visivel(CARTAO, 1)
      const [, total] = await progresso(page)
      expect.verdadeiro(total >= 2, `o Tour sem repositório devia ter passos: ${total}`)
      for (let i = 1; i < total; i++) {
        await page.keyboard.press('ArrowRight')
        await expect.ate(async () => (await progresso(page))[0] === i + 1, `chegar ao passo ${i + 1} de ${total}`)
      }
      await page.keyboard.press('Escape')
      await expect.ate(async () => (await page.locator(CARTAO).count()) === 0, 'Esc fechar o Tour sem repositório')
    } finally {
      await backend.invoke('app:openRepository', [dir])
      await page.reload()
      await page.waitForSelector('.screen-tab', { timeout: 15000 })
    }
  }
}
