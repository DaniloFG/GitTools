// #158: o diff quebra as linhas longas por padrão; o item "Wrap long lines" do menu ⋯ do diff desliga a quebra. Sem
// quebra, a linha longa fica numa linha só (18px) e o corpo do diff ganha barra de rolagem horizontal; ligando de
// novo, a linha volta a quebrar. Só leitura na interface. Reprova se o item sumir ou se a quebra continuar.
import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const MENSAGEM = 'Linha longa e2e'
/** Palavras separadas por espaço (o texto quebra nos espaços) e bem mais largas que qualquer painel da janela do roteiro. */
const LINHA_LONGA = Array.from({ length: 400 }, (_, i) => `palavra${i}`).join(' ')
const CORPO = '[data-slot="commit.diff"] .diff-body'

export default {
  id: 'diff-sem-quebra',
  tela: 'History',
  area: 'historico',
  orcamento: { ms: 15000, nos: 5000, erros: 0, git: 0 },
  async passos(app, expect) {
    await app.repoNovo({
      wip: false,
      nome: 'sem-quebra-e2e',
      // O commit com a linha longa é criado antes de a interface ler o repositório.
      async preparar({ dir }) {
        const arquivo = join(dir, 'README.md')
        await writeFile(arquivo, `${await readFile(arquivo, 'utf8')}${LINHA_LONGA}\n`)
        const identidade = ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com']
        await execFileAsync('git', [...identidade, 'commit', '-q', '-am', MENSAGEM], { cwd: dir })
      }
    })
    await app.aba('History')
    await expect.visivel('.commit-row', 5)
    await app.page.locator('.commit-row', { hasText: MENSAGEM }).click()
    await expect.pagina((s) => document.querySelector('[data-slot="commit.message"] h3')?.textContent === s, MENSAGEM, 'detalhes do commit')
    await app.page.locator('[data-slot="commit.files"] .file-item', { hasText: 'README.md' }).first().click()
    await expect.visivel('[data-slot="commit.diff"] .diff-table tr.line-add', 1)

    /** Altura da célula da linha longa e se o corpo do diff rola na horizontal. */
    const medir = () =>
      app.page.evaluate((corpo) => {
        const el = document.querySelector(corpo)
        const celula = [...document.querySelectorAll(`${corpo} td.code`)].find((td) => td.textContent?.includes('palavra399'))
        return {
          altura: celula ? Math.round(celula.getBoundingClientRect().height) : null,
          rolaNaHorizontal: !!el && el.scrollWidth > el.clientWidth + 1,
          semQuebra: !!el && el.classList.contains('diff-nowrap')
        }
      }, CORPO)

    /** Escolhe o item "Wrap long lines" no menu ⋯ do diff. */
    const alternar = async () => {
      await app.page.locator('[data-slot="commit.diff"] .view-options-btn').first().click()
      await app.page.locator('.context-menu .menu-item', { hasText: 'Wrap long lines' }).click()
    }

    // Padrão: quebra. A linha ocupa várias linhas de texto e o corpo não rola na horizontal.
    const quebrando = await medir()
    expect.verdadeiro(quebrando.altura !== null, 'linha longa não encontrada no diff do README')
    expect.verdadeiro(quebrando.altura > 18, `com a quebra ligada a linha longa deveria passar de 18px: ${JSON.stringify(quebrando)}`)
    expect.verdadeiro(!quebrando.rolaNaHorizontal && !quebrando.semQuebra, `com a quebra ligada não deveria rolar na horizontal: ${JSON.stringify(quebrando)}`)

    // Desliga: uma linha só (18px) e barra de rolagem horizontal.
    await alternar()
    await expect.visivel(`${CORPO}.diff-nowrap`, 1)
    await expect.pagina((s) => {
      const celula = [...document.querySelectorAll(`${s} td.code`)].find((td) => td.textContent?.includes('palavra399'))
      return !!celula && Math.round(celula.getBoundingClientRect().height) === 18
    }, CORPO, 'linha longa em 18px, sem quebra')
    const semQuebra = await medir()
    expect.igual(semQuebra.altura, 18, 'altura da linha longa sem quebra')
    expect.verdadeiro(semQuebra.rolaNaHorizontal, `sem quebra o corpo do diff deveria rolar na horizontal: ${JSON.stringify(semQuebra)}`)

    // Liga de novo: volta a quebrar.
    await alternar()
    await expect.pagina((s) => !document.querySelector(`${s}.diff-nowrap`), CORPO, 'corpo do diff sem a classe diff-nowrap')
    const denovo = await medir()
    expect.verdadeiro(denovo.altura > 18, `ao religar a quebra a linha longa deveria passar de 18px: ${JSON.stringify(denovo)}`)
    expect.verdadeiro(!denovo.rolaNaHorizontal, `ao religar a quebra o corpo não deveria rolar na horizontal: ${JSON.stringify(denovo)}`)
  }
}
