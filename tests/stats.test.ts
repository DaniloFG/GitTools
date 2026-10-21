import { describe, expect, it } from 'vitest'
import { parseNumstat } from '../src/core/repository'
import { createRepo, lines } from './helpers'

describe('linhas adicionadas e removidas', () => {
  it('lê a saída do numstat, inclusive renomeações e binários', () => {
    const out = ['3\t1\ta.txt', '-\t-\timg.png', '2\t0\t', 'velho.txt', 'novo.txt', ''].join('\0')
    const stats = parseNumstat(out)
    expect(stats.get('a.txt')).toEqual({ additions: 3, deletions: 1 })
    expect(stats.get('img.png')).toEqual({ binary: true })
    expect(stats.get('novo.txt')).toEqual({ additions: 2, deletions: 0 })
  })

  it('conta as linhas no status (stage, fora do stage e arquivos novos)', async () => {
    const t = await createRepo()
    await t.commit('init', { 'a.txt': lines('1', '2', '3') })
    t.write('a.txt', lines('1', 'dois', '3', '4'))
    await t.git('add', 'a.txt')
    t.write('a.txt', lines('1', 'dois', '3'))
    t.write('novo.txt', lines('x', 'y'))
    const status = await t.repo.status(true)
    expect(status.staged.find((f) => f.path === 'a.txt')).toMatchObject({ additions: 2, deletions: 1 })
    expect(status.unstaged.find((f) => f.path === 'a.txt')).toMatchObject({ additions: 0, deletions: 1 })
    expect(status.unstaged.find((f) => f.path === 'novo.txt')).toMatchObject({ additions: 2, deletions: 0 })
    // Sem pedir, o status continua leve (sem contagens).
    expect((await t.repo.status()).staged[0].additions).toBeUndefined()
  })

  it('conta as linhas na comparação, no Studio e no histórico do arquivo', async () => {
    const t = await createRepo()
    await t.commit('init', { 'a.txt': lines('1', '2') })
    await t.git('checkout', '-q', '-b', 'feature')
    const c1 = await t.commit('um', { 'a.txt': lines('1', '2', '3') })
    const c2 = await t.commit('dois', { 'a.txt': lines('1', '3') })
    const cmp = await t.repo.compare('main', 'feature')
    expect(cmp.files).toEqual([{ status: 'M', path: 'a.txt', additions: 1, deletions: 1 }])
    expect(await t.repo.filesChangedBy([c1, c2])).toEqual([{ status: 'M', path: 'a.txt', additions: 1, deletions: 1 }])
    const history = await t.repo.fileHistory('a.txt')
    expect(history.map((h) => [h.subject, h.additions, h.deletions])).toEqual([
      ['dois', 0, 1],
      ['um', 1, 0],
      ['init', 2, 0]
    ])
  })

  it('mostra o arquivo inteiro no diff quando pedido', async () => {
    const t = await createRepo()
    const body = Array.from({ length: 30 }, (_, i) => `linha ${i + 1}`)
    await t.commit('init', { 'f.txt': lines(...body) })
    t.write('f.txt', lines(...body.map((l, i) => (i === 14 ? 'MUDOU' : l))))
    const [partial] = await t.repo.diff({ kind: 'unstaged', path: 'f.txt' })
    const [full] = await t.repo.diff({ kind: 'unstaged', path: 'f.txt', fullFile: true })
    expect(partial.hunks[0].lines.length).toBe(8)
    expect(full.hunks[0].lines.length).toBe(31)
    // A seleção de linhas continua funcionando sobre o arquivo inteiro.
    const keys = full.hunks[0].lines.flatMap((l, i) => (l.kind !== 'context' ? [`0:${i}`] : []))
    await t.repo.applyLines({ kind: 'unstaged', fullFile: true }, 'f.txt', keys, 'stage')
    expect(await t.git('show', ':f.txt')).toContain('MUDOU')
  })
})
