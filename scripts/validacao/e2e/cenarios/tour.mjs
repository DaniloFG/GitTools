// Tour (#98): o passeio guiado abre pelo mesmo evento do botão em Configurações → Tour, prende o foco no cartão,
// destaca um alvo que está dentro da janela, anda com as setas, abre a tela de cada passo, sai com Esc devolvendo o
// foco e a tela de antes, e chega ao cartão final. O Tour só mostra: o orçamento exige zero processos git.
const CARTAO = '.tour-card'

/** Progresso do cartão ("3 / 20" no idioma da partida): só os números, na ordem em que aparecem. */
const progresso = (page) => page.locator(`${CARTAO} .tour-head .small`).innerText().then((t) => (t.match(/\d+/g) ?? []).map(Number))

export default {
  id: 'tour',
  tela: 'Tour',
  area: 'interface',
  orcamento: { ms: 30000, nos: 5000, erros: 0, git: 0 },
  async passos(app, expect) {
    const { page } = app
    const abrir = async () => {
      await page.locator('.toolbar .tb-menu').focus()
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('gittools:tour')))
      await expect.visivel(CARTAO, 1)
    }
    const aberto = () => page.locator(CARTAO).count()

    await app.aba('History')
    await abrir()

    // Foco preso no cartão e o cartão é um diálogo modal rotulado.
    await expect.pagina(() => document.querySelector('.tour-card')?.contains(document.activeElement), null, 'o foco ir para o cartão do Tour')
    expect.igual(await page.locator(CARTAO).getAttribute('role'), 'dialog', 'papel do cartão')
    expect.igual(await page.locator(CARTAO).getAttribute('aria-modal'), 'true', 'cartão modal')
    // Tab circula só dentro do cartão.
    for (let i = 0; i < 8; i++) await page.keyboard.press('Tab')
    expect.verdadeiro(await page.evaluate(() => document.querySelector('.tour-card')?.contains(document.activeElement)), 'Tab deixou o foco sair do cartão')

    // O destaque aparece e fica dentro da janela.
    await expect.pagina(() => { const s = document.querySelector('.tour-spot'); return s && !s.hidden }, null, 'o destaque aparecer')
    const dentro = () => page.evaluate(() => {
      const r = document.querySelector('.tour-spot').getBoundingClientRect()
      const c = document.querySelector('.tour-card').getBoundingClientRect()
      const w = document.documentElement.clientWidth, h = document.documentElement.clientHeight
      return [r, c].every((b) => b.width > 0 && b.height > 0 && b.left >= -1 && b.top >= -1 && b.right <= w + 1 && b.bottom <= h + 1)
    })
    expect.verdadeiro(await dentro(), 'destaque ou cartão fora da janela no primeiro passo')

    // Setas: avança e volta; cada passo andado muda o progresso.
    const inicio = await progresso(page)
    expect.verdadeiro(inicio.length === 2 && inicio[1] > 5, `progresso inesperado: ${inicio}`)
    await page.keyboard.press('ArrowRight')
    const depois = await expect.ate(async () => { const p = await progresso(page); return p[0] !== inicio[0] ? p : null }, 'ArrowRight avançar o passo')
    await page.keyboard.press('ArrowLeft')
    await expect.ate(async () => (await progresso(page))[0] === inicio[0], 'ArrowLeft voltar ao passo anterior')
    expect.verdadeiro(depois[0] !== inicio[0], 'o progresso não mudou')

    // Anda até os passos de tela: abrir uma tela pelo Tour é só trocar de aba, sem git.
    for (let i = 0; i < inicio[1] && (await page.locator(`${CARTAO}[data-centered]`).count()) === 0; i++) {
      await page.keyboard.press('ArrowRight')
      await expect.ate(async () => (await page.locator('.tour-spot').evaluate((s) => !s.hidden).catch(() => false)) || (await page.locator(`${CARTAO}[data-centered]`).count()) > 0, 'o passo ser mostrado')
      if ((await page.locator(`${CARTAO}[data-centered]`).count()) === 0) expect.verdadeiro(await dentro(), `destaque ou cartão fora da janela no passo ${(await progresso(page))[0]}`)
    }
    // Cartão final (centralizado) ou, sem nada a contar, o Tour já fechou sozinho.

    // Esc fecha, e o foco volta a quem abriu.
    if (await aberto()) await page.keyboard.press('Escape')
    await expect.ate(async () => (await aberto()) === 0, 'Esc fechar o Tour')
    expect.verdadeiro(await page.evaluate(() => document.activeElement?.classList.contains('tb-menu')), 'o foco não voltou ao botão que abriu o Tour')
    expect.igual(await page.locator('.tour-overlay').count(), 0, 'sobra do Tour na tela')

    // Esc também sai no meio do passeio.
    await abrir()
    await page.keyboard.press('Escape')
    await expect.ate(async () => (await aberto()) === 0, 'Esc fechar o Tour no primeiro passo')
  }
}
