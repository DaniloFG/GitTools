// #97 (parte do menu Aparência, #56): com telas escondidas pelo usuário (⚙ → Aparência → Screens) a barra mostra só
// as que sobraram, a tela aberta continua à vista mesmo marcada como escondida, e nada fica fora da janela nem
// ganha rolagem horizontal em 320, 480 e 640 px. As escolhas são feitas pelo menu de verdade e desfeitas no fim
// (e o tamanho original da janela volta), mesmo se um passo falhar.
const LARGURAS = [320, 480, 640]
const ESCONDER = ['Changes', 'Files', 'Compare']
const TOTAL_TELAS = 7 // history, changes, files, compare, branches, gitlog, dashboards
const CHAVE_DOCK = 'gittools.layout.dock'

/** Arranjo do History: o painel dos detalhes do commit à direita ou embaixo da lista (#97: a barra estreita com cada posição). */
const arranjo = (dir) => ({
  version: 2, hidden: [], pinned: {}, screenSizes: {},
  root: {
    kind: 'split', id: 'e2e-raiz', dir, sizes: [0.55, 0.45],
    children: [
      { kind: 'group', id: 'e2e-lista', views: ['history'], active: 'history' },
      { kind: 'group', id: 'e2e-detalhe', views: ['commit.message', 'commit.files', 'commit.diff'], active: 'commit.message' }
    ]
  }
})
const POSICOES = [['direita', 'row'], ['embaixo', 'column']]

/** Abas à vista, as que estão fora da largura da janela e a rolagem horizontal da página. */
function medirBarra() {
  const vw = document.documentElement.clientWidth
  const abas = [...document.querySelectorAll('.screen-tab')]
  const fora = []
  // O alerta de conflito (.operation-banner.has-conflicts) e o botão .wip-open (#140) também não podem passar da janela.
  for (const el of document.querySelectorAll('.screen-tab, .toolbar .tb-menu, .toolbar .repo-button, .operation-banner *, .wip-open')) {
    const r = el.getBoundingClientRect()
    if (r.left < -1 || r.right > vw + 1) fora.push(`${el.textContent.trim() || el.className} [${Math.round(r.left)}..${Math.round(r.right)}] > ${vw}`)
  }
  if (document.documentElement.scrollWidth > vw + 1) fora.push(`página rola: ${document.documentElement.scrollWidth} > ${vw}`)
  return { conflito: !!document.querySelector('.operation-banner.has-conflicts'), total: abas.length, textos: abas.map((a) => a.textContent.trim()), fora }
}

