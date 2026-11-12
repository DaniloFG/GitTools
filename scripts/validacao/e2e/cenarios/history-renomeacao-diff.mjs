// History: um commit que renomeia um arquivo e muda uma linha. O diff do arquivo renomeado, no painel de detalhes, tem
// de mostrar só a linha trocada (+1 −1). Sem o caminho antigo no pedido de diff, o git mostra o arquivo inteiro como
// novo (+10). Só leitura na interface.
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
    await app.aba('History')
    await expect.visivel('.commit-row', 5)
    await app.page.locator('.commit-row', { hasText: MENSAGEM }).click()
    await expect.pagina((s) => document.querySelector('[data-slot="commit.message"] h3')?.textContent === s, MENSAGEM, 'detalhes do commit')
    await app.page.locator('[data-slot="commit.files"] .file-item', { hasText: NOVO }).first().click()
    // Espera a linha removida aparecer: o arquivo inteiro como novo (defeito antigo) não tem nenhuma, e o teste falharia por tempo.
    await expect.visivel('[data-slot="commit.diff"] tr.line-del', 1)
    const linhas = await app.page.evaluate(() => ({
      add: document.querySelectorAll('[data-slot="commit.diff"] tr.line-add').length,
      del: document.querySelectorAll('[data-slot="commit.diff"] tr.line-del').length
    }))
    expect.igual(linhas, { add: 1, del: 1 }, 'linhas do diff do arquivo renomeado (+1 −1)')
  }
}
