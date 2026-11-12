// #95: cherry-pick de 3 commits que conflitam em sequência, no backend de verdade.
// - A faixa e o título da tela Conflitos mostram "step N of 3" em cada parada (progresso lido de sequencer/todo).
// - Com "Continuar automaticamente" ligado, resolver a parada abre a seguinte sem clicar em Continue.
// - O resultado é o do fluxo manual: três commits na ordem, árvore limpa, sem operação aberta e o arquivo com as
//   escolhas feitas (os dois lados em cada trecho).
// - Prova de resultado exato: o mesmo cherry-pick refeito À MÃO (git puro, num worktree à parte, com o arquivo de cada
//   parada igual ao que o aplicativo gravou) dá o mesmo `HEAD^{tree}` e a mesma lista de assuntos.
import { execFile } from 'node:child_process'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const LINHAS = (v) => Array.from({ length: 6 }, (_, i) => v(i)).join('\n') + '\n'
const TRECHOS = [0, 2, 4]

export default {
  id: 'conflito-cherry-pick-sequencia',
  tela: 'Conflitos',
  area: 'conflitos',
  orcamento: { ms: 30000, nos: 5000, erros: 0, git: 0 },
  escreve: true,
  // O cherry-pick e o continue saem com código 1 quando param em conflito: é o esperado, não erro.
  gitTolerado: [/^git cherry-pick --(stdin|continue)/],
  async passos(app, expect) {
    const original = await app.backend.invoke('app:getSettings', [])
    try {
      await app.backend.invoke('app:saveSettings', [{ ...original, autoContinueConflicts: true, conflictStartup: 'open', conflictSummary: 'keep' }])
      const shas = []
      const { dir } = await app.repoNovo({
        wip: false,
        nome: 'cherry-sequencia-e2e',
        // A `main` muda as linhas 0, 2 e 4; a `feature` tem um commit por linha: três paradas em sequência.
        async preparar() {
          await app.git('checkout', '-q', '-b', 'sequencia-base')
          await app.git('checkout', '-q', '-')
          await escreverCommit(app, 'seq: base', LINHAS((i) => `base ${i}`))
          await app.git('checkout', '-q', '-b', 'sequencia')
          for (const n of TRECHOS) {
            await escreverCommit(app, `seq: feature ${n}`, LINHAS((i) => (i <= n && i % 2 === 0 ? `feature ${i}` : `base ${i}`)))
            shas.push((await app.git('rev-parse', 'HEAD')).trim())
          }
          await app.git('checkout', '-q', 'main')
          await escreverCommit(app, 'seq: main muda', LINHAS((i) => (i % 2 === 0 ? `main ${i}` : `base ${i}`)))
        }
      })

      // O cherry-pick sai pelo backend (é ele que guarda o total, o git só sabe o que falta).
      const inicio = await app.backend.invoke('repo:invoke', ['cherryPickCommits', ['main', shas], dir])
      expect.igual(inicio.ok, false, 'o cherry-pick deveria parar em conflito')
      await app.page.evaluate(() => window.__emit('repo:changed'))

      for (const parada of TRECHOS.keys()) {
        const passo = `(step ${parada + 1} of 3)`
        await expect.pagina((p) => document.querySelector('.operation-banner .operation-title strong')?.textContent?.includes(p), passo, `faixa com ${passo}`)
        if (parada === 0) {
          // Com conflictStartup 'open' a tela pode já ter aberto sozinha; clicar de novo não deve alternar.
          if ((await app.page.locator('.conflicts-screen').count()) === 0) await app.page.locator('button.operation-title').click()
          await app.page.locator('.conflicts-screen').waitFor()
        }
        await app.page.locator('.conflicts-screen').waitFor()
        const titulo = await app.page.locator('.conflicts-screen .conflicts-title').textContent()
        expect.verdadeiro(titulo.includes(`step ${parada + 1} of 3`), `título da tela com step ${parada + 1} de 3 (veio: ${titulo})`)
        expect.igual(await app.page.locator('.conflicts-row').count(), 1, `um arquivo em conflito na parada ${parada + 1}`)
        await app.page.locator('.conflicts-row').first().click()
        await app.page.locator('.conflict-editor .merge-editor').waitFor()
        await app.page.locator('.conflict-editor button', { hasText: /Keep both|Both/ }).first().click()
        await app.page.locator('.conflict-editor-foot button.primary').click()
        // Sem clique em Continue: o aplicativo continua sozinho (a última parada termina a operação).
        if (parada < TRECHOS.length - 1) {
          const proximo = `(step ${parada + 2} of 3)`
          await expect.pagina((p) => document.querySelector('.operation-banner .operation-title strong')?.textContent?.includes(p), proximo, `continuou sozinho até ${proximo}`)
        }
      }
      await expect.ate(() => access(join(dir, '.git', 'CHERRY_PICK_HEAD')).then(() => false, () => true), 'operação terminada no git')
      await expect.pagina(() => !document.querySelector('.operation-banner'), null, 'faixa da operação removida')

      const assuntos = (await app.git('log', '--format=%s', '-4')).trim().split('\n')
      expect.igual(assuntos, ['seq: feature 4', 'seq: feature 2', 'seq: feature 0', 'seq: main muda'], 'histórico depois do cherry-pick')
      expect.igual(await app.git('status', '--porcelain'), '', 'status depois do último commit')
      const arquivo = await readFile(join(dir, 'f.txt'), 'utf8')
      expect.verdadeiro(!/^(<<<<<<<|=======|>>>>>>>)/m.test(arquivo), 'o arquivo não deveria ter marcadores')
      for (const n of TRECHOS) expect.verdadeiro(arquivo.includes(`main ${n}`) && arquivo.includes(`feature ${n}`), `os dois lados do trecho ${n}`)
      const arvoreApp = (await app.git('rev-parse', 'HEAD^{tree}')).trim()
      expect.igual(await arvoreDoFluxoManual(app, shas), arvoreApp, '`HEAD^{tree}` do fluxo manual igual ao do aplicativo')
    } finally {
      await app.backend.invoke('app:saveSettings', [original])
    }
  }
}

