import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildResult, parseConflicts } from '../src/shared/conflicts'
import { createRepo, lines } from './helpers'

async function conflictRepo() {
  const t = await createRepo()
  await t.commit('init', { 'f.txt': lines('a', 'b', 'c') })
  await t.git('checkout', '-q', '-b', 'feature')
  const c = await t.commit('feature', { 'f.txt': lines('a', 'B feature', 'c') })
  await t.git('checkout', '-q', 'main')
  await t.commit('main', { 'f.txt': lines('a', 'B main', 'c') })
  await t.repo.cherryPickCommits('main', [c])
  return t
}

describe('editor de conflitos', () => {
  it('lê as três versões e o arquivo com marcadores', async () => {
    const t = await conflictRepo()
    const d = await t.repo.conflictDetails('f.txt')
    expect(d.base).toBe(lines('a', 'b', 'c'))
    expect(d.ours).toBe(lines('a', 'B main', 'c'))
    expect(d.theirs).toBe(lines('a', 'B feature', 'c'))
    expect(d.working).toContain('<<<<<<< HEAD')
    expect(d.binary).toBe(false)
  })

  it('salva a resolução, marca como resolvido e permite continuar', async () => {
    const t = await conflictRepo()
    const d = await t.repo.conflictDetails('f.txt')
    const merged = buildResult(parseConflicts(d.working!), [{ kind: 'ours-theirs' }])
    expect(merged).toBe(lines('a', 'B main', 'B feature', 'c'))
    await t.repo.saveConflictResolution('f.txt', merged)
    expect((await t.repo.status()).conflicted).toEqual([])
    expect((await t.repo.continueOperation()).ok).toBe(true)
    expect(readFileSync(join(t.dir, 'f.txt'), 'utf8')).toBe(merged)
  })
})

describe('comparação', () => {
  it('lista commits exclusivos de cada lado e arquivos alterados', async () => {
    const t = await createRepo()
    await t.commit('init', { 'a.txt': 'a\n' })
    await t.git('checkout', '-q', '-b', 'feature')
    await t.commit('só feature', { 'b.txt': 'b\n' })
    await t.git('checkout', '-q', 'main')
    await t.commit('só main', { 'a.txt': 'A\n' })
    const cmp = await t.repo.compare('main', 'feature')
    expect(cmp.onlyFrom.map((c) => c.subject)).toEqual(['só main'])
    expect(cmp.onlyTo.map((c) => c.subject)).toEqual(['só feature'])
    expect(cmp.files.map((f) => `${f.status} ${f.path}`).sort()).toEqual(['A b.txt', 'M a.txt'])
    expect(cmp.mergeBase).toMatch(/^[0-9a-f]{40}$/)
  })
})

describe('blame e histórico de arquivo', () => {
  it('atribui cada linha ao commit que a escreveu', async () => {
    const t = await createRepo()
    const c1 = await t.commit('primeiro', { 'f.txt': lines('um', 'dois') })
    const c2 = await t.commit('segundo', { 'f.txt': lines('um', 'DOIS', 'três') })
    const blame = await t.repo.blame('f.txt')
    expect(blame.lines.map((l) => [l.line, l.content, l.sha])).toEqual([
      [1, 'um', c1],
      [2, 'DOIS', c2],
      [3, 'três', c2]
    ])
    expect(blame.commits[c2]).toMatchObject({ author: 'Test', summary: 'segundo', email: 'test@example.com' })
  })

  it('segue o arquivo através de renomeações', async () => {
    const t = await createRepo()
    await t.commit('cria', { 'velho.txt': lines('1', '2', '3', '4', '5') })
    await t.git('mv', 'velho.txt', 'novo.txt')
    await t.commit('renomeia')
    await t.commit('altera', { 'novo.txt': lines('1', '2', '3', '4', '5', '6') })
    const history = await t.repo.fileHistory('novo.txt')
    expect(history.map((h) => [h.subject, h.path])).toEqual([
      ['altera', 'novo.txt'],
      ['renomeia', 'novo.txt'],
      ['cria', 'velho.txt']
    ])
    await t.repo.restoreFile(history[1].sha, 'novo.txt')
    expect(readFileSync(join(t.dir, 'novo.txt'), 'utf8')).toBe(lines('1', '2', '3', '4', '5'))
  })

  it('lista os arquivos rastreados', async () => {
    const t = await createRepo()
    await t.commit('init', { 'a.txt': 'a', 'pasta/b.txt': 'b' })
    expect(await t.repo.listFiles()).toEqual(['a.txt', 'pasta/b.txt'])
  })
})

