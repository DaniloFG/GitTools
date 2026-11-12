// #92: resolver o conflito inteiro com o lado deles (o commit que entra) pelo botão "Use incoming" do cabeçalho do
// editor. O arquivo sai da lista e o editor fecha, o git confirma: sem entrada de conflito no índice, o arquivo igual
// ao commit que entra (CHERRY_PICK_HEAD), sem marcadores, e a operação ainda aberta. Resolver e atualizar gasta no
// máximo 5 processos git.
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export default {
  id: 'conflito-resolver-deles',
  tela: 'Conflitos',
  area: 'conflitos',
  orcamento: { ms: 15000, nos: 5000, erros: 0, git: 0 },
  escreve: true,
  async passos(app, expect) {
    // Conflito criado fora do backend: o cherry-pick sai com código 1, o esperado (ver conflito-resolver-salvar).
    const { dir } = await app.repoNovo({
      wip: false,
      nome: 'deles-e2e',
      async preparar({ ids }) {
        await app.git('cherry-pick', ids.memberPrice).then(
          () => { throw new Error('o cherry-pick deveria parar em conflito') },
          (erro) => { if (erro.code !== 1) throw erro }
        )
      }
    })
    expect.igual((await app.git('diff', '--name-only', '--diff-filter=U')).trim(), 'src/cart.js', 'arquivo em conflito no git')
    // O lado deles é o commit que entra: é o que o arquivo deve ser depois de resolver com "Use incoming".
    const deles = await app.git('show', 'CHERRY_PICK_HEAD:src/cart.js')

    await app.page.locator('button.operation-title').click()
    await app.page.locator('.conflicts-screen').waitFor()
    await app.page.locator('.conflicts-row').first().click()
    await app.page.locator('.conflict-editor .merge-editor').waitFor()

    // Conta só os processos da resolução: o que o editor já leu até aqui fica de fora.
    const ids = async () => new Set((await app.backend.invoke('app:gitLog', [])).map((e) => e.id))
    const antes = await ids()
    // Seletor do cabeçalho do editor (grupo de ações do arquivo), não a barra de "Resolve all" com a mesma palavra.
    await app.page.locator('.conflict-file-actions button', { hasText: /^Use incoming$/ }).click()
    await expect.pagina(() => !document.querySelector('.conflict-editor') && document.querySelectorAll('.conflicts-row').length === 0, null, 'editor fechado e lista de conflitos vazia')
    // Espera o git da resolução + atualização assentar: duas leituras iguais do log, todos os processos terminados.
    let ultimo = -1
    await expect.ate(async () => {
      const log = await app.backend.invoke('app:gitLog', [])
      const quieto = log.length === ultimo && log.every((e) => e.durationMs !== undefined)
      ultimo = log.length
      return quieto
    }, 'processos git da resolução terminados')
    const gastos = [...(await ids())].filter((id) => !antes.has(id)).length
    expect.verdadeiro(gastos <= 5, `resolver + atualizar gastou ${gastos} processos git (teto 5)`)

    expect.igual((await app.git('diff', '--name-only', '--diff-filter=U')).trim(), '', 'arquivos ainda em conflito no git')
    expect.igual((await app.git('ls-files', '--unmerged')).trim(), '', 'entradas de conflito no índice')
    const conteudo = await readFile(join(dir, 'src/cart.js'), 'utf8')
    expect.verdadeiro(!/^(<<<<<<<|=======|>>>>>>>)/m.test(conteudo), 'o arquivo ainda tem marcadores de conflito')
    expect.igual(conteudo, deles, 'arquivo igual ao lado deles (commit que entra)')
    const aberta = await access(join(dir, '.git', 'CHERRY_PICK_HEAD')).then(() => true, () => false)
    expect.verdadeiro(aberta, 'o cherry-pick deveria seguir aberto até Continue')
  }
}
