// #96: as opções da tela Conflitos, no que a tela faz de verdade.
// - conflictSummary 'close': a tela fecha sozinha quando a operação termina (Continue); 'keep' (padrão): fica aberta.
// - conflictStartup 'open' (padrão): a tela abre na partida com conflito pendente; 'bannerOnly': só a faixa, e o título abre.
// As opções são salvas no backend e a página é recarregada (repoNovo), que é como a interface as lê na partida. Os
// valores originais voltam no fim, mesmo se o cenário falhar.
import { access, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const ARQUIVOS = 2

/** Repositório com o cherry-pick parado em ARQUIVOS conflitos (o código 1 do git é o esperado). */
async function conflitoNovo(app, nome) {
  return app.repoNovo({
    wip: false,
    nome,
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
}

/** Resolve todos os arquivos pela tela e espera Continue habilitado. */
async function resolverTodos(app, expect) {
  for (let restam = ARQUIVOS; restam > 0; restam--) {
    await app.page.locator('.conflicts-row').first().click()
    await app.page.locator('.conflict-editor .merge-editor').waitFor()
    // "Use incoming" (o lado que está sendo aplicado): o resultado difere de HEAD, então o Continue cria um commit. Com
    // "Use current" o resultado seria igual a HEAD, o cherry-pick ficaria vazio e o `--continue` sairia com erro.
    await app.page.locator('.conflict-file-actions button', { hasText: /^Use incoming$/ }).click()
    // Sem o arquivo resolvido, o total também cai: o contador é "Pending: N of N".
    await expect.pagina((n) => document.querySelector('.conflicts-counts')?.textContent === `Pending: ${n} of ${n}`, restam - 1, `contador com ${restam - 1} pendentes`)
  }
  await expect.pagina(() => [...document.querySelectorAll('.conflicts-actions button')].some((b) => b.textContent?.trim() === 'Continue' && !b.disabled), null, 'botão Continue habilitado')
}

/** Espera o cherry-pick sair da operação (CHERRY_PICK_HEAD some quando o git termina). */
async function esperarOperacaoTerminar(app, expect, dir) {
  await expect.ate(() => access(join(dir, '.git', 'CHERRY_PICK_HEAD')).then(() => false, () => true), 'operação terminada no git')
}

/** Dois frames de animação: deixa a interface assentar antes de afirmar que algo NÃO aconteceu (a tela não fechou). */
const assentar = (page) => page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))))

export default {
  id: 'conflito-configuracoes',
  tela: 'Conflitos',
  area: 'conflitos',
  orcamento: { ms: 60000, nos: 5000, erros: 0, git: 0 },
  escreve: true,
  async passos(app, expect) {
    const original = await app.backend.invoke('app:getSettings', [])
    const salvar = (mudanca) => app.backend.invoke('app:saveSettings', [{ ...original, ...mudanca }])
    try {
      // 1) Padrão de partida (abre) + resumo "fechar": a tela abre sozinha; ao Continue, a operação termina e a tela fecha.
      await salvar({ conflictStartup: 'open', conflictSummary: 'close' })
      const fechar = await conflitoNovo(app, 'config-fechar-e2e')
      await app.page.locator('.conflicts-screen').waitFor()
      await resolverTodos(app, expect)
      await app.page.locator('.conflicts-actions button', { hasText: 'Continue' }).click()
      await esperarOperacaoTerminar(app, expect, fechar.dir)
      await app.page.locator('.conflicts-screen').waitFor({ state: 'detached' })

      // 2) Resumo "manter" (padrão): mesmo fim de operação, e a tela continua aberta.
      await salvar({ conflictStartup: 'open', conflictSummary: 'keep' })
      const manter = await conflitoNovo(app, 'config-manter-e2e')
      await app.page.locator('.conflicts-screen').waitFor()
      await resolverTodos(app, expect)
      await app.page.locator('.conflicts-actions button', { hasText: 'Continue' }).click()
      await esperarOperacaoTerminar(app, expect, manter.dir)
      await expect.pagina(() => !document.querySelector('.operation-banner'), null, 'faixa da operação removida depois de Continue')
      await assentar(app.page)
      expect.igual(await app.page.locator('.conflicts-screen').count(), 1, 'tela continua aberta com o resumo "manter"')

      // 3) "Só a faixa" na partida: com conflito, a faixa aparece e a tela não abre; o título abre a tela.
      await salvar({ conflictStartup: 'bannerOnly', conflictSummary: 'keep' })
      await conflitoNovo(app, 'config-faixa-e2e')
      await app.page.locator('.operation-banner.has-conflicts').waitFor()
      await assentar(app.page)
      expect.igual(await app.page.locator('.conflicts-screen').count(), 0, 'tela fechada na partida com "só a faixa"')
      await app.page.locator('button.operation-title').click()
      await app.page.locator('.conflicts-screen').waitFor()
    } finally {
      await app.backend.invoke('app:saveSettings', [original])
    }
  }
}
