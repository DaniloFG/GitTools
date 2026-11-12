import { describe, expect, it } from 'vitest'
import { createConflictDrafts } from '../src/renderer/src/conflictDrafts'
import type { ChunkResolution } from '../src/shared/conflicts'

const TEXT = 'a\n<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> topic\nb\n'
const OURS: ChunkResolution = { kind: 'ours' }
const THEIRS: ChunkResolution = { kind: 'theirs' }

describe('createConflictDrafts', () => {
  it('salva e recupera as escolhas quando o texto do arquivo é o mesmo', () => {
    const drafts = createConflictDrafts()
    drafts.save('src/a.ts', TEXT, [OURS, undefined])
    expect(drafts.take('src/a.ts', TEXT)).toEqual([OURS, undefined])
  })

  it('devolve cópia: mexer no resultado não altera o que está guardado', () => {
    const drafts = createConflictDrafts()
    drafts.save('src/a.ts', TEXT, [OURS])
    const first = drafts.take('src/a.ts', TEXT)
    first?.push(THEIRS)
    expect(drafts.take('src/a.ts', TEXT)).toEqual([OURS])
  })

  it('texto diferente descarta a entrada: devolve undefined e não volta nem com o texto antigo', () => {
    const drafts = createConflictDrafts()
    drafts.save('src/a.ts', TEXT, [OURS])
    expect(drafts.take('src/a.ts', TEXT + 'nova linha\n')).toBeUndefined()
    expect(drafts.take('src/a.ts', TEXT)).toBeUndefined()
  })

  it('arquivo sem entrada devolve undefined', () => {
    expect(createConflictDrafts().take('src/a.ts', TEXT)).toBeUndefined()
  })

  it('o limite remove o mais antigo ao passar do teto', () => {
    const drafts = createConflictDrafts(2)
    drafts.save('a.ts', TEXT, [OURS])
    drafts.save('b.ts', TEXT, [OURS])
    drafts.save('c.ts', TEXT, [OURS])
    expect(drafts.take('a.ts', TEXT)).toBeUndefined()
    expect(drafts.take('b.ts', TEXT)).toEqual([OURS])
    expect(drafts.take('c.ts', TEXT)).toEqual([OURS])
  })

  it('salvar de novo reinsere a entrada como a mais recente, então quem sai é outro', () => {
    const drafts = createConflictDrafts(2)
    drafts.save('a.ts', TEXT, [OURS])
    drafts.save('b.ts', TEXT, [OURS])
    drafts.save('a.ts', TEXT, [THEIRS])
    drafts.save('c.ts', TEXT, [OURS])
    expect(drafts.take('b.ts', TEXT)).toBeUndefined()
    expect(drafts.take('a.ts', TEXT)).toEqual([THEIRS])
    expect(drafts.take('c.ts', TEXT)).toEqual([OURS])
  })

  it('sem nenhuma escolha não guarda nada (lista vazia ou só indefinidas)', () => {
    const drafts = createConflictDrafts()
    drafts.save('a.ts', TEXT, [])
    drafts.save('b.ts', TEXT, [undefined, undefined])
    expect(drafts.take('a.ts', TEXT)).toBeUndefined()
    expect(drafts.take('b.ts', TEXT)).toBeUndefined()
  })

  it('salvar sem escolha apaga a entrada que já existia', () => {
    const drafts = createConflictDrafts()
    drafts.save('a.ts', TEXT, [OURS])
    drafts.save('a.ts', TEXT, [undefined])
    expect(drafts.take('a.ts', TEXT)).toBeUndefined()
  })

  it('clear apaga a entrada: arquivo salvo ou resolvido não volta', () => {
    const drafts = createConflictDrafts()
    drafts.save('a.ts', TEXT, [OURS])
    drafts.clear('a.ts')
    expect(drafts.take('a.ts', TEXT)).toBeUndefined()
  })

  it('clear de arquivo sem entrada não faz nada', () => {
    const drafts = createConflictDrafts()
    drafts.save('a.ts', TEXT, [OURS])
    drafts.clear('b.ts')
    expect(drafts.take('a.ts', TEXT)).toEqual([OURS])
  })
})