describe('rebase interativo', () => {
  async function linear() {
    const t = await createRepo()
    await t.commit('base', { 'f.txt': 'base\n' })
    const a = await t.commit('A', { 'a.txt': 'a\n' })
    const b = await t.commit('B', { 'b.txt': 'b\n' })
    const c = await t.commit('C', { 'c.txt': 'c\n' })
    return { t, a, b, c }
  }

  it('monta o plano a partir de um commit', async () => {
    const { t, a } = await linear()
    const plan = await t.repo.rebasePlan(a)
    expect(plan.commits.map((c) => c.subject)).toEqual(['A', 'B', 'C'])
    expect(plan.hasMerges).toBe(false)
    expect(plan.base).not.toBeNull()
  })

  it('reordena, renomeia, junta e remove commits', async () => {
    const { t, a, b, c } = await linear()
    const plan = await t.repo.rebasePlan(a)
    const result = await t.repo.interactiveRebase(plan.base, [
      { sha: c, action: 'reword', message: "C com 'aspas'" },
      { sha: a, action: 'pick' },
      { sha: b, action: 'squash', message: 'A + B' }
    ])
    expect(result.ok).toBe(true)
    const log = await t.repo.log({ limit: 3 })
    expect(log.map((l) => l.subject)).toEqual(['A + B', "C com 'aspas'", 'base'])
    expect(await t.repo.listFiles()).toEqual(['a.txt', 'b.txt', 'c.txt', 'f.txt'])

    const plan2 = await t.repo.rebasePlan(log[1].sha)
    await t.repo.interactiveRebase(plan2.base, [
      { sha: plan2.commits[0].sha, action: 'drop' },
      { sha: plan2.commits[1].sha, action: 'pick' }
    ])
    expect((await t.repo.log({ limit: 2 })).map((l) => l.subject)).toEqual(['A + B', 'base'])
  })

  it('não permite juntar o primeiro commit', async () => {
    const { t, a, b } = await linear()
    const plan = await t.repo.rebasePlan(b)
    await expect(t.repo.interactiveRebase(plan.base, [{ sha: b, action: 'fixup' }])).rejects.toThrow(/primeiro/)
    expect(a).toBeTruthy()
  })
})

describe('comparação desde o ancestral comum', () => {
  it('mostra só o que mudou no lado comparado', async () => {
    const t = await createRepo()
    await t.commit('init', { 'a.txt': 'a\n' })
    await t.git('checkout', '-q', '-b', 'feature')
    await t.commit('só feature', { 'b.txt': 'b\n' })
    await t.git('checkout', '-q', 'main')
    await t.commit('só main', { 'a.txt': 'A\n' })
    const cmp = await t.repo.compare('main', 'feature', true)
    expect(cmp.files.map((f) => `${f.status} ${f.path}`)).toEqual(['A b.txt'])
  })
})

describe('editor de arquivos', () => {
  it('lê e grava arquivos de texto da pasta do projeto', async () => {
    const t = await createRepo()
    await t.commit('init', { 'a.txt': 'um\r\ndois\r\n', 'pasta/b.txt': 'b\n' })
    expect(await t.repo.readFile('a.txt')).toEqual({ path: 'a.txt', content: 'um\r\ndois\r\n', binary: false, tooLarge: false, size: 10 })
    await t.repo.writeFile('pasta/b.txt', 'B\nnova\n')
    expect(readFileSync(join(t.dir, 'pasta', 'b.txt'), 'utf8')).toBe('B\nnova\n')
    // Gravar não faz stage: o arquivo aparece como alterado.
    const status = await t.repo.status()
    expect(status.unstaged.map((f) => f.path)).toEqual(['pasta/b.txt'])
  })

  it('recusa binários, arquivos grandes, pastas, caminhos fora do projeto e arquivos que não existem', async () => {
    const t = await createRepo()
    await t.commit('init', { 'a.txt': 'a\n', 'pasta/b.txt': 'b\n' })
    t.write('bin.dat', 'ab\0cd')
    t.write('grande.txt', 'x'.repeat(2 * 1024 * 1024 + 1))
    expect(await t.repo.readFile('bin.dat')).toMatchObject({ content: null, binary: true })
    expect(await t.repo.readFile('grande.txt')).toMatchObject({ content: null, tooLarge: true, binary: false })
    await expect(t.repo.readFile('pasta')).rejects.toThrow('não é um arquivo comum')
    await expect(t.repo.readFile('../fora.txt')).rejects.toThrow('fora do repositório')
    await expect(t.repo.writeFile('../fora.txt', 'x')).rejects.toThrow('fora do repositório')
    // O editor não cria arquivos: só reescreve os que existem.
    await expect(t.repo.writeFile('novo.txt', 'x')).rejects.toThrow()
    await expect(t.repo.readFile('nao-existe.txt')).rejects.toThrow()
  })

  it('o blame do arquivo salvo mostra o autor das linhas alteradas e as não commitadas', async () => {
    const t = await createRepo()
    const c1 = await t.commit('primeiro', { 'f.txt': 'um\ndois\n' })
    await t.repo.writeFile('f.txt', 'um\nDOIS\n')
    const blame = await t.repo.blame('f.txt')
    expect(blame.lines[0].sha).toBe(c1)
    expect(blame.lines[1].sha).toMatch(/^0+$/)
    expect(blame.commits[c1]).toMatchObject({ author: 'Test', summary: 'primeiro' })
  })
})
