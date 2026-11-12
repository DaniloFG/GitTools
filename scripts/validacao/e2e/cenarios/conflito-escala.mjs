// #96: 1500 arquivos em conflito. A tela abre com o contador de 1500 pendentes, mas só as linhas da janela da lista
// entram no DOM, e abrir a tela não roda processo git (a lista sai do que o backend já leu ao carregar o repositório).
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const ARQUIVOS = 1500
/** Linhas montadas da lista: a janela mostra algumas dezenas, nunca as 1500. */
const LINHAS_MAX = 60

export default {
  id: 'conflito-escala',
  tela: 'Conflitos',
  area: 'conflitos',
  // Medido com a execução do próprio cenário (ver o relatório de E8): teto de nós com folga de ~25%.
  orcamento: { ms: 60000, nos: 100000, erros: 0, git: 0 },
  async passos(app, expect) {
    await app.repoNovo({
      wip: false,
      nome: 'escala-e2e',
      // Mesmo preparo de conflito-resolver-muitos, com 1500 arquivos (nomes de 4 dígitos: a ordem do git é a numérica).
      async preparar({ dir: repo }) {
        await mkdir(join(repo, 'lote'), { recursive: true })
        const escrever = (versao) => Promise.all(Array.from({ length: ARQUIVOS }, (_, n) => writeFile(join(repo, nomeDe(n)), `${versao} ${n}\n`)))
        await escrever('base')
        await app.git('add', '-A')
        await app.git('commit', '-q', '-m', 'lote: base')
        await app.git('checkout', '-q', '-b', 'lote-deles')
        await escrever('deles')
        await app.git('add', '-A')
        await app.git('commit', '-q', '-m', 'lote: deles')
        const deles = (await app.git('rev-parse', 'HEAD')).trim()
        await app.git('checkout', '-q', 'main')
        await escrever('nosso')
        await app.git('add', '-A')
        await app.git('commit', '-q', '-m', 'lote: nosso')
        await app.git('cherry-pick', deles).then(
          () => { throw new Error('o cherry-pick deveria parar em conflito') },
          (erro) => { if (erro.code !== 1) throw erro }
        )
      }
    })
    const emConflito = [...new Set((await app.git('ls-files', '--unmerged')).split('\n').filter(Boolean).map((linha) => linha.split('\t')[1]))]
    expect.igual(emConflito.length, ARQUIVOS, 'arquivos em conflito no índice na partida')

    // Com a opção padrão ("abrir na partida") a tela já abre sozinha: fecha para medir a abertura pelo título.
    await app.page.locator('.conflicts-close').click()
    await app.page.locator('.conflicts-screen').waitFor({ state: 'detached' })

    // Conta só os processos da abertura: o que a página leu ao carregar o repositório fica de fora.
    const ids = async () => new Set((await app.backend.invoke('app:gitLog', [])).map((e) => e.id))
    const antes = await ids()
    await app.page.locator('button.operation-title').click()
    await app.page.locator('.conflicts-screen').waitFor()
    await expect.pagina(() => document.querySelector('.conflicts-counts')?.textContent === 'Pending: 1500 of 1500', null, 'contador da tela com 1500 pendentes')
    // Espera a abertura assentar: duas leituras iguais do log, todos os processos terminados.
    let ultimo = -1
    await expect.ate(async () => {
      const log = await app.backend.invoke('app:gitLog', [])
      const quieto = log.length === ultimo && log.every((e) => e.durationMs !== undefined)
      ultimo = log.length
      return quieto
    }, 'processos git da abertura terminados')
    const gastos = [...(await ids())].filter((id) => !antes.has(id)).length
    expect.verdadeiro(gastos === 0, `abrir a tela gastou ${gastos} processos git (teto 0)`)

    const linhas = await app.page.locator('.conflicts-row').count()
    expect.verdadeiro(linhas > 0 && linhas < LINHAS_MAX, `linhas montadas na lista: ${linhas} (esperava entre 1 e ${LINHAS_MAX - 1})`)
  }
}

/** Caminho do arquivo n dentro de lote/ (quatro dígitos: a ordem de texto do git é a ordem numérica). */
function nomeDe(n) {
  return `lote/arq-${String(n).padStart(4, '0')}.txt`
}
