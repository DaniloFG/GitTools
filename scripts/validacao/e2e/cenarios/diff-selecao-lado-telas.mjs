// #155: a seleção confinada ao lado (DiffView, modo lado a lado) vale em todo diff, não só no History. Este cenário
// confere em Changes (arquivo modificado na pasta de trabalho) e em Compare (duas refs) o que diff-selecao-lado.mjs
// confere no History: tabela dividida, td.code com data-side old/new, lado gravado ao apertar o mouse e seleção
// estendida pela API sem o texto do outro lado. O modo lado a lado vem da configuração diffLayout 'split', salva aqui
// e restaurada no fim, mesmo se um passo falhar. Só leitura: a seleção não grava nada no repositório.
//
// Compare: as duas refs são digitadas nos campos da comparação (main e feature/login), para não depender do que a
// sessão lembra. Os arquivos das duas telas podem continuar montados fora da vista; por isso o painel e a linha são
// procurados só entre os visíveis.

const PAINEL = '.diff-panel'

export default {
  id: 'diff-selecao-lado-telas',
  tela: 'Changes',
  area: 'alteracoes',
  orcamento: { ms: 30000, nos: 5000, erros: 0, git: 0 },
  async passos(app, expect) {
    const config = await app.backend.invoke('app:getSettings', [])
    try {
      await app.backend.invoke('app:saveSettings', [{ ...config, diffLayout: 'split' }])
      await app.page.reload()
      await app.page.locator('.toolbar').waitFor()
      // wip: o demo deixa src/cart.js alterado na pasta de trabalho (uma linha: VIP 0.2 → 0.25).
      await app.repoNovo({ wip: true, nome: 'selecao-telas-e2e' })

      /** Confere o lado a lado do diff visível e a seleção que começa em cada lado. */
      async function conferirLadoAlado(rotulo) {
        // expect.visivel usa querySelectorAll, que não conhece `:visible`: aqui a condição é de elemento desenhado.
        const desenhado = (s) => [...document.querySelectorAll(s)].some((el) => el.getClientRects().length > 0)
        await expect.pagina(desenhado, `${PAINEL} table.diff-split`, `${rotulo}: diff lado a lado na tela`)
        await expect.pagina(desenhado, `${PAINEL} td.code[data-side="old"]`, `${rotulo}: lado antigo na tela`)
        await expect.pagina(desenhado, `${PAINEL} td.code[data-side="new"]`, `${rotulo}: lado novo na tela`)

        const textos = await app.page.evaluate((p) => {
          const painel = [...document.querySelectorAll(p)].find((el) => el.getClientRects().length > 0)
          const velho = painel?.querySelector('td.code.cell-del')
          const novo = velho?.parentElement?.querySelector('td.code.cell-add')
          return velho && novo ? { velho: velho.textContent, novo: novo.textContent, ladoVelho: velho.dataset.side, ladoNovo: novo.dataset.side } : null
        }, PAINEL)
        expect.verdadeiro(textos !== null, `${rotulo}: sem linha com os dois lados alterados no diff`)
        expect.igual([textos.ladoVelho, textos.ladoNovo], ['old', 'new'], `${rotulo}: data-side do lado antigo e do novo`)
        expect.verdadeiro(textos.velho !== textos.novo, `${rotulo}: lados com o mesmo texto: não distingue a seleção`)

        /** Aperta o mouse no lado `origem`, estende a seleção do início de um lado ao fim do outro e devolve o texto. */
        async function selecionarAPartirDe(origem) {
          const sel = origem === 'old' ? 'td.code.cell-del' : 'td.code.cell-add'
          const caixa = await app.page.locator(`${PAINEL}:visible ${sel}`).first().boundingBox()
          await app.page.mouse.move(caixa.x + 8, caixa.y + caixa.height / 2)
          await app.page.mouse.down()
          const texto = await app.page.evaluate((p) => {
            const painel = [...document.querySelectorAll(p)].find((el) => el.getClientRects().length > 0)
            const velho = painel.querySelector('td.code.cell-del').firstChild
            const novo = painel.querySelector('td.code.cell-add').firstChild
            const s = window.getSelection()
            s.setBaseAndExtent(velho, 0, novo, novo.length)
            return s.toString()
          }, PAINEL)
          // O lado gravado fica na tabela que contém a célula de origem (cada bloco do diff é uma tabela própria).
          const lidoDaOrigem = () =>
            app.page.evaluate(([p, s]) => {
              const painel = [...document.querySelectorAll(p)].find((el) => el.getClientRects().length > 0)
              return painel.querySelector(s).closest('table.diff-split')?.getAttribute('data-sel-side') ?? null
            }, [PAINEL, sel])
          const preso = await lidoDaOrigem()
          await app.page.mouse.up()
          const solto = await lidoDaOrigem()
          return { texto, preso, solto }
        }

        const doVelho = await selecionarAPartirDe('old')
        expect.igual(doVelho.preso, 'old', `${rotulo}: lado gravado ao apertar no lado antigo`)
        expect.verdadeiro(doVelho.texto.includes(textos.velho.trim()), `${rotulo}: seleção a partir do lado antigo sem o texto antigo: "${doVelho.texto}"`)
        expect.verdadeiro(!doVelho.texto.includes(textos.novo.trim()), `${rotulo}: seleção a partir do lado antigo vazou para o novo: "${doVelho.texto}"`)
        expect.igual(doVelho.solto, null, `${rotulo}: lado gravado depois de soltar o mouse (antigo)`)

        const doNovo = await selecionarAPartirDe('new')
        expect.igual(doNovo.preso, 'new', `${rotulo}: lado gravado ao apertar no lado novo`)
        expect.verdadeiro(doNovo.texto.includes(textos.novo.trim()), `${rotulo}: seleção a partir do lado novo sem o texto novo: "${doNovo.texto}"`)
        expect.verdadeiro(!doNovo.texto.includes(textos.velho.trim()), `${rotulo}: seleção a partir do lado novo vazou para o antigo: "${doNovo.texto}"`)
        expect.igual(doNovo.solto, null, `${rotulo}: lado gravado depois de soltar o mouse (novo)`)
      }

      // Changes: src/cart.js alterado na pasta de trabalho; o modo lado a lado vem da configuração.
      await app.aba('Changes')
      await expect.visivel('.csection-unstaged .file-item[data-copy="src/cart.js"]', 1)
      await app.page.locator('.csection-unstaged .file-item[data-copy="src/cart.js"]').click()
      await conferirLadoAlado('Changes')

      // Compare: main contra feature/login. Button.tsx foi alterado na branch (duas linhas trocam: a assinatura).
      await app.aba('Compare')
      const campos = app.page.locator('.compare-bar input[list="compare-refs"]')
      await campos.nth(0).fill('main')
      await campos.nth(1).fill('feature/login')
      await campos.nth(1).press('Enter')
      await app.page.locator('.file-item:visible', { hasText: 'Button.tsx' }).first().waitFor()
      await app.page.locator('.file-item:visible', { hasText: 'Button.tsx' }).first().click()
      await conferirLadoAlado('Compare')
    } finally {
      await app.backend.invoke('app:saveSettings', [config])
    }
  }
}
