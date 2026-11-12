// #92: salvar a resolução de um conflito. O editor fecha sem a modal de três opções (.choice-list), o arquivo sai
// da lista na hora, salvar + atualizar gasta no máximo 5 processos git, e o git confirma: sem entrada de conflito
// no índice, sem marcadores no arquivo, com os dois lados mantidos, e a operação ainda aberta (falta continuar).
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export default {
  id: 'conflito-resolver-salvar',
  tela: 'Conflitos',
  area: 'conflitos',
  orcamento: { ms: 15000, nos: 5000, erros: 0, git: 0 },
  escreve: true,
  async passos(app, expect) {
    // O conflito nasce de um cherry-pick feito fora da interface (cherry-pick com conflito sai com código 1 no git;
    // fora do backend, essa saída não entra na conta de processos inesperados). A página lê o resultado ao abrir.
    const { dir } = await app.repoNovo({
      wip: false,
      nome: 'salvar-e2e',
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
    await app.page.locator('.conflict-editor button', { hasText: /Keep both|Both/ }).first().click()

    // Observa a modal de três opções a partir daqui e conta só os processos do salvar.
    await app.page.evaluate(() => {
      window.__choice = false
      new MutationObserver(() => { if (document.querySelector('.choice-list')) window.__choice = true }).observe(document.body, { childList: true, subtree: true })
    })
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

    expect.igual(await app.page.evaluate(() => window.__choice), false, 'modal de três opções ao salvar')
    expect.verdadeiro(gastos <= 5, `salvar + atualizar gastou ${gastos} processos git (teto 5)`)

    expect.igual((await app.git('diff', '--name-only', '--diff-filter=U')).trim(), '', 'arquivos ainda em conflito no git')
    expect.igual((await app.git('ls-files', '--unmerged')).trim(), '', 'entradas de conflito no índice')
    const conteudo = await readFile(join(dir, 'src/cart.js'), 'utf8')
    expect.verdadeiro(!/^(<<<<<<<|=======|>>>>>>>)/m.test(conteudo), 'o arquivo ainda tem marcadores de conflito')
    expect.verdadeiro(conteudo.includes('applyDiscount') && conteudo.includes('memberPrice'), 'os dois lados deveriam ter sido mantidos')
    const aberta = await access(join(dir, '.git', 'CHERRY_PICK_HEAD')).then(() => true, () => false)
    expect.verdadeiro(aberta, 'o cherry-pick deveria seguir aberto até Continue')
  }
}
