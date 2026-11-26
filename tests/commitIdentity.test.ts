import { describe, expect, it } from 'vitest'
import { formatAuthor, invalidIdentityField, isValidAuthor, isValidDate, toDateInput } from '../src/shared/commitIdentity'

describe('isValidAuthor', () => {
  it('aceita Nome <email>', () => {
    expect(isValidAuthor('Ana Costa <ana@example.com>')).toBe(true)
    expect(isValidAuthor('José <j+x@sub.exemplo.com.br>')).toBe(true)
  })
  it('recusa o que o git não leria como autor', () => {
    for (const bad of ['', 'sem-email', 'A <b>', '<a@b.c>', '  <a@b.c>', 'A<a@b.c>', 'A <a@b.c>\nB', 'A <a b@c.d>', 'A <a@b.c> <d@e.f>', 'A <@b.c>']) {
      expect(isValidAuthor(bad), JSON.stringify(bad)).toBe(false)
    }
  })
})

describe('isValidDate', () => {
  it('aceita a saída do datetime-local, com e sem segundos', () => {
    expect(isValidDate('2026-05-01T10:30')).toBe(true)
    expect(isValidDate('2026-05-01T10:30:59')).toBe(true)
    expect(isValidDate('2024-02-29T00:00')).toBe(true)
    expect(isValidDate('1970-01-01T00:00')).toBe(true)
  })
  it('recusa formato errado e data que não existe', () => {
    for (const bad of ['', '2026-05-01', '2026-13-45T99:99', '2026-02-30T10:00', '2025-02-29T10:00', '2026-05-01T24:00', '2026-05-01T10:60', '1969-12-31T23:59', '2026-05-01T10:30Z', 'ontem']) {
      expect(isValidDate(bad), bad).toBe(false)
    }
  })
})

describe('invalidIdentityField', () => {
  it('opção ausente não é validada, vazia é inválida', () => {
    expect(invalidIdentityField({})).toBeNull()
    expect(invalidIdentityField({ author: 'A <a@b.c>', date: '2026-05-01T10:30' })).toBeNull()
    expect(invalidIdentityField({ author: '' })).toBe('author')
    expect(invalidIdentityField({ date: '' })).toBe('date')
    expect(invalidIdentityField({ author: 'A <a@b.c>', date: 'x' })).toBe('date')
  })
})

describe('pré-preenchimento', () => {
  it('formata o autor e devolve a hora local no formato do datetime-local', () => {
    expect(formatAuthor('Ana Costa', 'ana@example.com')).toBe('Ana Costa <ana@example.com>')
    const local = new Date(2026, 4, 1, 9, 5)
    expect(toDateInput(local.getTime() / 1000)).toBe('2026-05-01T09:05')
    expect(isValidDate(toDateInput(10 * 86400))).toBe(true)
  })
})
