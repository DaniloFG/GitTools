// #97 / #170: prova de que o `finally` de `regressao-97-telas-ocultas` desfaz o que fez. Os cenários rodam em ordem
// alfabética na mesma página (mesma origem, o localStorage persiste), então este, que vem logo depois, enxerga o que
// o anterior deixou: nenhuma tela escondida, as 7 abas à vista e a janela de volta ao tamanho largo.
const TOTAL_TELAS = 7 // history, changes, files, compare, branches, gitlog, dashboards
export default {
  id: 'regressao-97-z-estado-limpo',
  tela: 'Barra superior',
  area: 'interface',
  orcamento: { ms: 15000, nos: 5000, erros: 0, git: 0 },
  async passos(app, expect) {
    const { page } = app
    await app.aba('History')
    const estado = await page.evaluate(() => {
      const bruto = localStorage.getItem('gittools.layout.pref.screens.hidden')
      return { escondidas: bruto === null ? [] : JSON.parse(bruto), largura: document.documentElement.clientWidth, abas: document.querySelectorAll('.screen-tab').length }
    })
    expect.igual(estado.escondidas, [], 'pref.screens.hidden deveria estar vazia depois do cenário anterior')
    expect.igual(estado.abas, TOTAL_TELAS, 'abas à vista depois do cenário anterior')
    expect.verdadeiro(estado.largura > 640, `a janela deveria ter voltado ao tamanho largo, mas tem ${estado.largura} px`)
  }
}
