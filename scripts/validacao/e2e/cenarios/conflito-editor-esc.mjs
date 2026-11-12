// #96: com poucos conflitos, o editor abre no painel da tela. Esc com o foco dentro do editor fecha SÓ o editor (a tela
// continua aberta) e o foco volta à linha da lista; um segundo Esc, agora com o foco na lista, fecha a tela.
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const ARQUIVOS = 3

export default {
  id: 'conflito-editor-esc',
  tela: 'Conflitos',
  area: 'conflitos',
  orcamento: { ms: 20000, nos: 5000, erros: 0, git: 0 },
  async passos(app, expect) {
    await app.repoNovo({
      wip: false,
      nome: 'esc-e2e',
      // Mesmo preparo de conflito-resolver-muitos, com 3 arquivos: o cherry-pick sai com código 1, o esperado.
      async preparar({ dir: repo }) {
        await mkdir(join(repo, 'lote'), { recursive: true })
        const escrever = (versao) => Promise.all(Array.from({ length: ARQUIVOS }, (_, n) => writeFile(join(repo, `lote/arq-${n}.txt`), `${versao} ${n}\n`)))
        await escrever('base')
        await app.git('add', '-A')
        await app.git('commit', '-q', '-m', 'lote: base')
        await app.git('checkout', '-q', '-b', 'lote-deles')
        await escrever('deles')
        await app.git('add', '-A')
        await app.git('commit', '-q', '-m', 'lote: deles')
        const deles = (await app.git('rev-parse', 'HEAD')).trim()
        await app.git('checkout', '-q', 'main')
        await escrever('nosso')
        await app.git('add', '-A')
        await app.git('commit', '-q', '-m', 'lote: nosso')
        await app.git('cherry-pick', deles).then(
          () => { throw new Error('o cherry-pick deveria parar em conflito') },
          (erro) => { if (erro.code !== 1) throw erro }
        )
      }
    })

    await app.page.locator('button.operation-title').click()
    await app.page.locator('.conflicts-screen').waitFor()
    const linha = app.page.locator('.conflicts-row').first()
    const caminho = await linha.getAttribute('title')
    await linha.click()
    await app.page.locator('.conflict-editor .merge-editor').waitFor()

    // Foco dentro do editor: o Esc vindo de lá fecha só o editor, não a tela.
    // Botão habilitado da barra do editor: o "anterior" fica desabilitado no primeiro conflito e não recebe foco.
    await app.page.locator('.conflict-editor .merge-toolbar button:not([disabled])').first().focus()
    expect.verdadeiro(await app.page.evaluate(() => !!document.activeElement?.closest('.conflict-editor')), 'o foco deveria estar dentro do editor antes do Esc')
    await app.page.keyboard.press('Escape')
    await expect.pagina(() => !document.querySelector('.conflict-editor'), null, 'editor fechado pelo Esc')
    expect.igual(await app.page.locator('.conflicts-screen').count(), 1, 'tela continua aberta depois do Esc no editor')
    // O foco volta à linha do arquivo que estava aberto.
    await expect.pagina((c) => document.activeElement?.classList.contains('conflicts-row') && document.activeElement.getAttribute('title') === c, caminho, 'foco de volta à linha do arquivo')

    // Segundo Esc, com o foco na lista: fecha a tela.
    await app.page.keyboard.press('Escape')
    await app.page.locator('.conflicts-screen').waitFor({ state: 'detached' })
  }
}
