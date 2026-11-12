// Diff lado a lado: apertar o mouse num lado confina a seleção àquele lado (antigo ou novo); a cópia não mistura os
// dois. Só leitura. Reprova se o outro lado voltar a entrar na seleção.
//
// O arraste real do Playwright não serve de prova aqui: o caret cai fora do lugar nas células do diff e a seleção
// não estende (também sem a mudança), então o cenário aperta o mouse de verdade (é isso que grava o lado) e
// estende a seleção pela API, do início de um lado ao fim do outro. O texto que o navegador devolve ignora o lado
// com `user-select: none`, que é o que a cópia (Ctrl+C) usa.

export default {
  id: 'diff-selecao-lado',
  tela: 'History',
  area: 'historico',
  orcamento: { ms: 15000, nos: 5000, erros: 0, git: 0 },
  async passos(app, expect) {
    await app.repoNovo({ wip: false, nome: 'selecao-lado-e2e' })
    await app.aba('History')
    await expect.visivel('.commit-row', 5)
    await app.page.locator('.commit-row', { hasText: 'Fix README typos' }).click()
    await expect.pagina((s) => document.querySelector('[data-slot="commit.message"] h3')?.textContent === s, 'Fix README typos', 'detalhes do commit')
    await app.page.locator('[data-slot="commit.files"] .file-item', { hasText: 'README.md' }).first().click()
    await expect.visivel('[data-slot="commit.diff"] .diff-table tr.line-add, [data-slot="commit.diff"] .diff-table tr.line-del', 1)

    // Muda para lado a lado pelo menu ⋯ do diff.
    await app.page.locator('[data-slot="commit.diff"] .view-options-btn').first().click()
    await app.page.locator('.context-menu .menu-item', { hasText: 'Side by side' }).click()
    await expect.visivel('[data-slot="commit.diff"] table.diff-split', 1)

    const textos = await app.page.evaluate(() => {
      const velho = document.querySelector('[data-slot="commit.diff"] td.code.cell-del')
      const novo = velho?.parentElement?.querySelector('td.code.cell-add')
      return velho && novo ? { velho: velho.textContent, novo: novo.textContent } : null
    })
    expect.verdadeiro(textos !== null, 'sem linha com os dois lados alterados no diff do README')
    expect.verdadeiro(textos.velho !== textos.novo, 'lados com o mesmo texto: não distingue a seleção')

    /** Aperta o mouse no lado `origem`, estende a seleção do início de um lado ao fim do outro e devolve o texto. */
    async function selecionarAPartirDe(origem) {
      const sel = origem === 'old' ? 'td.code.cell-del' : 'td.code.cell-add'
      const caixa = await app.page.locator(`[data-slot="commit.diff"] ${sel}`).first().boundingBox()
      await app.page.mouse.move(caixa.x + 8, caixa.y + caixa.height / 2)
      await app.page.mouse.down()
      const texto = await app.page.evaluate(() => {
        const velho = document.querySelector('[data-slot="commit.diff"] td.code.cell-del').firstChild
        const novo = document.querySelector('[data-slot="commit.diff"] td.code.cell-add').firstChild
        const s = window.getSelection()
        s.setBaseAndExtent(velho, 0, novo, novo.length)
        return s.toString()
      })
      const preso = await app.page.evaluate(() => document.querySelector('[data-slot="commit.diff"] table.diff-split')?.getAttribute('data-sel-side'))
      await app.page.mouse.up()
      const solto = await app.page.evaluate(() => document.querySelector('[data-slot="commit.diff"] table.diff-split')?.getAttribute('data-sel-side') ?? null)
      return { texto, preso, solto }
    }

    const doVelho = await selecionarAPartirDe('old')
    expect.igual(doVelho.preso, 'old', 'lado gravado ao apertar no lado antigo')
    expect.verdadeiro(doVelho.texto.includes(textos.velho.trim()), `seleção a partir do lado antigo sem o texto antigo: "${doVelho.texto}"`)
    expect.verdadeiro(!doVelho.texto.includes(textos.novo.trim()), `seleção a partir do lado antigo vazou para o novo: "${doVelho.texto}"`)
    expect.igual(doVelho.solto, null, 'lado gravado depois de soltar o mouse')

    const doNovo = await selecionarAPartirDe('new')
    expect.igual(doNovo.preso, 'new', 'lado gravado ao apertar no lado novo')
    expect.verdadeiro(doNovo.texto.includes(textos.novo.trim()), `seleção a partir do lado novo sem o texto novo: "${doNovo.texto}"`)
    expect.verdadeiro(!doNovo.texto.includes(textos.velho.trim()), `seleção a partir do lado novo vazou para o antigo: "${doNovo.texto}"`)
    expect.igual(doNovo.solto, null, 'lado gravado depois de soltar o mouse')
  }
}
