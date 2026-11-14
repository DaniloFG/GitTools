// #162: com "Whole file" ligado nas configurações (`diffFullFile`), a janela de diff abre o arquivo inteiro. A janela
// lia o padrão de fábrica porque o hook rodava acima do provider de configurações dela. O arquivo de 40 linhas tem
// só a linha 20 alterada: com contexto de 3 linhas o diff tem 7 linhas; com o arquivo inteiro, 40 (mais a removida).
// A janela é a mesma página em `?window=diff` com o pedido; a configuração é salva e restaurada pelo backend.
import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const ARQUIVO = 'longo.txt'
const LINHAS = 40
const conteudo = (linha20) => Array.from({ length: LINHAS }, (_, i) => (i === 19 ? linha20 : `linha ${i + 1}`)).join('\n') + '\n'

export default {
  id: 'history-janela-arquivo-inteiro',
  tela: 'History',
  area: 'historico',
  orcamento: { ms: 15000, nos: 5000, erros: 0, git: 0 },
  async passos(app, expect) {
    await app.repoNovo({
      wip: false,
      nome: 'arquivo-inteiro-e2e',
      async preparar({ dir }) {
        const id = ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com']
        await writeFile(join(dir, ARQUIVO), conteudo('linha 20'))
        await execFileAsync('git', [...id, 'add', ARQUIVO], { cwd: dir })
        await execFileAsync('git', [...id, 'commit', '-q', '-m', 'Arquivo longo'], { cwd: dir })
        await writeFile(join(dir, ARQUIVO), conteudo('linha 20 alterada'))
        await execFileAsync('git', [...id, 'commit', '-q', '-am', 'Altera a linha 20'], { cwd: dir })
      }
    })
    const sha = (await app.git('rev-parse', 'HEAD')).trim()
    const url = app.page.url()
    const original = await app.backend.invoke('app:getSettings', [])
    const root = (await app.git('rev-parse', '--show-toplevel')).trim()
    const pedido = { source: { kind: 'commit', sha }, path: ARQUIVO, root }

    /** Abre a janela de diff com a configuração dada e conta as linhas de código do diff. */
    const linhasNaJanela = async (inteiro) => {
      await app.backend.invoke('app:saveSettings', [{ ...original, diffFullFile: inteiro }])
      const janela = new URL(url)
      janela.searchParams.set('window', 'diff')
      janela.searchParams.set('request', JSON.stringify(pedido))
      await app.page.goto(janela.href)
      await expect.visivel('.diff-window table.diff-table tr.line-add', 1)
      return app.page.evaluate(() => document.querySelectorAll('.diff-window table.diff-table tr.line').length)
    }

    try {
      const curto = await linhasNaJanela(false)
      expect.verdadeiro(curto < 15, `com "Whole file" desligado a janela deveria mostrar só o contexto: ${curto} linhas`)
      const inteiro = await linhasNaJanela(true)
      expect.verdadeiro(inteiro >= LINHAS, `com "Whole file" ligado a janela deveria mostrar o arquivo inteiro (${LINHAS}+ linhas): ${inteiro}`)
    } finally {
      await app.backend.invoke('app:saveSettings', [original])
      await app.page.goto(url)
      await expect.visivel('.toolbar', 1)
    }
  }
}
