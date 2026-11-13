// History: "Open in new window" abre a mesma comparação, com o modo de visualização que o usuário escolheu no diff
// (lado a lado ou cima e baixo). A escolha do menu ⋯ do diff é só da tela (não vai para as configurações), então o
// pedido de janela (`DiffWindowRequest.layout`) tem de levá-la; sem isso a janela lê o padrão das configurações.
// O pedido é capturado no backend (`app:openDiffWindow`), em dois pontos do History: duplo clique na lista de arquivos
// do painel de detalhes (CommitDetails.tsx) e duplo clique na lista de arquivos expandida sob o commit (CommitList.tsx,
// pelo openFileWindow de App.tsx). A janela é conferida navegando a mesma página para `?window=diff` com esse pedido:
// `table.diff-split` aparece com 'split' e não aparece com 'inline'. Arquivo comum (não renomeado). Só leitura.
//
// Electron e extensão do VS Code usam o mesmo pedido (src/main/index.ts openDiffWindow e extension/src/extension.ts
// openDiff repassam o JSON sem interpretar), mas só o host Electron do roteiro e2e é observável aqui: o painel da
// extensão no VS Code real não é conferível neste ambiente.
// Compare, Changes e o histórico de arquivo não passam `layout` (a janela segue lendo as configurações): fora deste cenário.
const MENSAGEM = 'Fix README typos'
const ARQUIVO = 'README.md'
const TEMPO = { timeout: 10_000 }

