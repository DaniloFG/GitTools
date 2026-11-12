// #92: resolver o bloco escrevendo o texto do resultado à mão (o painel do resultado é editável). Salvar fecha o
// editor e o arquivo sai da lista; o git confirma: sem entrada de conflito no índice, sem marcadores, o texto digitado
// no lugar do bloco e nenhum dos dois lados, e a operação ainda aberta. Salvar e atualizar gasta no máximo 5 processos.
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Texto digitado à mão: único no arquivo, para a conferência contar as ocorrências sem ambiguidade. */
const TEXTO_A_MAO = 'export const totalComResolucaoManual = true'

export default {
  id: 'conflito-resolver-a-mao',
  tela: 'Conflitos',
  area: 'conflitos',
  orcamento: { ms: 15000, nos: 5000, erros: 0, git: 0 },
  escreve: true,
  async passos(app, expect) {
    // Conflito criado fora do backend: o cherry-pick sai com código 1, o esperado (ver conflito-resolver-salvar).
    const { dir } = await app.repoNovo({
      wip: false,
      nome: 'a-mao-e2e',
      async preparar({ ids }) {
        await app.git('cherry-pick', ids.memberPrice).then(
          () => { throw new Error('o cherry-pick deveria parar em conflito') },
          (erro) => { if (erro.code !== 1) throw erro }
        )
      }
    })
    expect.igual((await app.git('diff', '--name-only', '--diff-filter=U')).trim(), 'src/cart.js', 'arquivo em conflito no git')

    await app.page.locator('button.operation-title').click()
    await app.page.locator('.conflicts-screen').waitFor()
    await app.page.locator('.conflicts-row').first().click()
    await app.page.locator('.conflict-editor .merge-editor').waitFor()

    // O conflito de src/cart.js é um bloco só: o painel do resultado tem um campo de texto, e é nele que se digita.
    const campo = app.page.locator('.conflict-editor .merge-result')
    expect.igual(await campo.count(), 1, 'campos de resultado (um por bloco em conflito)')
    await campo.fill(TEXTO_A_MAO)

    // Conta só os processos do salvar: o que o editor já leu até aqui fica de fora.
    const ids = async () => new Set((await app.backend.invoke('app:gitLog', [])).map((e) => e.id))
    const antes = await ids()
    await app.page.locator('.conflict-editor-foot button.primary').click()
    await expect.pagina(() => !document.querySelector('.conflict-editor') && document.querySelectorAll('.conflicts-row').length === 0, null, 'editor fechado e lista de conflitos vazia')
    // Espera o git do salvar + atualização assentar: duas leituras iguais do log, todos os processos terminados.
    let ultimo = -1
    await expect.ate(async () => {
      const log = await app.backend.invoke('app:gitLog', [])
      const quieto = log.length === ultimo && log.every((e) => e.durationMs !== undefined)
      ultimo = log.length
      return quieto
    }, 'processos git do salvar terminados')
    const gastos = [...(await ids())].filter((id) => !antes.has(id)).length
    expect.verdadeiro(gastos <= 5, `salvar + atualizar gastou ${gastos} processos git (teto 5)`)

    expect.igual((await app.git('diff', '--name-only', '--diff-filter=U')).trim(), '', 'arquivos ainda em conflito no git')
    expect.igual((await app.git('ls-files', '--unmerged')).trim(), '', 'entradas de conflito no índice')
    const conteudo = await readFile(join(dir, 'src/cart.js'), 'utf8')
    expect.verdadeiro(!/^(<<<<<<<|=======|>>>>>>>)/m.test(conteudo), 'o arquivo ainda tem marcadores de conflito')
    // O texto digitado ocupa o lugar do bloco (uma vez), e os dois lados do bloco saíram: nem o do HEAD nem o que entra.
    expect.igual(conteudo.split(TEXTO_A_MAO).length - 1, 1, 'ocorrências do texto digitado à mão')
    expect.verdadeiro(!conteudo.includes('applyDiscount') && !conteudo.includes('memberPrice'), 'nenhum dos dois lados deveria restar no bloco resolvido')
    expect.verdadeiro(conteudo.startsWith('// Shopping cart helpers.'), 'o trecho fora do conflito deveria ser mantido')
    const aberta = await access(join(dir, '.git', 'CHERRY_PICK_HEAD')).then(() => true, () => false)
    expect.verdadeiro(aberta, 'o cherry-pick deveria seguir aberto até Continue')
  }
}
