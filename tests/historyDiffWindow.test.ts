import { describe, expect, it } from 'vitest'
import { commitDiffWindowRequest, historyDiffLayout, reportHistoryDiffLayout } from '../src/renderer/src/historyDiffWindow'
import { isDiffWindowRequest } from '../src/backend/backend'

describe('pedido de janela a partir do diff de commit do History', () => {
  it('leva o modo escolhido na tela, com sha, caminho antigo e título', () => {
    const pedido = commitDiffWindowRequest({ sha: 'abc1234', path: 'novo.txt', oldPath: 'velho.txt', title: 'novo.txt · abc1234', layout: 'split' })
    expect(pedido).toEqual({ source: { kind: 'commit', sha: 'abc1234', oldPath: 'velho.txt' }, path: 'novo.txt', title: 'novo.txt · abc1234', layout: 'split' })
    expect(isDiffWindowRequest(pedido)).toBe(true)
    expect(commitDiffWindowRequest({ sha: 'abc', path: 'a', title: 't', layout: 'inline' }).layout).toBe('inline')
  })

  it('sem modo, o pedido não tem a chave layout (a janela lê as configurações)', () => {
    const pedido = commitDiffWindowRequest({ sha: 'abc', path: 'a.txt', title: 'a.txt' })
    expect('layout' in pedido).toBe(false)
    expect(JSON.parse(JSON.stringify(pedido))).toEqual({ source: { kind: 'commit', sha: 'abc' }, path: 'a.txt', title: 'a.txt' })
    expect(isDiffWindowRequest(pedido)).toBe(true)
  })

  it('o modo registrado pelo diff vale até ele sair da tela', () => {
    expect(historyDiffLayout()).toBeUndefined()
    reportHistoryDiffLayout('split')
    expect(historyDiffLayout()).toBe('split')
    reportHistoryDiffLayout('inline')
    expect(historyDiffLayout()).toBe('inline')
    reportHistoryDiffLayout(undefined)
    expect(historyDiffLayout()).toBeUndefined()
  })
})