export default {
  id: 'history-janela-modo',
  tela: 'History',
  area: 'historico',
  orcamento: { ms: 15000, nos: 5000, erros: 0, git: 0 },
  async passos(app, expect) {
    await app.repoNovo({ wip: false, nome: 'janela-modo-e2e' })
    const sha = (await app.git('log', '-1', '--format=%H', `--grep=${MENSAGEM}`)).trim()
    expect.verdadeiro(sha.length === 40, `commit "${MENSAGEM}" não achado no git`)
    const { backend } = app
    const url = app.page.url()

    // O host do roteiro não abre janela: o pedido é capturado aqui, na hora em que a página chama `backend.invoke`.
    const invoke = backend.invoke
    const pedidos = []
    backend.invoke = (canal, args) => {
      if (canal === 'app:openDiffWindow') pedidos.push(args[0])
      return invoke.call(backend, canal, args)
    }

    /** Falhas com o rótulo de cada ponto: a falha diz onde o modo se perdeu. Uma falha não para os outros pontos. */
    const falhas = []
    /** Roda a ação, espera o pedido chegar e confere sha, caminho e modo. Devolve o pedido capturado (null se nenhum chegou). */
    const conferir = async (ponto, modo, acao) => {
      const antes = pedidos.length
      let pedido = null
      try {
        await acao()
        await expect.ate(async () => pedidos.length > antes, `pedido de janela chegar ao backend (${ponto})`)
        pedido = pedidos[pedidos.length - 1]
        expect.igual(pedido?.source?.kind, 'commit', `source.kind (${ponto})`)
        expect.igual(pedido?.source?.sha, sha, `source.sha (${ponto})`)
        expect.igual(pedido?.path, ARQUIVO, `path (${ponto})`)
        expect.igual(pedido?.layout, modo, `layout (${ponto})`)
      } catch (erro) {
        falhas.push(`${ponto}: ${erro.message}`)
      }
      return pedido
    }

    /** Escolhe o modo no menu ⋯ do diff do History e espera a tabela do modo aparecer. */
    const escolher = async (modo) => {
      await app.page.locator('[data-slot="commit.diff"] .view-options-btn').first().click(TEMPO)
      await app.page.locator('.context-menu .menu-item', { hasText: modo === 'split' ? 'Side by side' : 'Top and bottom' }).click(TEMPO)
      await expect.visivel(modo === 'split' ? '[data-slot="commit.diff"] table.diff-split' : '[data-slot="commit.diff"] table.diff-table:not(.diff-split)', 1)
    }

    /** Abre a janela de diff com o pedido (a mesma página, em `?window=diff`) e diz se há a tabela lado a lado. */
    const janelaTemLadoALado = async (pedido) => {
      const janela = new URL(url)
      janela.searchParams.set('window', 'diff')
      janela.searchParams.set('request', JSON.stringify(pedido))
      await app.page.goto(janela.href)
      // Espera o diff da janela chegar (qualquer tabela de diff) antes de olhar o modo.
      await expect.visivel('.diff-window table.diff-table, .diff-window table.diff-split', 1)
      return app.page.evaluate(() => document.querySelectorAll('.diff-window table.diff-split').length > 0)
    }

    try {
      await app.aba('History')
      await expect.visivel('.commit-row', 5)
      await app.page.locator('.commit-row', { hasText: MENSAGEM }).click(TEMPO)
      await expect.pagina((s) => document.querySelector('[data-slot="commit.message"] h3')?.textContent === s, MENSAGEM, 'detalhes do commit')
      await app.page.locator('[data-slot="commit.files"] .file-item', { hasText: ARQUIVO }).first().click(TEMPO)
      await expect.visivel('[data-slot="commit.diff"] .diff-table tr.line-add, [data-slot="commit.diff"] .diff-table tr.line-del', 1)

      const porModo = {}
      for (const modo of ['split', 'inline']) {
        await escolher(modo)
        const painel = await conferir(`CommitDetails.tsx, duplo clique no painel de detalhes, modo ${modo}`, modo, () =>
          app.page.locator('[data-slot="commit.files"] .file-item', { hasText: ARQUIVO }).first().dblclick(TEMPO)
        )
        const menuDoPainel = await conferir(`CommitDetails.tsx, "Open in new window" do menu ⋯ do diff, modo ${modo}`, modo, async () => {
          await app.page.locator('[data-slot="commit.diff"] .view-options-btn').first().click(TEMPO)
          await app.page.locator('.context-menu .menu-parent', { hasText: 'Options' }).hover(TEMPO)
          await app.page.locator('.context-menu .menu-item:not(.menu-parent)', { hasText: 'Open in new window' }).click(TEMPO)
        })
        // Lista de arquivos expandida sob o commit (feita uma vez; a escolha do modo continua valendo no diff do painel).
        if (modo === 'split') {
          await app.page.locator('.commit-row', { hasText: MENSAGEM }).click({ button: 'right', ...TEMPO })
          await app.page.locator('.context-menu .menu-item', { hasText: 'Show the files below the commit' }).click(TEMPO)
          await expect.visivel(`li.commit-file[data-copy="${ARQUIVO}"]`, 1)
        }
        const lista = await conferir(`CommitList.tsx, duplo clique na lista de arquivos do History (openFileWindow de App.tsx), modo ${modo}`, modo, () =>
          app.page.locator(`li.commit-file[data-copy="${ARQUIVO}"]`).dblclick(TEMPO)
        )
        porModo[modo] = painel ?? menuDoPainel ?? lista
      }

      // A janela: a mesma página, com o pedido capturado de cada modo, tem de abrir nesse modo.
      try {
        for (const modo of ['split', 'inline']) {
          if (!porModo[modo]) throw new Error(`nenhum pedido válido capturado no modo ${modo}`)
          const ladoALado = await janelaTemLadoALado(porModo[modo])
          expect.igual(ladoALado, modo === 'split', `janela do diff com table.diff-split (modo ${modo})`)
        }
      } catch (erro) {
        falhas.push(`janela do diff: ${erro.message}`)
      } finally {
        // A página volta ao repositório do roteiro; o runner depende de a tela principal estar de pé ao limpar.
        await app.page.goto(url)
        await expect.visivel('.toolbar', 1)
      }
    } finally {
      backend.invoke = invoke
    }

    if (falhas.length) throw new Error(`modo de visualização perdido em: ${falhas.join(' | ')}`)
  }
}
