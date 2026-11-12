// History: abrir em nova janela o diff de um arquivo renomeado (um commit que renomeia e muda uma linha) leva o caminho
// antigo no pedido (`source.oldPath`), em cada ponto que abre a janela: duplo clique e menu do painel de detalhes
// (CommitDetails.tsx:167) e duplo clique e menu da lista de arquivos expandida no History (CommitList.tsx:912 e :871,
// pelo openFileWindow de App.tsx). O pedido é capturado no backend; a janela é conferida navegando a mesma página para
// `?window=diff`, e tem de mostrar só a linha trocada (+1 −1). Sem o oldPath o git mostra o arquivo inteiro como novo.
// Só leitura na interface. Reprova listando cada ponto que perdeu o oldPath.
import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const MENSAGEM = 'Renomeia o arquivo e muda uma linha e2e'
const ANTIGO = 'renomeio-antigo.txt'
const NOVO = 'renomeio-novo.txt'
const LINHAS = ['um', 'dois', 'tres', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez']
const texto = (itens) => itens.map((l) => `${l}\n`).join('')
const TEMPO = { timeout: 10_000 }

export default {
  id: 'history-renomeacao-diff',
  tela: 'History',
  area: 'historico',
  orcamento: { ms: 15000, nos: 5000, erros: 0, git: 0 },
  async passos(app, expect) {
    await app.repoNovo({
      wip: false,
      nome: 'renomeacao-e2e',
      // O commit de renomeação (uma linha mudada) é criado antes de a interface ler o repositório.
      async preparar({ dir }) {
        const identidade = ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com']
        const git = (...args) => execFileAsync('git', [...identidade, ...args], { cwd: dir })
        await writeFile(join(dir, ANTIGO), texto(LINHAS))
        await git('add', '-A')
        await git('commit', '-q', '-m', 'base do renomeio e2e')
        await git('mv', ANTIGO, NOVO)
        await writeFile(join(dir, NOVO), texto(LINHAS.map((l) => (l === 'cinco' ? 'CINCO' : l))))
        await git('add', '-A')
        await git('commit', '-q', '-m', MENSAGEM)
      }
    })
    const sha = (await app.git('rev-parse', 'HEAD')).trim()
    const { backend } = app
    const url = app.page.url()

    // O pedido de janela é capturado aqui: o host do roteiro não abre janela, e a página chama `backend.invoke` na hora.
    const invoke = backend.invoke
    const pedidos = []
    backend.invoke = (canal, args) => {
      if (canal === 'app:openDiffWindow') pedidos.push(args[0])
      return invoke.call(backend, canal, args)
    }

    /** Pontos que falharam, com o rótulo de cada um: a falha diz onde o oldPath se perdeu. */
    const falhas = []
    /** Roda a ação de um ponto, espera o pedido chegar e confere o que ele leva. Uma falha não para os outros pontos. */
    const conferir = async (ponto, acao) => {
      const antes = pedidos.length
      try {
        await acao()
        await expect.ate(async () => pedidos.length > antes, `pedido de janela chegar ao backend (${ponto})`)
        const pedido = pedidos[pedidos.length - 1]
        expect.igual(pedido?.source?.kind, 'commit', 'source.kind')
        expect.igual(pedido?.source?.sha, sha, 'source.sha (commit do arquivo)')
        expect.igual(pedido?.path, NOVO, 'path (caminho novo)')
        expect.igual(pedido?.source?.oldPath, ANTIGO, 'source.oldPath (caminho antigo)')
      } catch (erro) {
        falhas.push(`${ponto}: ${erro.message}`)
      }
    }

    try {
      await app.aba('History')
      await expect.visivel('.commit-row', 5)
      await app.page.locator('.commit-row', { hasText: MENSAGEM }).click(TEMPO)
      await expect.pagina((s) => document.querySelector('[data-slot="commit.message"] h3')?.textContent === s, MENSAGEM, 'detalhes do commit')
      await expect.visivel('[data-slot="commit.files"] .file-item', 1)

      await conferir('CommitDetails.tsx:167, duplo clique no painel de detalhes', () =>
        app.page.locator('[data-slot="commit.files"] .file-item', { hasText: NOVO }).first().dblclick(TEMPO)
      )
      await conferir('CommitDetails.tsx:167, "Open in new window" do menu do painel de detalhes', async () => {
        await app.page.locator('[data-slot="commit.files"] .file-item', { hasText: NOVO }).first().click({ button: 'right', ...TEMPO })
        await app.page.locator('.context-menu .menu-item', { hasText: 'Open in new window' }).click(TEMPO)
      })

      // Expande os arquivos do commit na lista do History (menu de contexto da linha). Feito uma vez, pelo primeiro ponto que precisa.
      let expandido = false
      const expandir = async () => {
        if (expandido) return
        await app.page.locator('.commit-row', { hasText: MENSAGEM }).click({ button: 'right', ...TEMPO })
        await app.page.locator('.context-menu .menu-item', { hasText: 'Show the files below the commit' }).click(TEMPO)
        await expect.visivel(`li.commit-file[data-copy="${NOVO}"]`, 1)
        expandido = true
      }
      await conferir('CommitList.tsx:912, duplo clique na lista de arquivos do History (openFileWindow de App.tsx)', async () => {
        await expandir()
        await app.page.locator(`li.commit-file[data-copy="${NOVO}"]`).dblclick(TEMPO)
      })
      await conferir('CommitList.tsx:871, "Open only this diff in a window" do menu da lista do History (openFileWindow de App.tsx)', async () => {
        await expandir()
        await app.page.locator(`li.commit-file[data-copy="${NOVO}"]`).click({ button: 'right', ...TEMPO })
        await app.page.locator('.context-menu .menu-item', { hasText: 'Open only this diff in a window' }).click(TEMPO)
      })

      // A janela: a mesma página, com o primeiro pedido capturado, tem de mostrar só a linha trocada.
      const amostra = pedidos[0]
      try {
        if (!amostra) throw new Error('nenhum pedido de janela capturado')
        const janela = new URL(url)
        janela.searchParams.set('window', 'diff')
        janela.searchParams.set('request', JSON.stringify(amostra))
        await app.page.goto(janela.href)
        await expect.visivel('tr.line-del', 1)
        const linhas = await app.page.evaluate(() => ({
          add: document.querySelectorAll('tr.line-add').length,
          del: document.querySelectorAll('tr.line-del').length
        }))
        expect.igual(linhas, { add: 1, del: 1 }, 'linhas da janela do diff (+1 −1)')
      } catch (erro) {
        falhas.push(`janela do diff, com o pedido do primeiro ponto: ${erro.message}`)
      } finally {
        // A página volta ao repositório do roteiro; o runner depende de a tela principal estar de pé ao limpar.
        await app.page.goto(url)
        await expect.visivel('.toolbar', 1)
      }
    } finally {
      backend.invoke = invoke
    }

    if (falhas.length) throw new Error(`oldPath perdido em: ${falhas.join(' | ')}`)
  }
}
