// Arquivo renomeado com uma linha mudada sai +1 −1 (não como adição inteira) em três telas que perdiam o caminho
// antigo: Changes (staged), Compare e o histórico de arquivo do Files. Sem `oldPath` no pedido de diff o git mostra
// o arquivo inteiro como novo (10 linhas adicionadas). Reprova listando cada tela que errou.
import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const MENSAGEM = 'Renomeia o arquivo e muda uma linha telas e2e'
const ANTIGO = 'telas-antigo.txt'
const NOVO = 'telas-novo.txt'
const LINHAS = ['um', 'dois', 'tres', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez']
const texto = (itens) => itens.map((l) => `${l}\n`).join('')
const TEMPO = { timeout: 10_000 }

export default {
  id: 'renomeacao-diff-telas',
  tela: 'Changes',
  area: 'alteracoes',
  orcamento: { ms: 20000, nos: 5000, erros: 0, git: 0 },
  async passos(app, expect) {
    const identidade = ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com']
    await app.repoNovo({
      wip: false,
      nome: 'renomeacao-telas-e2e',
      async preparar({ dir }) {
        const git = (...args) => execFileAsync('git', [...identidade, ...args], { cwd: dir })
        await writeFile(join(dir, ANTIGO), texto(LINHAS))
        await git('add', '-A')
        await git('commit', '-q', '-m', 'base do renomeio telas e2e')
        await git('mv', ANTIGO, NOVO)
        await writeFile(join(dir, NOVO), texto(LINHAS.map((l) => (l === 'cinco' ? 'CINCO' : l))))
        await git('add', '-A')
      }
    })
    const falhas = []
    const linhas = () => app.page.evaluate(() => ({ add: document.querySelectorAll('tr.line-add').length, del: document.querySelectorAll('tr.line-del').length }))
    const conferirLinhas = async (tela) => {
      try {
        await expect.visivel('tr.line-del', 1)
        expect.igual(await linhas(), { add: 1, del: 1 }, `linhas do diff em ${tela} (+1 −1)`)
      } catch (erro) {
        falhas.push(`${tela}: ${erro.message}`)
      }
    }

    // Changes: o renomeado está no stage; o diff tem de sair +1 −1.
    await app.aba('Changes')
    await app.page.locator('.file-item', { hasText: NOVO }).first().click(TEMPO)
    await conferirLinhas('Changes (staged)')

    // Commita a renomeação para as outras duas telas.
    await app.git(...identidade, 'commit', '-q', '-m', MENSAGEM)

    // Compare: HEAD~1 contra HEAD.
    await app.aba('Compare')
    const campos = app.page.locator('.compare-bar input[list="compare-refs"]')
    await campos.nth(0).fill('HEAD~1', TEMPO)
    await campos.nth(1).fill('HEAD', TEMPO)
    await app.page.locator('.compare-bar button.primary').click(TEMPO)
    await app.page.locator('.file-item', { hasText: NOVO }).first().click(TEMPO)
    await conferirLinhas('Compare')

    // Files: histórico do arquivo, no commit que renomeou.
    await app.aba('Files')
    await app.page.locator('.file-item', { hasText: NOVO }).first().click(TEMPO)
    await app.page.locator('.compare-commits.history-list li', { hasText: MENSAGEM }).first().click(TEMPO)
    await conferirLinhas('Files (histórico de arquivo)')

    if (falhas.length) throw new Error(`renomeado como adição inteira em: ${falhas.join(' | ')}`)
  }
}
