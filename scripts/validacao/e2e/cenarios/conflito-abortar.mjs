// "Abort" num cherry-pick em conflito: pede confirmação (cancelar não muda nada) e, confirmado, o git volta ao
// estado de antes da operação: mesmo HEAD, árvore limpa, sem operação aberta e sem arquivos em conflito.
import { access } from 'node:fs/promises'
import { join } from 'node:path'

export default {
  id: 'conflito-abortar',
  tela: 'Conflitos',
  area: 'conflitos',
  orcamento: { ms: 15000, nos: 5000, erros: 0, git: 0 },
  escreve: true,
  async passos(app, expect) {
    // Conflito criado fora do backend: o cherry-pick sai com código 1, o esperado (ver conflito-resolver-salvar).
    const { dir, ids } = await app.repoNovo({
      wip: false,
      nome: 'abortar-e2e',
      async preparar({ ids: i }) {
        await app.git('cherry-pick', i.memberPrice).then(
          () => { throw new Error('o cherry-pick deveria parar em conflito') },
          (erro) => { if (erro.code !== 1) throw erro }
        )
      }
    })
    const aberta = () => access(join(dir, '.git', 'CHERRY_PICK_HEAD')).then(() => true, () => false)
    expect.igual(await aberta(), true, 'cherry-pick aberto na partida')

    await app.page.locator('button.operation-title').click()
    await app.page.locator('.conflicts-screen').waitFor()
    await app.page.locator('.conflicts-row').first().waitFor()
    const abortar = app.page.locator('.conflicts-actions button.danger', { hasText: 'Abort' })

    // Cancelar a pergunta mantém a operação.
    await abortar.click()
    await app.page.locator('.modal').waitFor()
    await app.page.locator('.modal .modal-footer button', { hasText: 'Cancel' }).click()
    await app.page.locator('.modal').waitFor({ state: 'detached' })
    expect.igual(await aberta(), true, 'cherry-pick depois de cancelar o abort')

    await abortar.click()
    await app.page.locator('.modal').waitFor()
    await app.page.locator('.modal .modal-footer button.danger').click()
    await expect.ate(async () => !(await aberta()), 'cherry-pick abortado')
    expect.igual((await app.git('rev-parse', 'HEAD')).trim(), ids.merge, 'HEAD depois de abortar')
    expect.igual(await app.git('status', '--porcelain'), '', 'status depois de abortar')
    expect.igual((await app.git('ls-files', '--unmerged')).trim(), '', 'entradas de conflito no índice')
    await expect.pagina(() => document.querySelectorAll('.conflicts-row').length === 0 && !document.querySelector('.operation-banner'), null, 'conflitos e faixa removidos da tela')
  }
}
