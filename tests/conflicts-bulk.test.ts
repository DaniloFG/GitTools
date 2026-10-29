import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createRepo, type TestRepo } from './helpers'

// Mais que um lote de 100 caminhos, para exercitar a divisão em lotes.
const N = 250

/** Repositório com N arquivos em conflito de conteúdo e um em conflito "modificado × removido". */
async function manyConflicts(): Promise<TestRepo> {
  const t = await createRepo()
  const files = (prefix: string) => Object.fromEntries(Array.from({ length: N }, (_, i) => [`src/f${i}.txt`, `${prefix} ${i}\n`]))
  await t.commit('base', { ...files('base'), 'removido.txt': 'base\n' })
  await t.git('checkout', '-q', '-b', 'feature')
  await t.commit('feature muda', files('feature'))
  await t.git('rm', '-q', 'removido.txt')
  await t.git('commit', '-q', '-m', 'feature remove')
  await t.git('checkout', '-q', 'main')
  await t.commit('main muda', { ...files('main'), 'removido.txt': 'main mudou\n' })
  const merged = await t.repo.merge('feature', 'main')
  expect(merged.ok).toBe(false)
  return t
}

const conflictedPaths = async (t: TestRepo) => (await t.repo.status()).conflicted.map((f) => f.path)

describe('resolveConflicts (vários arquivos de uma vez)', () => {
  it('"ours" mantém a versão atual de todos os arquivos, passando por vários lotes', async () => {
    const t = await manyConflicts()
    const paths = await conflictedPaths(t)
    expect(paths).toHaveLength(N + 1)

    const result = await t.repo.resolveConflicts(paths, 'ours')
    expect(result).toEqual({ resolved: N + 1, failed: [] })
    expect((await t.repo.status()).conflicted).toEqual([])
    expect(readFileSync(join(t.dir, 'src/f7.txt'), 'utf8')).toBe('main 7\n')
    expect(readFileSync(join(t.dir, 'src/f240.txt'), 'utf8')).toBe('main 240\n')
    expect(readFileSync(join(t.dir, 'removido.txt'), 'utf8')).toBe('main mudou\n')
  })

  it('"theirs" aceita a versão que entra; arquivo que o outro lado removeu some', async () => {
    const t = await manyConflicts()
    const result = await t.repo.resolveConflicts(await conflictedPaths(t), 'theirs')
    expect(result).toEqual({ resolved: N + 1, failed: [] })
    expect((await t.repo.status()).conflicted).toEqual([])
    expect(readFileSync(join(t.dir, 'src/f200.txt'), 'utf8')).toBe('feature 200\n')
    expect(existsSync(join(t.dir, 'removido.txt'))).toBe(false)
    expect((await t.git('ls-files', 'removido.txt')).trim()).toBe('')
  })

  it('"resolved" deixa de fora os arquivos que ainda têm marcadores de conflito', async () => {
    const t = await manyConflicts()
    // O git já deixa os marcadores no texto. Quem editou à mão e tirou os marcadores pode marcar como resolvido;
    // o f3 continua com eles e fica de fora.
    for (let i = 0; i < N; i++) if (i !== 3) t.write(`src/f${i}.txt`, `editado ${i}\n`)
    const result = await t.repo.resolveConflicts(await conflictedPaths(t), 'resolved')
    expect(result.resolved).toBe(N)
    expect(result.failed).toEqual([{ path: 'src/f3.txt', message: 'Ainda tem marcadores de conflito' }])
    expect((await t.repo.status()).conflicted.map((f) => f.path)).toEqual(['src/f3.txt'])
  })

  it('caminho que não está em conflito falha sem impedir os demais', async () => {
    const t = await manyConflicts()
    const result = await t.repo.resolveConflicts(['src/f1.txt', 'nao-existe.txt'], 'ours')
    expect(result).toEqual({ resolved: 1, failed: [{ path: 'nao-existe.txt', message: 'Não está em conflito' }] })
    expect((await t.repo.status()).conflicted.map((f) => f.path)).not.toContain('src/f1.txt')
  })

  it('lista vazia não altera nada', async () => {
    const t = await manyConflicts()
    expect(await t.repo.resolveConflicts([], 'ours')).toEqual({ resolved: 0, failed: [] })
    expect((await t.repo.status()).conflicted).toHaveLength(N + 1)
  })
})
