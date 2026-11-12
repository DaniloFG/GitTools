// Aplicar e remover (pop) um stash pela lista: o trabalho guardado volta à árvore e ao stage, e o stash sai de
// `git stash list`.
export default {
  id: 'stash-pop',
  tela: 'Branches',
  area: 'stash',
  orcamento: { ms: 15000, nos: 5000, erros: 0, git: 0 },
  escreve: true,
  async passos(app, expect) {
    let esperado = []
    await app.repoNovo({
      wip: true,
      nome: 'pop-e2e',
      async preparar() {
        esperado = (await app.git('status', '--porcelain')).split('\n').filter(Boolean).sort()
        await app.git('stash', 'push', '--message', 'guardado-e2e')
      }
    })
    expect.igual(esperado.length, 2, 'alterações guardadas na partida')
    expect.igual(await app.git('status', '--porcelain'), '', 'árvore limpa depois do stash de partida')

    await app.aba('Branches')
    const item = app.page.locator('.stash-item').first()
    await item.waitFor()
    await item.hover()
    await item.locator('button[title="Apply and remove (pop)"]').click()

    // for-each-ref em vez de `stash list`: durante o pop a ref refs/stash some e `stash list` sairia com erro.
    await expect.ate(async () => (await app.git('for-each-ref', 'refs/stash')).trim() === '', 'stash removido (refs/stash)')
    expect.igual((await app.git('stash', 'list')).trim(), '', 'git stash list depois do pop')
    expect.igual((await app.git('status', '--porcelain')).split('\n').filter(Boolean).sort(), esperado, 'status depois do pop')
    await expect.pagina(() => document.querySelectorAll('.stash-item').length === 0, null, 'lista de Stashes vazia')
    await app.aba('Changes')
    await expect.visivel('.file-item', 2)
  }
}
