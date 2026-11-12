// Conflito de cherry-pick resolvido na tela e continuado: o git passa a ter o commit aplicado, com o mesmo assunto
// do original, sem operação aberta, árvore limpa e os dois lados no arquivo.
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export default {
  id: 'conflito-continuar',
  tela: 'Conflitos',
  area: 'conflitos',
  orcamento: { ms: 15000, nos: 5000, erros: 0, git: 0 },
  escreve: true,
  async passos(app, expect) {
    // O conflito nasce de um cherry-pick feito fora do backend, que sai com código 1 (esperado); a página o lê ao abrir.
    const { dir, ids } = await app.repoNovo({
      wip: false,
      nome: 'continuar-e2e',
      async preparar({ ids: i }) {
        await app.git('cherry-pick', i.memberPrice).then(
          () => { throw new Error('o cherry-pick deveria parar em conflito') },
          (erro) => { if (erro.code !== 1) throw erro }
        )
      }
    })
    const antes = (await app.git('rev-parse', 'HEAD')).trim()
    expect.igual(antes, ids.merge, 'HEAD durante o conflito')

    await app.page.locator('button.operation-title').click()
    await app.page.locator('.conflicts-screen').waitFor()
    // Continuar fica desligado enquanto houver conflito.
    const continuar = app.page.locator('.conflicts-actions button', { hasText: 'Continue' })
    expect.igual(await continuar.isDisabled(), true, 'botão Continue com conflito pendente')
    await app.page.locator('.conflicts-row').first().click()
    await app.page.locator('.conflict-editor .merge-editor').waitFor()
    await app.page.locator('.conflict-editor button', { hasText: /Keep both|Both/ }).first().click()
    await app.page.locator('.conflict-editor-foot button.primary').click()
    await expect.pagina(() => !document.querySelector('.conflict-editor') && document.querySelectorAll('.conflicts-row').length === 0, null, 'conflito resolvido na tela')
    await expect.pagina(() => [...document.querySelectorAll('.conflicts-actions button')].some((b) => b.textContent?.trim() === 'Continue' && !b.disabled), null, 'botão Continue habilitado')

    await continuar.click()
    await expect.ate(async () => (await app.git('rev-parse', 'HEAD')).trim() !== antes, 'novo commit no HEAD')
    expect.igual((await app.git('log', '-1', '--format=%s')).trim(), 'Cart: member prices', 'assunto do commit aplicado')
    expect.igual((await app.git('rev-parse', 'HEAD~1')).trim(), antes, 'pai do commit aplicado')
    expect.igual(await app.git('status', '--porcelain'), '', 'status depois de continuar')
    expect.igual((await app.git('branch', '--show-current')).trim(), 'main', 'branch atual')
    const aberta = await access(join(dir, '.git', 'CHERRY_PICK_HEAD')).then(() => true, () => false)
    expect.igual(aberta, false, 'cherry-pick ainda aberto')
    const conteudo = await readFile(join(dir, 'src/cart.js'), 'utf8')
    expect.verdadeiro(conteudo.includes('applyDiscount') && conteudo.includes('memberPrice') && !/^(<<<<<<<|>>>>>>>)/m.test(conteudo), 'o arquivo deveria ter os dois lados e nenhum marcador')
    // A faixa da operação some quando não há mais operação.
    await expect.pagina(() => !document.querySelector('.operation-banner'), null, 'faixa da operação removida')
  }
}
