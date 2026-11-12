// #160: no Commit diff, as linhas do diff ocupam a altura do painel e continuam à vista depois de arrastar o divisor
// entre a lista de commits e o diff (e de restaurá-lo com duplo clique). O diff é grande (a lista é desenhada por
// janela): se a altura da janela não acompanha o painel, sobra bloco vazio ou as linhas somem. Só leitura.
import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const MENSAGEM = 'Arquivo grande e2e'
const CORPO = '[data-slot="commit.diff"] .diff-body'

export default {
  id: 'diff-altura-divisor',
  tela: 'History',
  area: 'historico',
  orcamento: { ms: 20000, nos: 5000, erros: 0, git: 0 },
  async passos(app, expect) {
    await app.repoNovo({
      wip: false,
      nome: 'altura-divisor-e2e',
      async preparar({ dir }) {
        const texto = Array.from({ length: 3000 }, (_, i) => `linha ${i} do arquivo grande`).join('\n')
        await writeFile(join(dir, 'grande.txt'), `${texto}\n`)
        const identidade = ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com']
        await execFileAsync('git', ['add', 'grande.txt'], { cwd: dir })
        await execFileAsync('git', [...identidade, 'commit', '-q', '-m', MENSAGEM], { cwd: dir })
      }
    })
    await app.aba('History')
    await expect.visivel('.commit-row', 5)
    await app.page.locator('.commit-row', { hasText: MENSAGEM }).click()
    await app.page.locator('[data-slot="commit.files"] .file-item', { hasText: 'grande.txt' }).first().click()
    await expect.visivel(`${CORPO} tr.line-add`, 1)

    /** Altura do corpo, quanto do corpo as linhas desenhadas cobrem e quantas linhas há montadas. */
    const medir = () =>
      app.page.evaluate((corpo) => {
        const el = document.querySelector(corpo)
        if (!el) return null
        const caixa = el.getBoundingClientRect()
        const linhas = [...el.querySelectorAll('tr')].filter((tr) => {
          const b = tr.getBoundingClientRect()
          return b.bottom > caixa.top && b.top < caixa.bottom
        })
        const ultima = linhas.at(-1)?.getBoundingClientRect().bottom ?? caixa.top
        return { altura: Math.round(caixa.height), cobertura: Math.round(Math.min(ultima, caixa.bottom) - caixa.top), visiveis: linhas.length }
      }, CORPO)

    /** Arrasta o divisor horizontal (entre History/Commit message e o Commit diff) em `dy` px. */
    const arrastar = async (dy) => {
      const caixa = await app.page.evaluate(() => {
        const d = [...document.querySelectorAll('.dock-divider')].find((e) => e.getBoundingClientRect().width > e.getBoundingClientRect().height && e.getBoundingClientRect().width > 300)
        const b = d?.getBoundingClientRect()
        return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null
      })
      expect.verdadeiro(caixa !== null, 'divisor horizontal do dock não encontrado')
      await app.page.mouse.move(caixa.x, caixa.y)
      await app.page.mouse.down()
      for (let i = 1; i <= 10; i++) await app.page.mouse.move(caixa.x, caixa.y + (dy * i) / 10)
      await app.page.mouse.up()
    }

    const conferir = async (rotulo) => {
      await expect.pagina(
        (s) => {
          const el = document.querySelector(s)
          if (!el) return false
          const caixa = el.getBoundingClientRect()
          const ultima = [...el.querySelectorAll('tr')].at(-1)?.getBoundingClientRect().bottom ?? 0
          return caixa.height > 100 && ultima >= caixa.bottom - 20
        },
        CORPO,
        `linhas do diff preenchem a altura do painel ${rotulo}`
      )
      const m = await medir()
      expect.verdadeiro(m.visiveis > 5 && m.cobertura >= m.altura - 20, `${rotulo}: linhas não preenchem o painel ${JSON.stringify(m)}`)
    }

    await app.page.locator('[data-slot="commit.diff"] .view-options-btn').first().click()
    await app.page.locator('.context-menu .menu-item', { hasText: 'Side by side' }).click()
    await expect.visivel(`${CORPO} table.diff-split`, 1)
    await conferir('de partida')
    await arrastar(-150)
    await conferir('depois de subir o divisor')
    await arrastar(300)
    await conferir('depois de descer o divisor')
    await arrastar(-250)
    await conferir('depois de subir de novo')

    // No limite (divisor arrastado até o fim): o diff ainda mostra linhas de código, não só os cabeçalhos.
    await arrastar(2000)
    await expect.pagina(
      (s) => document.querySelector(s)?.getBoundingClientRect().height > 10 && document.querySelectorAll(`${s} tr`).length > 0,
      CORPO,
      'ao menos uma linha do diff no tamanho mínimo do painel'
    )
    const minimo = await medir()
    expect.verdadeiro(minimo !== null && minimo.visiveis >= 1, `no tamanho mínimo o diff não mostra linhas: ${JSON.stringify(minimo)}`)
    // Duplo clique no divisor restaura o tamanho de partida.
    await app.page.evaluate(() => {
      const d = [...document.querySelectorAll('.dock-divider')].find((e) => e.getBoundingClientRect().width > 300)
      d?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    await conferir('depois de restaurar com duplo clique')
  }
}
