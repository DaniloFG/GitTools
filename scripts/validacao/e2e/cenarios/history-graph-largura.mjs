// #271: a alça de largura da coluna Graph no History. Arrastar a borda do cabeçalho do Graph (a borda virada para o
// assunto, que é a da direita em en) para a direita aumenta a coluna em ~100 px; a coluna Graph continua a primeira;
// o duplo clique na alça volta à largura automática, a de partida. A medida é do DOM (getBoundingClientRect), e a
// espera é por condição, não por tempo fixo. O layout gravado (history.graphWidth) é zerado no fim, mesmo se um passo
// falhar, para que o cenário seguinte não herde uma largura escolhida aqui.
const TOLERANCIA = 2
const ARRASTE = 100
const ALCA = '.commit-graph-head .column-resize'

/** Largura atual do cabeçalho do Graph, em pixel inteiro. 0 quando o cabeçalho ainda não existe. */
function larguraGraph() {
  const el = document.querySelector('.commit-graph-head')
  return el ? Math.round(el.getBoundingClientRect().width) : 0
}

/** Centro da alça na página (o arrasto começa nele). */
function centroDaAlca() {
  const el = document.querySelector('.commit-graph-head .column-resize')
  if (!el) return null
  const b = el.getBoundingClientRect()
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

export default {
  id: 'history-graph-largura',
  tela: 'History',
  area: 'historico',
  orcamento: { ms: 30000, nos: 5000, erros: 0, git: 0 },
  async passos(app, expect) {
    await app.aba('History')
    await expect.visivel('.commit-row', 5)
    await expect.visivel(ALCA, 1)

    try {
      // Largura de partida: automática. Espera o layout assentar (duas leituras iguais seguidas), porque o Graph
      // automático depende das trilhas das linhas carregadas.
      let anterior = null
      const inicial = await expect.ate(async () => {
        const atual = await app.page.evaluate(larguraGraph)
        const assentou = atual === anterior
        anterior = atual
        return assentou ? atual : null
      }, 'largura inicial do Graph assentada')

      // O Graph é a primeira coluna: o cabeçalho dele é o primeiro depois da alça de linha e o mais à esquerda.
      const primeiraColuna = await app.page.evaluate(() => {
        const cabecalhos = [...document.querySelectorAll('.commit-columns .commit-column-head')]
        const graph = cabecalhos.find((h) => h.dataset.reorderId === 'graph')
        if (!graph) return 'sem cabeçalho do Graph'
        const esquerda = graph.getBoundingClientRect().left
        const maisAEsquerda = cabecalhos.every((h) => h.getBoundingClientRect().left >= esquerda)
        return cabecalhos[0] === graph && maisAEsquerda ? 'graph' : `primeira coluna é ${cabecalhos[0]?.dataset.reorderId}`
      })
      expect.igual(primeiraColuna, 'graph', 'Graph é a primeira coluna antes do arrasto')

      // Arrasto para a direita: a alça fica na borda do Graph virada para o assunto, então dx positivo aumenta a coluna.
      const caixa = await app.page.evaluate(centroDaAlca)
      expect.verdadeiro(caixa !== null, 'alça do Graph não encontrada no cabeçalho')
      await app.page.mouse.move(caixa.x, caixa.y)
      await app.page.mouse.down()
      for (let i = 1; i <= 10; i++) await app.page.mouse.move(caixa.x + (ARRASTE * i) / 10, caixa.y)
      await app.page.mouse.up()

      // O cabeçalho chega à largura nova (espera por condição, com a tolerância do pedido).
      await expect.pagina(
        (s) => {
          const el = document.querySelector('.commit-graph-head')
          return el !== null && Math.abs(Math.round(el.getBoundingClientRect().width) - s.alvo) <= s.tolerancia
        },
        { alvo: inicial + ARRASTE, tolerancia: TOLERANCIA },
        `Graph com cerca de ${inicial + ARRASTE} px depois de arrastar ${ARRASTE} px`
      )
      const depois = await app.page.evaluate(larguraGraph)
      expect.verdadeiro(
        Math.abs(depois - (inicial + ARRASTE)) <= TOLERANCIA,
        `arrastar ${ARRASTE} px tinha de dar ${inicial + ARRASTE} px (±${TOLERANCIA}), deu ${depois} px (partida ${inicial} px)`
      )
      const primeiraDepois = await app.page.evaluate(() => document.querySelector('.commit-columns .commit-column-head')?.dataset.reorderId)
      expect.igual(primeiraDepois, 'graph', 'Graph continua a primeira coluna depois do arrasto')

      // Duplo clique na alça: volta à largura automática, a de partida.
      await app.page.locator(ALCA).dblclick()
      await expect.pagina((s) => {
        const el = document.querySelector('.commit-graph-head')
        return el !== null && Math.round(el.getBoundingClientRect().width) === s
      }, inicial, `Graph de volta à largura automática (${inicial} px) depois do duplo clique`)
      const restaurado = await app.page.evaluate(larguraGraph)
      expect.igual(restaurado, inicial, 'largura depois do duplo clique na alça')
    } finally {
      // Solta o botão se um passo falhou no meio do arrasto, e zera a preferência gravada (duplo clique = automática).
      await app.page.mouse.up().catch(() => undefined)
      await app.page.locator(ALCA).dblclick().catch(() => undefined)
    }
  }
}
