import { describe, expect, it } from 'vitest'
import { isExternal, isReadOnlyCommand, readSignature, signatureOf, type StatLike } from '../src/backend/gitSignature'
import { createRepo } from './helpers'

const stat = (over: Partial<StatLike> = {}): StatLike => ({ mtimeMs: 1000, size: 10, ino: 7, ...over })

describe('signatureOf', () => {
  it('a mesma lista de stats dá a mesma assinatura', () => {
    expect(signatureOf([stat(), null, stat({ ino: 9 })])).toBe(signatureOf([stat(), null, stat({ ino: 9 })]))
  })

  it('mtime diferente muda a assinatura', () => {
    expect(signatureOf([stat()])).not.toBe(signatureOf([stat({ mtimeMs: 1001 })]))
  })

  it('tamanho diferente muda a assinatura', () => {
    expect(signatureOf([stat()])).not.toBe(signatureOf([stat({ size: 11 })]))
  })

  it('inode diferente muda a assinatura (arquivo trocado por renomeação)', () => {
    expect(signatureOf([stat()])).not.toBe(signatureOf([stat({ ino: 8 })]))
  })

  it('arquivo que some ou aparece muda a assinatura', () => {
    expect(signatureOf([stat(), null])).not.toBe(signatureOf([stat(), stat()]))
    expect(signatureOf([null, stat()])).not.toBe(signatureOf([stat(), null]))
  })

  it('a ordem dos caminhos importa: o mesmo stat em outra posição não é a mesma assinatura', () => {
    expect(signatureOf([stat(), null])).not.toBe(signatureOf([null, stat()]))
  })

  it('todos ausentes têm assinatura estável', () => {
    expect(signatureOf([null, null])).toBe(signatureOf([null, null]))
  })
})

describe('isExternal', () => {
  it('sem assinatura própria não afirma nada', () => {
    expect(isExternal(null, 'x')).toBe(false)
  })

  it('assinatura igual à própria não é externa', () => {
    expect(isExternal('x', 'x')).toBe(false)
  })

  it('assinatura diferente da própria é externa', () => {
    expect(isExternal('x', 'y')).toBe(true)
  })
})

describe('isReadOnlyCommand', () => {
  it('leituras são só leitura, com ou sem argumentos', () => {
    for (const args of [['status'], ['status', '--porcelain=v2', '-z'], ['log', '-n', '50'], ['diff', '--cached'], ['rev-parse', 'HEAD'], ['for-each-ref'], ['cat-file', '-p', 'abc'], ['ls-files', '-z'], ['version']]) {
      expect(isReadOnlyCommand(args), args.join(' ')).toBe(true)
    }
  })

  it('escritas, inclusive as que parecem leitura (branch, config, stash, tag), não são', () => {
    for (const args of [['commit', '-m', 'x'], ['add', '-A'], ['checkout', 'main'], ['branch'], ['config', '--get', 'user.name'], ['stash', 'list'], ['tag'], ['reset', '--hard'], ['fetch']]) {
      expect(isReadOnlyCommand(args), args.join(' ')).toBe(false)
    }
  })

  it('pula opções iniciais: -c leva valor, -C leva pasta, as outras são uma palavra só', () => {
    expect(isReadOnlyCommand(['-c', 'status.showUntrackedFiles=no', 'status'])).toBe(true)
    expect(isReadOnlyCommand(['-C', 'sub', 'log'])).toBe(true)
    expect(isReadOnlyCommand(['--no-pager', 'diff'])).toBe(true)
    expect(isReadOnlyCommand(['-c', 'x=y', 'commit', '-m', 'm'])).toBe(false)
    expect(isReadOnlyCommand(['-C', 'sub', 'add', '-A'])).toBe(false)
  })

  it('sem subcomando reconhecível (vazio, só opções, -c sem valor) é escrita', () => {
    expect(isReadOnlyCommand([])).toBe(false)
    expect(isReadOnlyCommand(['--no-pager'])).toBe(false)
    expect(isReadOnlyCommand(['-c'])).toBe(false)
  })
})

describe('readSignature', () => {
  it('fica estável sem mudança na pasta .git', async () => {
    const repo = await createRepo()
    await repo.commit('inicial', { 'a.txt': 'a\n' })
    const gitDir = await repo.repo.gitDir()
    const first = await readSignature(gitDir)
    expect(await readSignature(gitDir)).toBe(first)
  })

  it('muda quando um commit altera a branch atual', async () => {
    const repo = await createRepo()
    await repo.commit('inicial', { 'a.txt': 'a\n' })
    const gitDir = await repo.repo.gitDir()
    const before = await readSignature(gitDir)
    await repo.commit('segundo', { 'b.txt': 'b\n' })
    expect(await readSignature(gitDir)).not.toBe(before)
  })

  it('pasta .git que não existe não lança: devolve uma assinatura estável', async () => {
    const missing = await readSignature('/caminho/que/nao/existe/.git')
    expect(typeof missing).toBe('string')
    expect(await readSignature('/caminho/que/nao/existe/.git')).toBe(missing)
  })
})
