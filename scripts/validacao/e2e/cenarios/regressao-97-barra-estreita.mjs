// #97: em janela estreita (320, 480 e 640 px) nenhum item da barra superior fica fora da tela (abas das telas,
// inclusive Dashboards, menu ⚙ e botão do repositório), com o History e com o Dashboard abertos, e a página do
// History não ganha rolagem horizontal. A rolagem horizontal do conteúdo do Dashboard a 320 px NÃO é conferida
// aqui: não é a barra (fora do escopo da #97) e hoje ela existe (ver o relatório da Q2). Só leitura; o tamanho
// original da janela volta no fim, mesmo se um passo falhar.
const LARGURAS = [320, 480, 640]
const ALTURA = 700

/** Itens da barra fora da largura da janela e, com `conferirRolagem`, rolagem horizontal da página (a régua de narrow-toolbar.mjs). */
function foraDaTela(conferirRolagem) {
  const vw = document.documentElement.clientWidth
  const fora = []
  for (const el of document.querySelectorAll('.screen-tab, .toolbar .tb-menu, .toolbar .repo-button')) {
    const r = el.getBoundingClientRect()
    if (r.left < -1 || r.right > vw + 1) fora.push(`${el.textContent.trim() || el.className} [${Math.round(r.left)}..${Math.round(r.right)}] > ${vw}`)
  }
  if (conferirRolagem && document.documentElement.scrollWidth > vw + 1) fora.push(`página rola: ${document.documentElement.scrollWidth} > ${vw}`)
  return { vw, itens: document.querySelectorAll('.screen-tab, .toolbar .tb-menu, .toolbar .repo-button').length, fora }
}

export default {
  id: 'regressao-97-barra-estreita',
  tela: 'Barra superior',
  area: 'interface',
  orcamento: { ms: 20000, nos: 5000, erros: 0, git: 0 },
  async passos(app, expect) {
    const original = app.page.viewportSize()
    expect.verdadeiro(original !== null, 'a janela deveria ter tamanho')
    try {
      for (const tela of ['History', 'Dashboard']) {
        if (tela === 'History') await app.aba('History')
        else await app.page.locator('.dashboards-tab').click()
        for (const largura of LARGURAS) {
          await app.page.setViewportSize({ width: largura, height: ALTURA })
          await expect.pagina((w) => document.documentElement.clientWidth === w, largura, `janela com ${largura} px`)
          // A barra se reorganiza ao medir a janela: espera duas leituras iguais seguidas (layout assentado) e confere a última.
          let anterior = ''
          const medida = await expect.ate(async () => {
            const atual = await app.page.evaluate(foraDaTela, tela === 'History')
            const texto = JSON.stringify(atual)
            const assentou = texto === anterior
            anterior = texto
            return assentou ? atual : null
          }, `barra assentada em ${largura} px (${tela})`)
          // Os itens existem (a régua não pode passar por não achar nada): repo, menu ⚙ e as abas.
          expect.verdadeiro(medida.itens >= 8, `${tela} a ${largura} px: a barra deveria ter ao menos 8 itens medidos, tinha ${medida.itens}`)
          expect.igual(medida.fora, [], `${tela} a ${largura} px: itens da barra fora da tela`)
        }
      }
    } finally {
      await app.page.setViewportSize(original)
    }
  }
}
