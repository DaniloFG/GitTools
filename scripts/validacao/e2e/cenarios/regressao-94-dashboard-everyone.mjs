// #94: a lista do combobox "Everyone" do Dashboard abre acima dos cartões, dentro da janela, com todas as pessoas
// do histórico (o git conta as mesmas) e cada opção clicável: elementFromPoint no centro de cada uma cai na lista.
// Vale na janela grande e em três tamanhos que mudam a posição da lista: pequena (700×420), estreita (1000×700, em
// que a lista alinha pela borda direita do botão: classe `end`) e com pouco espaço embaixo (a lista sobe: classe
// `up`). O tamanho original da janela volta no fim.
const PEQUENA = { width: 700, height: 420 }
const ESTREITA = { width: 1000, height: 700 }

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
          // Opção rolada para fora da área da lista (janela baixa): quem a esconde é a rolagem da própria lista, não outro elemento.
          const area = pop.querySelector('ul').getBoundingClientRect()
          const cy = r.top + r.height / 2
          const emVista = cy >= area.top && cy <= area.bottom
          return { nome: li.textContent?.trim() ?? '', emVista, largura: r.width, alta: r.height, naLista: !!no && pop.contains(no) }
        })
        // `up` e `end` são as classes que o componente põe conforme popoverPlacement.ts decidiu a posição.
        return {
          opcoes,
          up: pop.classList.contains('up'),
          end: pop.classList.contains('end'),
          dentro: caixa.top >= 0 && caixa.left >= 0 && caixa.bottom <= window.innerHeight && caixa.right <= window.innerWidth,
          caixa: [caixa.top, caixa.left, caixa.bottom, caixa.right].map(Math.round)
        }
      })
      console.log(`${rotulo}:`, { up: medida.up, end: medida.end, caixa: medida.caixa })
      expect.igual(medida.opcoes.length, emails.size, `${rotulo}: pessoas na lista`)
      expect.verdadeiro(medida.opcoes.some((o) => o.emVista), `${rotulo}: nenhuma opção à vista na lista`)
      const cobertas = medida.opcoes.filter((o) => o.emVista && !o.naLista).map((o) => o.nome)
      expect.igual(cobertas, [], `${rotulo}: opções cobertas por outro elemento (elementFromPoint)`)
      expect.verdadeiro(medida.dentro, `${rotulo}: a lista passa da janela ${app.page.viewportSize().width}x${app.page.viewportSize().height}: ${JSON.stringify(medida.caixa)}`)
      return medida
    }

    async function fechar() {
      await app.page.keyboard.press('Escape')
      await app.page.locator('.dash-popover').waitFor({ state: 'detached' })
    }

    try {
      await app.page.locator('.dashboards-tab').click()
      await abrirELer(`janela ${original.width}x${original.height}`)
      // Clicar numa opção a escolhe: o botão passa a contar a seleção.
      await app.page.locator('.dash-popover li').first().locator('label').click()
      await expect.pagina(() => document.querySelector('.dash-filters .dash-people > button')?.textContent?.startsWith('1 selected'), null, 'botão com "1 selected"')
      await app.page.locator('.dash-popover li').first().locator('label').click()
      await expect.pagina(() => document.querySelector('.dash-filters .dash-people > button')?.textContent?.startsWith('Everyone'), null, 'botão de volta em "Everyone"')
      await fechar()

      await app.page.setViewportSize(PEQUENA)
      await abrirELer(`janela ${PEQUENA.width}x${PEQUENA.height}`)
      await fechar()

      // Janela estreita: a lista não cabe começando no botão, então alinha pela borda direita dele (classe `end`).
      await app.page.setViewportSize(ESTREITA)
      const estreita = await abrirELer(`janela ${ESTREITA.width}x${ESTREITA.height}`)
      expect.igual(estreita.end, true, `janela ${ESTREITA.width}x${ESTREITA.height}: a lista deveria alinhar pela borda direita do botão (classe end)`)
      await fechar()

      // Pouco espaço embaixo: a janela termina 24 px abaixo do botão. Então o espaço de baixo (a janela menos o
      // botão, menos 14 px de folga e margem) fica em 10 px, e o de cima é maior: a lista sobe (classe `up`).
      // A altura sai da posição do botão na largura de teste, e não de um número fixo, porque a posição muda com a
      // largura da janela.
      await app.page.setViewportSize({ width: 1100, height: original.height })
      const botao = await app.page.locator('.dash-filters .dash-people > button').boundingBox()
      expect.verdadeiro(botao !== null, 'o botão de pessoas deveria ter caixa na janela 1100')
      const embaixo = { width: 1100, height: Math.ceil(botao.y + botao.height) + 24 }
      await app.page.setViewportSize(embaixo)
      const sobe = await abrirELer(`janela ${embaixo.width}x${embaixo.height}`)
      expect.igual(sobe.up, true, `janela ${embaixo.width}x${embaixo.height}: a lista deveria subir (classe up) com pouco espaço embaixo`)
      await fechar()
    } finally {
      await app.page.setViewportSize(original)
    }
  }
}
