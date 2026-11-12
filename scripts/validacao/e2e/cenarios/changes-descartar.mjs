// Descartar um arquivo: pedir e cancelar não muda nada; confirmar volta o arquivo alterado ao HEAD e apaga o novo.
import { access, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export default {
  id: 'changes-descartar',
  tela: 'Changes',
  area: 'alteracoes',
  orcamento: { ms: 15000, nos: 5000, erros: 0, git: 0 },
  escreve: true,
  async passos(app, expect) {
    const { dir } = await app.repoNovo({
      wip: false,
      nome: 'descartar-e2e',
      async preparar({ dir: raiz }) {
        await writeFile(join(raiz, 'README.md'), '# Acme Shop\n\nTexto que vai ser descartado.\n')
        await writeFile(join(raiz, 'solto.txt'), 'arquivo novo\n')
      }
    })
    const original = await app.git('show', 'HEAD:README.md')
    expect.igual((await app.git('status', '--porcelain')).split('\n').filter(Boolean).sort(), [' M README.md', '?? solto.txt'], 'status antes de descartar')

    await app.aba('Changes')
    const linha = (caminho) => app.page.locator(`.csection-unstaged .file-item[data-copy="${caminho}"]`)
    const descartar = async (caminho) => {
      await linha(caminho).hover()
      await linha(caminho).locator('button[title="Discard"]').click()
      await app.page.locator('.modal').waitFor()
    }
    await expect.visivel('.csection-unstaged .file-item', 2)

    // Cancelar deixa tudo como estava.
    await descartar('README.md')
    await app.page.locator('.modal .modal-footer button', { hasText: 'Cancel' }).click()
    await app.page.locator('.modal').waitFor({ state: 'detached' })
    expect.igual((await app.git('status', '--porcelain')).split('\n').filter(Boolean).sort(), [' M README.md', '?? solto.txt'], 'status depois de cancelar')

    // Confirmar: o arquivo alterado volta ao conteúdo do HEAD e sai da lista.
    await descartar('README.md')
    await app.page.locator('.modal .modal-footer button.danger').click()
    await expect.pagina(() => !document.querySelector('.csection-unstaged .file-item[data-copy="README.md"]'), null, 'README.md fora da lista')
    expect.igual((await app.git('status', '--porcelain')).split('\n').filter(Boolean), ['?? solto.txt'], 'status depois de descartar README.md')
    expect.igual(await readFile(join(dir, 'README.md'), 'utf8'), original, 'conteúdo de README.md')

    // O arquivo novo (não rastreado) é apagado do disco.
    await descartar('solto.txt')
    await app.page.locator('.modal .modal-footer button.danger').click()
    await expect.pagina(() => !document.querySelector('.csection-unstaged .file-item'), null, 'lista Changes vazia')
    expect.igual(await app.git('status', '--porcelain'), '', 'status depois de descartar solto.txt')
    const existe = await access(join(dir, 'solto.txt')).then(() => true, () => false)
    expect.verdadeiro(!existe, 'solto.txt deveria ter sido apagado do disco')
  }
}
