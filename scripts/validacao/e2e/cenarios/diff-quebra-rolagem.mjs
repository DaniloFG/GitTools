// #158: alternar a quebra de linha (menu ⋯ do diff, "Wrap long lines") num diff grande não pode saltar a rolagem.
// Um arquivo de 1500 linhas, cada uma com ~300 caracteres e o número da linha no texto. O corpo do diff é rolado até o
// meio; a linha do topo é medida antes, depois de desligar a quebra e depois de religá-la. Em cada direção, a linha
// do topo não pode andar mais de 5. Só leitura da interface: o repositório é criado com o arquivo já commitado.
// Se reprovar, a mensagem traz os números medidos (linha do topo, scrollTop e scrollHeight); o app não é corrigido aqui.
import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const MENSAGEM = 'Arquivo longo e2e'
const ARQUIVO = 'linhas-longas.txt'
const TOTAL = 1500
/** 30 palavras por linha: a linha tem ~300 caracteres e quebra em várias linhas de texto quando a quebra está ligada. */
const PALAVRAS = Array.from({ length: 30 }, (_, k) => `palavra${k}`).join(' ')
const LINHAS = Array.from({ length: TOTAL }, (_, i) => `linha ${String(i + 1).padStart(4, '0')} ${PALAVRAS}`).join('\n') + '\n'
const CORPO = '[data-slot="commit.diff"] .diff-body'
/** Quanto a linha do topo pode andar ao alternar a quebra: o mesmo número de linhas do diff nas duas direções. */
const TOLERANCIA = 5

export default {
  id: 'diff-quebra-rolagem',
  tela: 'History',
  area: 'historico',
  orcamento: { ms: 30000, nos: 5000, erros: 0, git: 0 },
  async passos(app, expect) {
    await app.repoNovo({
      wip: false,
      nome: 'quebra-rolagem-e2e',
      // O commit com o arquivo grande é criado antes de a interface ler o repositório.
      async preparar({ dir }) {
        await writeFile(join(dir, ARQUIVO), LINHAS)
        const identidade = ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com']
        await execFileAsync('git', ['add', ARQUIVO], { cwd: dir })
        await execFileAsync('git', [...identidade, 'commit', '-q', '-m', MENSAGEM], { cwd: dir })
      }
    })
    await app.aba('History')
    await expect.visivel('.commit-row', 5)
    await app.page.locator('.commit-row', { hasText: MENSAGEM }).click()
    await expect.pagina((s) => document.querySelector('[data-slot="commit.message"] h3')?.textContent === s, MENSAGEM, 'detalhes do commit')
    await app.page.locator('[data-slot="commit.files"] .file-item', { hasText: ARQUIVO }).first().click()
    // data-rows é o número de linhas da lista do diff: o arquivo inteiro (1500 linhas) chegou, sem truncar.
    await expect.pagina((s) => {
      const corpo = document.querySelector(s)
      return !!corpo && Number(corpo.dataset.rows) >= 1500
    }, CORPO, 'diff com as 1500 linhas')

    /** Linha do topo, rolagem e quebra, lidas no mesmo instante. Só lê o DOM. */
    const medir = () =>
      app.page.evaluate((corpo) => {
        const el = document.querySelector(corpo)
        const topoCorpo = el.getBoundingClientRect().top
        let linha = null
        // A primeira linha cujo fim passa do topo do corpo (a que aparece no topo, mesmo que cortada).
        for (const tr of el.querySelectorAll('tr.line')) {
          if (tr.getBoundingClientRect().bottom > topoCorpo + 1) {
            const numero = tr.querySelector('td.code')?.textContent?.match(/linha (\d{4})/)
            linha = numero ? Number(numero[1]) : null
            break
          }
        }
        return { linha, scrollTop: Math.round(el.scrollTop), scrollHeight: el.scrollHeight, semQuebra: el.classList.contains('diff-nowrap') }
      }, CORPO)

    /** Espera a leitura assentar: duas leituras seguidas iguais, sem tempo fixo. Devolve a última. */
    const assentar = (rotulo) => {
      let anterior = ''
      return expect.ate(async () => {
        const atual = await medir()
        const texto = JSON.stringify(atual)
        const assentou = texto === anterior
        anterior = texto
        return assentou ? atual : null
      }, rotulo)
    }

    /** Escolhe "Wrap long lines" no menu ⋯ do diff. */
    const alternar = async () => {
      await app.page.locator('[data-slot="commit.diff"] .view-options-btn').first().click()
      await app.page.locator('.context-menu .menu-item', { hasText: 'Wrap long lines' }).click()
    }

    // Rola até o meio com a quebra ligada (padrão) e espera a lista assentar.
    await app.page.evaluate((corpo) => {
      const el = document.querySelector(corpo)
      el.scrollTop = el.scrollHeight / 2
    }, CORPO)
    const antes = await assentar('rolagem ao meio com a quebra ligada')

    // Desliga a quebra e espera assentar de novo.
    await alternar()
    await expect.pagina((s) => !!document.querySelector(`${s}.diff-nowrap`), CORPO, 'corpo do diff sem quebra (diff-nowrap)')
    const semQuebra = await assentar('linha do topo com a quebra desligada')

    // Religa a quebra e espera assentar de novo.
    await alternar()
    await expect.pagina((s) => !document.querySelector(`${s}.diff-nowrap`), CORPO, 'corpo do diff com quebra de volta')
    const religada = await assentar('linha do topo com a quebra religada')

    const resumo = (rotulo, m) => `${rotulo}: linha do topo ${m.linha}, scrollTop ${m.scrollTop}, scrollHeight ${m.scrollHeight}`
    const numeros = `${resumo('ligada', antes)} | ${resumo('desligada', semQuebra)} | ${resumo('religada', religada)}`

    expect.verdadeiro(antes.linha !== null && semQuebra.linha !== null && religada.linha !== null, `linha do topo não encontrada: ${numeros}`)
    expect.verdadeiro(antes.scrollTop > 0, `a rolagem ao meio não rolou: ${numeros}`)
    expect.igual([antes.semQuebra, semQuebra.semQuebra, religada.semQuebra], [false, true, false], `estado da quebra nas três leituras: ${numeros}`)

    const ida = Math.abs(antes.linha - semQuebra.linha)
    expect.verdadeiro(ida <= TOLERANCIA, `ao desligar a quebra a linha do topo andou ${ida} (limite ${TOLERANCIA}): de ${antes.linha} para ${semQuebra.linha}; ${numeros}`)
    const volta = Math.abs(semQuebra.linha - religada.linha)
    expect.verdadeiro(volta <= TOLERANCIA, `ao religar a quebra a linha do topo andou ${volta} (limite ${TOLERANCIA}): de ${semQuebra.linha} para ${religada.linha}; ${numeros}`)
  }
}
