import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GitRepository } from '../src/core/repository'
import { createRepo } from './helpers'

// Auditoria (issue #91): caminho que sai do repositório por "../", por caminho absoluto ou por link de pasta/arquivo.
// Cada teste tenta o ataque. O conteúdo "SEGREDO FORA" nunca pode sair pela leitura nem ser alterado pela escrita.

const outDirs: string[] = []
afterEach(() => {
  while (outDirs.length) rmSync(outDirs.pop()!, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

/** Pasta fora do repositório, com um arquivo de três linhas ("SEGREDO FORA"). */
function outside() {
  const dir = mkdtempSync(join(tmpdir(), 'gittools-out-'))
  outDirs.push(dir)
  const file = join(dir, 'fora.txt')
  writeFileSync(file, 'SEGREDO FORA\nlinha 2\nlinha 3\n')
  return { dir, file }
}

/**
 * Métodos privados que contam linhas e montam o diff de arquivo novo. São chamados pelo protótipo para testar a
 * barreira direto: a entrada real nunca traz "../" (o git só lista arquivos da pasta), então sem isto o teste não
 * chegaria ao método.
 */
const untrackedStats = Reflect.get(GitRepository.prototype, 'untrackedStats') as (this: GitRepository, path: string) => Promise<unknown>
const untrackedDiff = Reflect.get(GitRepository.prototype, 'untrackedDiff') as (this: GitRepository, path: string) => Promise<unknown>

describe('arquivos novos: contagem e diff recusam caminho fora do repositório', () => {
  it('untrackedStats não conta as linhas de arquivo fora, por "../" nem por caminho absoluto', async () => {
    const t = await createRepo()
    const o = outside()
    expect(await untrackedStats.call(t.repo, relative(t.dir, o.file))).toEqual({})
    expect(await untrackedStats.call(t.repo, o.file)).toEqual({})
  })

  it('untrackedDiff recusa "../" e caminho absoluto em vez de montar o diff com o conteúdo de fora', async () => {
    const t = await createRepo()
    const o = outside()
    await expect(untrackedDiff.call(t.repo, relative(t.dir, o.file))).rejects.toThrow()
    await expect(untrackedDiff.call(t.repo, o.file)).rejects.toThrow()
  })

  it('untrackedDiff continua montando o diff de arquivo novo dentro do repositório', async () => {
    const t = await createRepo()
    t.write('novo.txt', 'a\nb\n')
    await expect(untrackedDiff.call(t.repo, 'novo.txt')).resolves.toMatchObject({ path: 'novo.txt', changeType: 'added', additions: 2 })
  })
})

describe('leitura, escrita e editor de conflitos pelo link', () => {
  it('readFile não lê arquivo de fora por pasta-link e não segue arquivo-link para fora', async () => {
    const t = await createRepo()
    const o = outside()
    symlinkSync(o.dir, join(t.dir, 'pasta-link'), 'junction')
    symlinkSync(o.file, join(t.dir, 'arquivo-link.txt'), 'file')
    await expect(t.repo.readFile('pasta-link/fora.txt')).rejects.toThrow()
    await expect(t.repo.readFile('arquivo-link.txt')).rejects.toThrow()
  })

  it('readFile aceita pasta-link que aponta para dentro do repositório', async () => {
    const t = await createRepo()
    t.write('src/a.txt', 'dentro\n')
    symlinkSync(join(t.dir, 'src'), join(t.dir, 'alias'), 'junction')
    expect(await t.repo.readFile('alias/a.txt')).toMatchObject({ content: 'dentro\n', binary: false })
  })

  it('conflictDetails recusa pasta-link e arquivo-link para fora, sem devolver o conteúdo', async () => {
    const t = await createRepo()
    const o = outside()
    symlinkSync(o.dir, join(t.dir, 'pasta-link'), 'junction')
    symlinkSync(o.file, join(t.dir, 'arquivo-link.txt'), 'file')
    await expect(t.repo.conflictDetails('pasta-link/fora.txt')).rejects.toThrow()
    await expect(t.repo.conflictDetails('arquivo-link.txt')).rejects.toThrow()
  })

  it('writeFile não grava fora do repositório por pasta-link', async () => {
    const t = await createRepo()
    const o = outside()
    symlinkSync(o.dir, join(t.dir, 'pasta-link'), 'junction')
    await expect(t.repo.writeFile('pasta-link/fora.txt', 'PWNED\n')).rejects.toThrow()
    expect(readFileSync(o.file, 'utf8')).toBe('SEGREDO FORA\nlinha 2\nlinha 3\n')
  })

  it('saveConflictResolution não grava fora do repositório por pasta-link nem por arquivo-link', async () => {
    const t = await createRepo()
    const o = outside()
    symlinkSync(o.dir, join(t.dir, 'pasta-link'), 'junction')
    symlinkSync(o.file, join(t.dir, 'arquivo-link.txt'), 'file')
    await expect(t.repo.saveConflictResolution('pasta-link/fora.txt', 'PWNED\n')).rejects.toThrow()
    await expect(t.repo.saveConflictResolution('arquivo-link.txt', 'PWNED\n')).rejects.toThrow()
    expect(readFileSync(o.file, 'utf8')).toBe('SEGREDO FORA\nlinha 2\nlinha 3\n')
  })
})
