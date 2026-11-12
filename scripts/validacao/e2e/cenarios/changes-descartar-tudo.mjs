// "Discard all": a lista Changes fica vazia (mostra o aviso de vazio) e o git não vê mais nenhuma alteração.
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export default {
  id: 'changes-descartar-tudo',
  tela: 'Changes',
  area: 'alteracoes',
  orcamento: { ms: 15000, nos: 5000, erros: 0, git: 0 },
  escreve: true,
  async passos(app, expect) {
    await app.repoNovo({
      wip: false,
      nome: 'tudo-e2e',
      async preparar({ dir: raiz }) {
        await writeFile(join(raiz, 'README.md'), '# Acme Shop\n\nAlterado.\n')
        await writeFile(join(raiz, 'package.json'), '{}\n')
        await writeFile(join(raiz, 'um.txt'), '1\n')
        await writeFile(join(raiz, 'dois.txt'), '2\n')
      }
    })
    expect.igual((await app.git('status', '--porcelain')).split('\n').filter(Boolean).length, 4, 'alterações antes de descartar')

    await app.aba('Changes')
    await expect.visivel('.csection-unstaged .file-item', 4)
    await app.page.locator('.csection-unstaged .csection-actions button', { hasText: 'Discard all' }).click()
    await app.page.locator('.modal').waitFor()
    await app.page.locator('.modal .modal-footer button.danger').click()

    await expect.pagina(() => document.querySelectorAll('.csection-unstaged .file-item').length === 0 && !!document.querySelector('.csection-unstaged .section-empty'), null, 'lista Changes vazia com o aviso de vazio')
    expect.igual(await app.git('status', '--porcelain'), '', 'status depois de descartar tudo')
    // Sem arquivos não há o que descartar nem pôr no stage: os botões em massa saem do cabeçalho.
    expect.igual(await app.page.locator('.csection-unstaged .csection-actions button', { hasText: /Discard all|Stage all/ }).count(), 0, 'botões em massa com a lista vazia')
  }
}