export default {
  id: 'regressao-97-telas-ocultas',
  tela: 'Barra superior',
  area: 'interface',
  orcamento: { ms: 30000, nos: 5000, erros: 0, git: 0 },
  async passos(app, expect) {
    const { page } = app
    const original = page.viewportSize()
    expect.verdadeiro(original !== null, 'a janela deveria ter tamanho')
    const alternados = []

    /** Liga ou desliga uma tela pelo menu ⚙ → Appearance → Screens. */
    async function alternar(nome) {
      await page.locator('.toolbar .tb-menu').click({ timeout: 10_000 })
      await page.locator('.context-menu button').filter({ hasText: /^Appearance/ }).hover()
      await page.locator('.context-menu button').filter({ hasText: /^Screens/ }).hover()
      await page.locator('.context-menu button').filter({ hasText: new RegExp(`^\\s*[✓]?\\s*${nome}$`) }).click({ timeout: 10_000 })
      alternados.push(nome)
    }

    /** Mede a barra e o alerta nas três larguras, com duas leituras iguais seguidas (layout assentado). */
    async function conferirLarguras(rotulo, exigeConflito) {
      for (const largura of LARGURAS) {
        await page.setViewportSize({ width: largura, height: 700 })
        await expect.pagina((w) => document.documentElement.clientWidth === w, largura, `janela com ${largura} px`)
        let anterior = ''
        const m = await expect.ate(async () => {
          const atual = await page.evaluate(medirBarra)
          const texto = JSON.stringify(atual)
          const assentou = texto === anterior
          anterior = texto
          return assentou ? atual : null
        }, `barra assentada em ${largura} px (${rotulo})`)
        expect.igual(m.total, TOTAL_TELAS - ESCONDER.length, `${rotulo} ${largura} px: abas à vista`)
        if (exigeConflito) expect.verdadeiro(m.conflito, `${rotulo} ${largura} px: o alerta vermelho de conflito deveria estar na tela`)
        expect.igual(m.fora, [], `${rotulo} ${largura} px: itens fora da tela ou rolagem horizontal`)
      }
    }

    try {
      await app.aba('History')
      for (const nome of ESCONDER) await alternar(nome)
      // As escondidas somem da barra; a que está aberta (History) fica.
      let medida = await expect.ate(async () => {
        const m = await page.evaluate(medirBarra)
        return m.total === TOTAL_TELAS - ESCONDER.length ? m : null
      }, `a barra ficar com ${TOTAL_TELAS - ESCONDER.length} telas depois de esconder ${ESCONDER.join(', ')}`)
      for (const nome of ESCONDER) expect.verdadeiro(!medida.textos.some((t) => t.includes(nome)), `"${nome}" deveria estar escondida, abas: ${medida.textos.join(' | ')}`)
      expect.verdadeiro(medida.textos.some((t) => t.includes('History')), 'a tela aberta (History) deveria continuar à vista')

      // Esconder a própria tela aberta: ela continua à vista até trocar de tela.
      await alternar('History')
      medida = await page.evaluate(medirBarra)
      expect.verdadeiro(medida.textos.some((t) => t.includes('History')), 'a tela aberta, mesmo marcada como escondida, deveria continuar à vista')
      expect.igual(medida.total, TOTAL_TELAS - ESCONDER.length, 'abas à vista com a tela aberta escondida')

      for (const largura of LARGURAS) {
        await page.setViewportSize({ width: largura, height: 700 })
        await expect.pagina((w) => document.documentElement.clientWidth === w, largura, `janela com ${largura} px`)
        // O layout se reorganiza ao medir: duas leituras iguais seguidas e confere a última.
        let anterior = ''
        const m = await expect.ate(async () => {
          const atual = await page.evaluate(medirBarra)
          const texto = JSON.stringify(atual)
          const assentou = texto === anterior
          anterior = texto
          return assentou ? atual : null
        }, `barra assentada em ${largura} px`)
        expect.igual(m.total, TOTAL_TELAS - ESCONDER.length, `${largura} px: abas à vista`)
        expect.igual(m.fora, [], `${largura} px: itens fora da tela ou rolagem horizontal`)
      }

      // Painel à direita e embaixo, com o repositório parado num cherry-pick em conflito (alerta vermelho).
      await page.setViewportSize(original)
      for (const [nome, dir] of POSICOES) {
        await page.evaluate(([chave, dock]) => localStorage.setItem(chave, JSON.stringify(dock)), [CHAVE_DOCK, arranjo(dir)])
        await app.repoNovo({
          wip: false,
          nome: `ocultas-${nome}-e2e`,
          async preparar({ ids }) {
            await app.git('cherry-pick', ids.memberPrice).then(
              () => { throw new Error('o cherry-pick deveria parar em conflito') },
              (erro) => { if (erro.code !== 1) throw erro }
            )
          }
        })
        await app.aba('History')
        await expect.visivel('.operation-banner.has-conflicts', 1)
        await conferirLarguras(`painel ${nome}`, true)
        await page.setViewportSize(original)
      }
    } finally {
      await page.evaluate((chave) => localStorage.removeItem(chave), CHAVE_DOCK).catch(() => {})
      await page.setViewportSize(original)
      for (const nome of [...alternados].reverse()) await alternar(nome).catch(() => {})
    }
  }
}
