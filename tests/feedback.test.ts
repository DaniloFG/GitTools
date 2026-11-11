import { describe, expect, it } from 'vitest'
import {
  addToast,
  cleanErrorText,
  commitBlock,
  DEDUPE_WINDOW_MS,
  dismissDelay,
  effectivePushMode,
  isIgnorableError,
  parsePushMode,
  type Toast
} from '../src/renderer/src/feedback'

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
  const ok = { message: 'feat: algo', staged: 1, amend: false, conflicted: 0 }

  it('libera o commit quando há mensagem e algo no stage', () => {
    expect(commitBlock(ok)).toBeNull()
  })

  it('explica cada bloqueio, na ordem: conflitos, mensagem e depois nada para commitar', () => {
    expect(commitBlock({ ...ok, conflicted: 2 })).toBe('conflicts')
    expect(commitBlock({ ...ok, message: '   ' })).toBe('message')
    expect(commitBlock({ ...ok, staged: 0 })).toBe('nothing')
  })

  it('amend também libera o commit sem nada no stage', () => {
    expect(commitBlock({ ...ok, staged: 0, amend: true })).toBeNull()
  })

  it('arquivos não staged que não foram marcados não liberam o commit', () => {
    // commitBlock não recebe a lista de não staged: sem stage e sem marcação, o resultado é sempre 'nothing'.
    expect(commitBlock({ ...ok, staged: 0, picked: 0 })).toBe('nothing')
  })

  it('arquivos marcados na lista de não staged liberam o commit mesmo sem nada no stage', () => {
    expect(commitBlock({ ...ok, staged: 0, picked: 2 })).toBeNull()
    expect(commitBlock({ ...ok, staged: 0, picked: 0 })).toBe('nothing')
    expect(commitBlock({ ...ok, staged: 0 })).toBe('nothing')
    expect(commitBlock({ ...ok, staged: 0, picked: 1, message: '' })).toBe('message')
  })
})

describe('modo de envio', () => {
  const base = { push: true, amend: false, hasUpstream: true, ahead: 0, chosen: 'normal' as const }

  it('commit normal sem corrigir o anterior segue no modo escolhido', () => {
    expect(effectivePushMode(base)).toEqual({ needsForce: false, mode: 'normal' })
  })

  it('corrigir um commit já enviado (upstream, ahead 0) força lease quando o escolhido é normal', () => {
    expect(effectivePushMode({ ...base, amend: true })).toEqual({ needsForce: true, mode: 'lease' })
  })

  it('corrigir com commits locais à frente (ahead > 0) continua normal', () => {
    expect(effectivePushMode({ ...base, amend: true, ahead: 1 })).toEqual({ needsForce: false, mode: 'normal' })
  })

  it('sem upstream ou sem push, corrigir não exige force', () => {
    expect(effectivePushMode({ ...base, amend: true, hasUpstream: false })).toEqual({ needsForce: false, mode: 'normal' })
    expect(effectivePushMode({ ...base, amend: true, push: false })).toEqual({ needsForce: false, mode: 'normal' })
  })

  it('um modo escolhido à mão (lease ou force) é mantido', () => {
    expect(effectivePushMode({ ...base, amend: true, chosen: 'force' })).toEqual({ needsForce: true, mode: 'force' })
    expect(effectivePushMode({ ...base, chosen: 'lease' })).toEqual({ needsForce: false, mode: 'lease' })
  })

  it('valor salvo que não é modo conhecido vira normal', () => {
    expect(parsePushMode('lease')).toBe('lease')
    expect(parsePushMode('force')).toBe('force')
    expect(parsePushMode('qualquer coisa')).toBe('normal')
    expect(parsePushMode(undefined)).toBe('normal')
  })
})
