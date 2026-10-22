import { describe, expect, it } from 'vitest'
import { ALL_SCOPE, checkedRefs, scopeKey, scopeLogOptions, scopeOfRefs, showsWorkingChanges, toggleGroup, toggleRef } from '../src/renderer/src/historyScope'
import { createRepo } from './helpers'

describe('escopo do histórico (branches marcadas)', () => {
  it('marcar uma branch lista só a dela; marcar outra junta as duas', () => {
    const one = toggleRef(ALL_SCOPE, 'main')
    expect(one).toEqual({ kind: 'ref', ref: 'main' })
    const two = toggleRef(one, 'dev')
    expect(two).toEqual({ kind: 'refs', refs: ['main', 'dev'] })
    expect(checkedRefs(two)).toEqual(['main', 'dev'])
  })

  it('desmarcar a última volta a listar tudo', () => {
    expect(toggleRef({ kind: 'ref', ref: 'main' }, 'main')).toEqual(ALL_SCOPE)
    expect(toggleRef({ kind: 'refs', refs: ['a', 'b'] }, 'a')).toEqual({ kind: 'ref', ref: 'b' })
  })

  it('marcar a partir de "branch atual" ou "todas" não conta o escopo anterior', () => {
    expect(toggleRef({ kind: 'head' }, 'dev')).toEqual({ kind: 'ref', ref: 'dev' })
    expect(checkedRefs({ kind: 'all' })).toEqual([])
  })

  it('marca ou desmarca um grupo inteiro', () => {
    expect(toggleGroup(ALL_SCOPE, ['a', 'b'])).toEqual({ kind: 'refs', refs: ['a', 'b'] })
    expect(toggleGroup({ kind: 'refs', refs: ['a', 'b', 'c'] }, ['a', 'b'])).toEqual({ kind: 'ref', ref: 'c' })
    expect(toggleGroup({ kind: 'ref', ref: 'a' }, ['a', 'b'])).toEqual({ kind: 'refs', refs: ['a', 'b'] })
    expect(scopeOfRefs(['a', 'a'])).toEqual({ kind: 'ref', ref: 'a' })
  })

  it('gera as opções do git log e a chave de cache', () => {
    expect(scopeLogOptions(ALL_SCOPE)).toEqual({ all: true })
    expect(scopeLogOptions({ kind: 'head' })).toEqual({})
    expect(scopeLogOptions({ kind: 'refs', refs: ['a', 'b'] })).toEqual({ refs: ['a', 'b'] })
    expect(scopeKey({ kind: 'refs', refs: ['a', 'b'] })).not.toBe(scopeKey({ kind: 'refs', refs: ['a'] }))
  })

  it('a linha das alterações só aparece se o HEAD está entre as branches listadas', () => {
    expect(showsWorkingChanges(ALL_SCOPE, 'main')).toBe(true)
    expect(showsWorkingChanges({ kind: 'ref', ref: 'dev' }, 'main')).toBe(false)
    expect(showsWorkingChanges({ kind: 'refs', refs: ['dev', 'main'] }, 'main')).toBe(true)
    expect(showsWorkingChanges({ kind: 'refs', refs: ['dev', 'x'] }, 'main')).toBe(false)
    expect(showsWorkingChanges({ kind: 'refs', refs: ['dev', 'x'] }, null)).toBe(false)
  })
})

describe('git log com várias branches', () => {
  it('lista só a história das branches pedidas', async () => {
    const t = await createRepo()
    await t.commit('base', { 'a.txt': '1\n' })
    await t.git('checkout', '-q', '-b', 'dev')
    await t.commit('só no dev', { 'b.txt': '2\n' })
    await t.git('checkout', '-q', 'main')
    await t.commit('só no main', { 'c.txt': '3\n' })
    await t.git('checkout', '-q', '-b', 'outra')
    await t.commit('só na outra', { 'd.txt': '4\n' })
    await t.git('checkout', '-q', 'main')

    const subjects = async (refs: string[]) => (await t.repo.log({ refs })).map((c) => c.subject).sort()
    expect(await subjects(['dev'])).toEqual(['base', 'só no dev'])
    expect(await subjects(['dev', 'outra'])).toEqual(['base', 'só na outra', 'só no dev', 'só no main'])
    expect(await subjects(['dev', 'main'])).toEqual(['base', 'só no dev', 'só no main'])
    expect((await t.repo.log({ all: true })).length).toBe(4)
  })

  it('recusa nomes de ref perigosos', async () => {
    const t = await createRepo()
    await t.commit('base', { 'a.txt': '1\n' })
    await expect(t.repo.log({ refs: ['--output=/tmp/x'] })).rejects.toThrow()
  })
})
