import { describe, expect, it } from 'vitest'
import { addToast, cleanErrorText, commitBlock, DEDUPE_WINDOW_MS, dismissDelay, isIgnorableError, type Toast } from '../src/renderer/src/feedback'

describe('texto de erro', () => {
  it('tira o prefixo que o Electron acrescenta ao erro vindo do processo principal', () => {
    expect(cleanErrorText("Error invoking remote method 'git:push': Error: fatal: sem upstream")).toBe('fatal: sem upstream')
    expect(cleanErrorText("Error invoking remote method 'git:fetch': GitError: fatal: não foi possível ler")).toBe('fatal: não foi possível ler')
  })

  it('mantém a saída do git inteira, com várias linhas', () => {
    const output = 'error: failed to push some refs\nhint: Updates were rejected'
    expect(cleanErrorText(`Error invoking remote method 'git:push': Error: ${output}`)).toBe(output)
  })

  it('tira prefixos de classe repetidos e não mexe em mensagens sem prefixo', () => {
    expect(cleanErrorText('Error: Error: boom')).toBe('boom')
    expect(cleanErrorText('  já limpo  ')).toBe('já limpo')
  })

  it('ignora o ruído do ResizeObserver e nada mais', () => {
    expect(isIgnorableError('ResizeObserver loop completed with undelivered notifications.')).toBe(true)
    expect(isIgnorableError('Cannot read properties of undefined')).toBe(false)
  })
})

describe('deduplicação de notificações', () => {
  const now = 10_000

  it('adiciona uma notificação nova ao fim da lista, com contador 1', () => {
    const list = addToast([], { kind: 'error', text: 'falhou' }, now, 1)
    expect(list).toEqual([{ id: 1, kind: 'error', text: 'falhou', count: 1, at: now }])
  })

  it('a mesma mensagem repetida dentro de 2s vira +1 no contador, sem duplicar', () => {
    let list: Toast[] = addToast([], { kind: 'error', text: 'falhou' }, now, 1)
    list = addToast(list, { kind: 'error', text: 'falhou' }, now + 500, 2)
    list = addToast(list, { kind: 'error', text: 'falhou' }, now + 1000, 3)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: 1, count: 3, at: now + 1000 })
  })

  it('depois da janela de deduplicação, a mesma mensagem aparece de novo', () => {
    let list = addToast([], { kind: 'warning', text: 'nada para commitar' }, now, 1)
    list = addToast(list, { kind: 'warning', text: 'nada para commitar' }, now + DEDUPE_WINDOW_MS + 1, 2)
    expect(list.map((t) => [t.id, t.count])).toEqual([
      [1, 1],
      [2, 1]
    ])
  })

  it('textos ou tipos diferentes não se misturam', () => {
    let list = addToast([], { kind: 'error', text: 'a' }, now, 1)
    list = addToast(list, { kind: 'error', text: 'b' }, now, 2)
    list = addToast(list, { kind: 'warning', text: 'a' }, now, 3)
    expect(list.map((t) => t.text + t.kind)).toEqual(['aerror', 'berror', 'awarning'])
  })

  it('a mensagem repetida mantém a posição original na lista', () => {
    let list = addToast([], { kind: 'info', text: 'primeira' }, now, 1)
    list = addToast(list, { kind: 'info', text: 'segunda' }, now, 2)
    list = addToast(list, { kind: 'info', text: 'primeira' }, now + 100, 3)
    expect(list.map((t) => t.text)).toEqual(['primeira', 'segunda'])
    expect(list[0].count).toBe(2)
  })
})

describe('tempo na tela', () => {
  it('erros não somem sozinhos; avisos e informações somem depois de um tempo', () => {
    expect(dismissDelay('error')).toBeNull()
    expect(dismissDelay('warning')).toBe(8000)
    expect(dismissDelay('info')).toBe(5000)
    expect(dismissDelay('success')).toBe(5000)
  })
})

describe('motivo de o commit não poder ser feito', () => {
  const ok = { message: 'feat: algo', staged: 1, amend: false, stageAll: false, conflicted: 0 }

  it('libera o commit quando há mensagem e algo no stage', () => {
    expect(commitBlock(ok)).toBeNull()
  })

  it('explica cada bloqueio, na ordem: conflitos, mensagem e depois nada para commitar', () => {
    expect(commitBlock({ ...ok, conflicted: 2 })).toBe('conflicts')
    expect(commitBlock({ ...ok, message: '   ' })).toBe('message')
    expect(commitBlock({ ...ok, staged: 0 })).toBe('nothing')
  })

  it('amend e "incluir tudo" também liberam o commit sem nada no stage', () => {
    expect(commitBlock({ ...ok, staged: 0, amend: true })).toBeNull()
    expect(commitBlock({ ...ok, staged: 0, stageAll: true })).toBeNull()
  })
})
