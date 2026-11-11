import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { GitRepository } from '../src/core/repository'
import { wholeFileKeys } from '../src/renderer/src/fileMenu'
import type { OperationResult, PartialApplyOptions } from '../src/shared/types'
import { createRepo, lines } from './helpers'

// Os testes verificam mensagens em português: `setLocale('pt-BR')` roda em `helpers.ts`, importado acima.

/** Trinta linhas numeradas: alterações em 2 e 25 ficam longe o bastante para virar dois hunks. */
const NUMBERED = lines(...Array.from({ length: 30 }, (_, i) => `linha ${i + 1}`))

/**
 * "Aplicar arquivo inteiro" (CompareView.applyFile) sem React: lê o diff do arquivo com `uncapped`, marca todas as
 * linhas alteradas com `wholeFileKeys` e entrega ao `cherryPickLines`. Erro de `wholeFileKeys` volta sem tocar nada.
 */
async function applyWholeFile(
  repo: GitRepository,
  target: string,
  from: string,
  to: string,
  path: string,
  options?: PartialApplyOptions
): Promise<{ error: 'noChanges' | 'binary' } | OperationResult> {
  const files = await repo.diff({ kind: 'range', from, to, fullFile: false, path, uncapped: true })
  const whole = wholeFileKeys(files, path)
  if ('error' in whole) return whole
  return repo.cherryPickLines(target, { kind: 'range', from, to }, path, whole.keys, options)
}

/**
 * Repositório com `main` e `feature` divergidos: `feature` muda `a.txt` (duas partes distantes); `main` muda só
 * `outro.txt`, então `a.txt` não divergiu em `main`. Devolve a base (merge-base) para o intervalo do menu.
 */
async function scenario() {
  const t = await createRepo()
  await t.commit('init', { 'a.txt': NUMBERED, 'outro.txt': 'x\n' })
  await t.git('checkout', '-q', '-b', 'feature')
  const featureA = NUMBERED.replace('linha 2\n', 'linha 2 editada\n').replace('linha 25\n', 'linha 25 editada\n')
  await t.commit('feature muda a', { 'a.txt': featureA })
  await t.git('checkout', '-q', 'main')
  await t.commit('main mexe em outro', { 'outro.txt': 'y\n' })
  const base = (await t.git('merge-base', 'main', 'feature')).trim()
  return { t, base, featureA }
}

