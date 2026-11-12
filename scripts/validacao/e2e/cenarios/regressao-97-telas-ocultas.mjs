// #97 (parte do menu Aparência, #56): com telas escondidas pelo usuário (⚙ → Aparência → Screens) a barra mostra só
// as que sobraram, a tela aberta continua à vista mesmo marcada como escondida, e nada fica fora da janela nem
// ganha rolagem horizontal em 320, 480 e 640 px. As escolhas são feitas pelo menu de verdade e desfeitas no fim
// (e o tamanho original da janela volta), mesmo se um passo falhar.
const LARGURAS = [320, 480, 640]
const ESCONDER = ['Changes', 'Files', 'Compare']
const TOTAL_TELAS = 7 // history, changes, files, compare, branches, gitlog, dashboards

/** Abas à vista, as que estão fora da largura da janela e a rolagem horizontal da página. */
function medirBarra() {
  const vw = document.documentElement.clientWidth
  const abas = [...document.querySelectorAll('.screen-tab')]
  const fora = []
  for (const el of document.querySelectorAll('.screen-tab, .toolbar .tb-menu, .toolbar .repo-button')) {
    const r = el.getBoundingClientRect()
    if (r.left < -1 || r.right > vw + 1) fora.push(`${el.textContent.trim() || el.className} [${Math.round(r.left)}..${Math.round(r.right)}] > ${vw}`)
  }
  if (document.documentElement.scrollWidth > vw + 1) fora.push(`página rola: ${document.documentElement.scrollWidth} > ${vw}`)
  return { total: abas.length, textos: abas.map((a) => a.textContent.trim()), fora }
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
    } finally {
      await page.setViewportSize(original)
      for (const nome of [...alternados].reverse()) await alternar(nome).catch(() => {})
    }
  }
}
