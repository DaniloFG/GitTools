// #96/#149: merge com conflito resolvido na tela de Conflitos e concluído pelo commit da aba Alterações (sem usar o
// botão Continue). O git confirma: MERGE_HEAD some (operação encerrada), o commit tem os dois pais, árvore limpa e os
// dois lados no arquivo; a faixa da operação desaparece da interface.
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export default {
  id: 'conflito-merge-por-alteracoes',
  tela: 'Conflitos',
  area: 'conflitos',
  orcamento: { ms: 20000, nos: 5000, erros: 0, git: 0 },
  escreve: true,
  async passos(app, expect) {
    // O merge para em conflito (código 1, esperado); feito fora do backend, não entra na conta de processos.
    const { dir, ids } = await app.repoNovo({
      wip: false,
      nome: 'merge-alteracoes-e2e',
      async preparar() {
        await app.git('merge', '--no-ff', 'feature/member-price').then(
          () => { throw new Error('o merge deveria parar em conflito') },
          (erro) => { if (erro.code !== 1) throw erro }
        )
      }
    })
    const antes = (await app.git('rev-parse', 'HEAD')).trim()
    const mergeHead = (await app.git('rev-parse', 'MERGE_HEAD')).trim()
    expect.verdadeiro(mergeHead.length >= 40, 'MERGE_HEAD deveria existir durante o conflito')

    await app.page.locator('button.operation-title').click()
    await app.page.locator('.conflicts-screen').waitFor()
    await app.page.locator('.conflicts-row').first().click()
    await app.page.locator('.conflict-editor .merge-editor').waitFor()
    await app.page.locator('.conflict-editor button', { hasText: /Keep both|Both/ }).first().click()
    await app.page.locator('.conflict-editor-foot button.primary').click()
    await expect.pagina(() => !document.querySelector('.conflict-editor') && document.querySelectorAll('.conflicts-row').length === 0, null, 'conflito resolvido na tela')
    expect.igual((await app.git('diff', '--name-only', '--diff-filter=U')).trim(), '', 'sem entrada de conflito no índice')
    // Ainda é um merge em andamento: o commit é que o encerra.
    expect.igual((await app.git('rev-parse', 'MERGE_HEAD')).trim(), mergeHead, 'MERGE_HEAD antes do commit')

    await app.aba('Changes')
    await app.page.locator('.commit-box textarea').waitFor()
    // O assunto do merge costuma vir preenchido pelo git (MERGE_MSG); se vier vazio, o cenário digita um.
    if ((await app.page.locator('.commit-box textarea').inputValue()).trim() === '') await app.page.locator('.commit-box textarea').fill('Merge feature/member-price')
    await expect.pagina(() => !document.querySelector('.commit-box .commit-actions button')?.disabled, null, 'botão de commit habilitado')
    await app.page.locator('.commit-box .commit-actions button').click()

    await expect.ate(async () => (await app.git('rev-parse', 'HEAD')).trim() !== antes, 'novo commit no HEAD')
    expect.igual((await app.git('rev-parse', 'HEAD^1')).trim(), antes, 'primeiro pai do merge')
    expect.igual((await app.git('rev-parse', 'HEAD^2')).trim(), ids.memberPrice, 'segundo pai do merge')
    expect.igual(await app.git('status', '--porcelain'), '', 'status depois do commit')
    const aberto = await access(join(dir, '.git', 'MERGE_HEAD')).then(() => true, () => false)
    expect.igual(aberto, false, 'merge ainda aberto')
    const conteudo = await readFile(join(dir, 'src/cart.js'), 'utf8')
    expect.verdadeiro(conteudo.includes('applyDiscount') && conteudo.includes('memberPrice') && !/^(<<<<<<<|>>>>>>>)/m.test(conteudo), 'o arquivo deveria ter os dois lados e nenhum marcador')
    // A faixa some e a tela Conflitos não tem mais o que mostrar.
    await expect.pagina(() => !document.querySelector('.operation-banner'), null, 'faixa da operação removida')
  }
}