describe('Aplicar arquivo inteiro (diff uncapped, wholeFileKeys, cherryPickLines)', () => {
  it('a) arquivo modificado em vários hunks: o staged de main fica igual ao de feature', async () => {
    const { t, base, featureA } = await scenario()
    // Sanidade: o diff do arquivo tem mesmo dois hunks, senão o caso não prova nada sobre vários hunks.
    const [file] = await t.repo.diff({ kind: 'range', from: base, to: 'feature', fullFile: false, path: 'a.txt', uncapped: true })
    expect(file.hunks).toHaveLength(2)

    const result = await applyWholeFile(t.repo, 'main', base, 'feature', 'a.txt')
    expect('error' in result).toBe(false)
    expect(result).toMatchObject({ ok: true, conflicts: [] })

    // O que vai para o stage é a versão de feature, byte a byte (blob do índice).
    expect(await t.git('show', ':a.txt')).toBe(featureA)
    expect(readFileSync(join(t.dir, 'a.txt'), 'utf8')).toBe(featureA)
    const status = await t.repo.status()
    expect(status.staged.map((f) => f.path)).toEqual(['a.txt'])
    expect(status.unstaged).toEqual([])
    // Sem commit: o HEAD continua o de main.
    expect((await t.repo.log({ limit: 1 }))[0].subject).toBe('main mexe em outro')
  })

  it('b) arquivo novo em feature: é criado em main e fica staged', async () => {
    const t = await createRepo()
    await t.commit('init', { 'a.txt': 'a\n' })
    await t.git('checkout', '-q', '-b', 'feature')
    await t.commit('feature cria', { 'novo.txt': NUMBERED })
    await t.git('checkout', '-q', 'main')
    await t.commit('main mexe em outro', { 'outro.txt': 'y\n' })
    const base = (await t.git('merge-base', 'main', 'feature')).trim()

    const [file] = await t.repo.diff({ kind: 'range', from: base, to: 'feature', fullFile: false, path: 'novo.txt', uncapped: true })
    expect(file.changeType).toBe('added')

    const result = await applyWholeFile(t.repo, 'main', base, 'feature', 'novo.txt')
    expect(result).toMatchObject({ ok: true })
    expect(readFileSync(join(t.dir, 'novo.txt'), 'utf8')).toBe(NUMBERED)
    expect(await t.git('show', ':novo.txt')).toBe(NUMBERED)
    const status = await t.repo.status()
    expect(status.staged.map((f) => [f.path, f.index])).toEqual([['novo.txt', 'A']])
    expect(status.unstaged).toEqual([])
  })

  it('c) arquivo renomeado em feature: aplica só o lado novo; o antigo fica como estava', async () => {
    const t = await createRepo()
    await t.commit('init', { 'antigo.txt': NUMBERED, 'outro.txt': 'x\n' })
    await t.git('checkout', '-q', '-b', 'feature')
    await t.git('mv', 'antigo.txt', 'novo.txt')
    const novoFeature = NUMBERED.replace('linha 3\n', 'linha 3 editada\n')
    await t.commit('renomeia e edita', { 'novo.txt': novoFeature })
    await t.git('checkout', '-q', 'main')
    await t.commit('main mexe em outro', { 'outro.txt': 'y\n' })
    const base = (await t.git('merge-base', 'main', 'feature')).trim()

    // Comportamento real da comparação: o arquivo aparece como renomeado, com o caminho antigo em `oldPath`.
    const comparison = await t.repo.compare('main', 'feature')
    expect(comparison.files.find((f) => f.path === 'novo.txt')).toMatchObject({ status: 'R', oldPath: 'antigo.txt' })

    // Comportamento real do menu: o diff é pedido com o caminho NOVO (pathspec), e com um caminho só o git não
    // pareia com o antigo. O arquivo chega como adição inteira, sem `oldPath`. Consequência: o caminho antigo não
    // é removido em main; só o novo é criado. Não é apagamento silencioso (o antigo continua intacto), mas a
    // renomeação não é reproduzida por inteiro.
    const files = await t.repo.diff({ kind: 'range', from: base, to: 'feature', fullFile: false, path: 'novo.txt', uncapped: true })
    expect(files.map((f) => [f.path, f.changeType, f.oldPath])).toEqual([['novo.txt', 'added', null]])

    const result = await applyWholeFile(t.repo, 'main', base, 'feature', 'novo.txt')
    expect(result).toMatchObject({ ok: true })
    expect(readFileSync(join(t.dir, 'novo.txt'), 'utf8')).toBe(novoFeature)
    // Nada fora do esperado mudou: o antigo segue no disco e no índice, com o conteúdo de main.
    expect(existsSync(join(t.dir, 'antigo.txt'))).toBe(true)
    expect(readFileSync(join(t.dir, 'antigo.txt'), 'utf8')).toBe(NUMBERED)
    expect(await t.git('show', ':antigo.txt')).toBe(NUMBERED)
    const status = await t.repo.status()
    expect(status.staged.map((f) => [f.path, f.index])).toEqual([['novo.txt', 'A']])
    expect(status.unstaged).toEqual([])
  })

  it('d) conflito: main mudou as mesmas linhas; volta ok false com conflitos, sem exceção e sem operação pendente', async () => {
    const t = await createRepo()
    await t.commit('init', { 'a.txt': 'linha 1\nlinha 2\nlinha 3\n' })
    await t.git('checkout', '-q', '-b', 'feature')
    await t.commit('feature muda', { 'a.txt': 'linha 1\nfeature\nlinha 3\n' })
    await t.git('checkout', '-q', 'main')
    await t.commit('main muda a mesma linha', { 'a.txt': 'linha 1\nmain\nlinha 3\n' })
    const base = (await t.git('merge-base', 'main', 'feature')).trim()

    const result = await applyWholeFile(t.repo, 'main', base, 'feature', 'a.txt')
    expect('error' in result).toBe(false)
    expect(result).toMatchObject({ ok: false, conflicts: ['a.txt'] })

    // Estado real: o `apply --3way` deixa o arquivo não mesclado no índice, sem CHERRY_PICK_HEAD nem MERGE_HEAD.
    const status = await t.repo.status()
    expect(status.conflicted.map((f) => f.path)).toEqual(['a.txt'])
    expect((await t.repo.operationState()).kind).toBe('none')
    expect(readFileSync(join(t.dir, 'a.txt'), 'utf8')).toContain('<<<<<<<')
    // Nada foi commitado: o HEAD continua o de main.
    expect((await t.repo.log({ limit: 1 }))[0].subject).toBe('main muda a mesma linha')
  })

  it('e) binário: wholeFileKeys devolve erro e nada é alterado', async () => {
    const t = await createRepo()
    await t.commit('init', { 'a.txt': 'a\n' })
    await t.git('checkout', '-q', '-b', 'feature')
    await t.commit('feature binário', { 'img.bin': 'PNG\0\0\0\0dados\0\0' })
    await t.git('checkout', '-q', 'main')
    await t.commit('main mexe em outro', { 'outro.txt': 'y\n' })
    const base = (await t.git('merge-base', 'main', 'feature')).trim()

    const files = await t.repo.diff({ kind: 'range', from: base, to: 'feature', fullFile: false, path: 'img.bin', uncapped: true })
    expect(files[0].binary).toBe(true)
    expect(wholeFileKeys(files, 'img.bin')).toEqual({ error: 'binary' })

    const result = await applyWholeFile(t.repo, 'main', base, 'feature', 'img.bin')
    expect(result).toEqual({ error: 'binary' })
    expect(existsSync(join(t.dir, 'img.bin'))).toBe(false)
    const status = await t.repo.status()
    expect(status.staged).toEqual([])
    expect(status.unstaged).toEqual([])
    expect((await t.repo.log({ limit: 1 }))[0].subject).toBe('main mexe em outro')
  })

  it('f) com commitMessage o commit é criado com ela; sem, o conteúdo fica staged', async () => {
    const withMessage = await scenario()
    const committed = await applyWholeFile(withMessage.t.repo, 'main', withMessage.base, 'feature', 'a.txt', {
      commitMessage: 'aplica a.txt inteiro'
    })
    expect(committed).toMatchObject({ ok: true })
    const headLog = await withMessage.t.repo.log({ limit: 1 })
    expect(headLog[0].subject).toBe('aplica a.txt inteiro')
    expect(await withMessage.t.git('show', 'HEAD:a.txt')).toBe(withMessage.featureA)
    const afterCommit = await withMessage.t.repo.status()
    expect(afterCommit.staged).toEqual([])
    expect(afterCommit.unstaged).toEqual([])

    const staged = await scenario()
    const left = await applyWholeFile(staged.t.repo, 'main', staged.base, 'feature', 'a.txt')
    expect(left).toMatchObject({ ok: true })
    expect((await staged.t.repo.log({ limit: 1 }))[0].subject).toBe('main mexe em outro')
    expect((await staged.t.repo.status()).staged.map((f) => f.path)).toEqual(['a.txt'])
  })

  it('g) caminho hostil (..) ou absoluto não escreve fora da raiz do repositório', async () => {
    const { t, base } = await scenario()
    const parent = join(t.dir, '..', 'fora.txt')
    expect(existsSync(parent)).toBe(false)

    // O diff com caminho hostil é recusado pelo git ("outside repository") antes de qualquer escrita.
    await expect(applyWholeFile(t.repo, 'main', base, 'feature', '../fora.txt')).rejects.toThrow()
    await expect(applyWholeFile(t.repo, 'main', base, 'feature', '/etc/passwd')).rejects.toThrow()

    expect(existsSync(parent)).toBe(false)
    expect(existsSync(join(t.dir, 'etc', 'passwd'))).toBe(false)
    const status = await t.repo.status()
    expect(status.staged).toEqual([])
    expect(status.unstaged).toEqual([])
    expect(status.branch).toBe('main')
  })
})