async function escreverCommit(app, assunto, texto) {
  const { writeFile } = await import('node:fs/promises')
  const dir = (await app.git('rev-parse', '--show-toplevel')).trim()
  await writeFile(join(dir, 'f.txt'), texto)
  await app.git('add', 'f.txt')
  await app.git('commit', '-q', '-m', assunto)
}

/**
 * Refaz o cherry-pick sem o aplicativo: worktree no `main` de antes, `git cherry-pick` de cada commit, o arquivo de cada
 * parada é o que o aplicativo gravou no commit correspondente (HEAD~2, HEAD~1, HEAD). Devolve o `HEAD^{tree}` do fim.
 */
async function arvoreDoFluxoManual(app, shas) {
  const base = (await app.git('rev-parse', 'HEAD~3')).trim()
  const gravados = []
  for (let k = shas.length - 1; k >= 0; k--) gravados.push((await app.git('show', `HEAD~${k}:f.txt`)))
  const dirRepo = (await app.git('rev-parse', '--show-toplevel')).trim()
  const tmp = await mkdtemp(join(tmpdir(), 'manual-cherry-'))
  const wt = join(tmp, 'wt')
  const g = (...args) => execFileAsync('git', ['-C', wt, '-c', 'core.editor=true', ...args], { encoding: 'utf8' }).then((r) => r.stdout.trim(), (e) => { if (e.code === 1) return ''; throw e })
  try {
    await execFileAsync('git', ['-C', dirRepo, 'worktree', 'add', '--detach', wt, base])
    await g('cherry-pick', ...shas)
    for (const i of shas.keys()) {
      await writeFile(join(wt, 'f.txt'), gravados[i])
      await g('add', 'f.txt')
      await g('cherry-pick', '--continue')
    }
    return await g('rev-parse', 'HEAD^{tree}')
  } finally {
    await execFileAsync('git', ['-C', dirRepo, 'worktree', 'remove', '--force', wt]).catch(() => {})
    await rm(tmp, { recursive: true, force: true })
  }
}
