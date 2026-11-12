// "Skip this commit" num cherry-pick em conflito: o commit é descartado sem ser aplicado. O git mostra o HEAD de
// antes, nenhuma operação aberta e a árvore limpa, com o arquivo como estava na branch.
import { access } from 'node:fs/promises'
import { join } from 'node:path'

export default {
  id: 'conflito-pular',
  tela: 'Conflitos',
  area: 'conflitos',
  orcamento: { ms: 15000, nos: 5000, erros: 0, git: 0 },
  escreve: true,
  async passos(app, expect) {
    // Conflito criado fora do backend: o cherry-pick sai com código 1, o esperado (ver conflito-resolver-salvar).
    const { dir, ids } = await app.repoNovo({
      wip: false,
      nome: 'pular-e2e',
      async preparar({ ids: i }) {
        await app.git('cherry-pick', i.memberPrice).then(
          () => { throw new Error('o cherry-pick deveria parar em conflito') },
          (erro) => { if (erro.code !== 1) throw erro }
        )
      }
    })
    const cartAntes = (await app.git('rev-parse', 'HEAD:src/cart.js')).trim()

    await app.page.locator('button.operation-title').click()
    await app.page.locator('.conflicts-screen').waitFor()
    await app.page.locator('.conflicts-row').first().waitFor()
    await app.page.locator('.conflicts-actions button', { hasText: 'Skip this commit' }).click()

    await expect.ate(async () => !(await access(join(dir, '.git', 'CHERRY_PICK_HEAD')).then(() => true, () => false)), 'cherry-pick encerrado')
    expect.igual((await app.git('rev-parse', 'HEAD')).trim(), ids.merge, 'HEAD depois de pular')
    expect.igual(await app.git('status', '--porcelain'), '', 'status depois de pular')
    expect.igual((await app.git('rev-parse', 'HEAD:src/cart.js')).trim(), cartAntes, 'src/cart.js no HEAD')
    expect.igual((await app.git('log', '--format=%s', '--grep=member prices')).trim(), '', 'commits "member prices" na main')
    await expect.pagina(() => document.querySelectorAll('.conflicts-row').length === 0 && !document.querySelector('.operation-banner'), null, 'conflitos e faixa removidos da tela')
  }
}
