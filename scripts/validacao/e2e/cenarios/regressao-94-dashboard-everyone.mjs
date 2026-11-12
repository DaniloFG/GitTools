// #94: a lista do combobox "Everyone" do Dashboard abre acima dos cartões, dentro da janela, com todas as pessoas
// do histórico (o git conta as mesmas) e cada opção clicável: elementFromPoint no centro de cada uma cai na lista.
// Vale na janela grande e numa pequena; o tamanho original da janela volta no fim.
const PEQUENA = { width: 700, height: 420 }

export default {
  id: 'regressao-94-dashboard-everyone',
  tela: 'Dashboard',
  area: 'dashboards',
  orcamento: { ms: 20000, nos: 5000, erros: 0, git: 0 },
  async passos(app, expect) {
    const original = app.page.viewportSize()
    expect.verdadeiro(original !== null, 'a janela deveria ter tamanho')
    // Pessoas do histórico segundo o git (por e-mail, que é como a interface as distingue).
    const emails = new Set((await app.git('log', '--all', '--format=%ae')).split('\n').filter(Boolean).map((e) => e.toLowerCase()))
    expect.verdadeiro(emails.size >= 3, `o exemplo deveria ter ao menos 3 pessoas, o git achou ${emails.size}`)

    async function abrirELer(rotulo) {
      const botao = app.page.locator('.dash-filters .dash-people > button')
      await botao.waitFor()
      await botao.click()
      await app.page.locator('.dash-popover li').first().waitFor()
      const medida = await app.page.evaluate(() => {
        const pop = document.querySelector('.dash-popover')
        const caixa = pop.getBoundingClientRect()
        const opcoes = [...pop.querySelectorAll('li')].map((li) => {
          const r = li.getBoundingClientRect()
          const no = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
          return { nome: li.textContent?.trim() ?? '', largura: r.width, alta: r.height, naLista: !!no && pop.contains(no) }
        })
        return { opcoes, dentro: caixa.top >= 0 && caixa.left >= 0 && caixa.bottom <= window.innerHeight && caixa.right <= window.innerWidth, caixa: [caixa.top, caixa.left, caixa.bottom, caixa.right].map(Math.round) }
      })
      expect.igual(medida.opcoes.length, emails.size, `${rotulo}: pessoas na lista`)
      const cobertas = medida.opcoes.filter((o) => !o.naLista).map((o) => o.nome)
      expect.igual(cobertas, [], `${rotulo}: opções cobertas por outro elemento (elementFromPoint)`)
      expect.verdadeiro(medida.dentro, `${rotulo}: a lista passa da janela ${original.width}x${original.height}: ${JSON.stringify(medida.caixa)}`)
      return medida
    }

    try {
      await app.page.locator('.dashboards-tab').click()
      await abrirELer(`janela ${original.width}x${original.height}`)
      // Clicar numa opção a escolhe: o botão passa a contar a seleção.
      await app.page.locator('.dash-popover li').first().locator('label').click()
      await expect.pagina(() => document.querySelector('.dash-filters .dash-people > button')?.textContent?.startsWith('1 selected'), null, 'botão com "1 selected"')
      await app.page.locator('.dash-popover li').first().locator('label').click()
      await expect.pagina(() => document.querySelector('.dash-filters .dash-people > button')?.textContent?.startsWith('Everyone'), null, 'botão de volta em "Everyone"')
      await app.page.keyboard.press('Escape')
      await app.page.locator('.dash-popover').waitFor({ state: 'detached' })

      await app.page.setViewportSize(PEQUENA)
      await abrirELer(`janela ${PEQUENA.width}x${PEQUENA.height}`)
      await app.page.keyboard.press('Escape')
      await app.page.locator('.dash-popover').waitFor({ state: 'detached' })
    } finally {
      await app.page.setViewportSize(original)
    }
  }
}
