import { afterEach, describe, expect, it } from 'vitest'
import { dateFormatKey, formatDate, formatDateTime, formatGridDateTime, formatShortDateTime, setDateFormat, setLocale } from '../src/shared/i18n'
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/shared/settings'

// 31/12/2026 23:59:59 no fuso da máquina (o formato ISO usa o horário local).
const NEW_YEAR_EVE = new Date(2026, 11, 31, 23, 59, 59).getTime()
const MORNING = new Date(2026, 0, 5, 7, 4, 9).getTime()

afterEach(() => {
  setDateFormat('iso')
  setLocale('pt-BR')
})

describe('formato de data e hora (issue #17)', () => {
  it('o padrão é o ISO "2026-12-31 23:59:59", em 24 horas', () => {
    expect(DEFAULT_SETTINGS.dateFormat).toBe('iso')
    setDateFormat('iso')
    expect(formatDateTime(NEW_YEAR_EVE)).toBe('2026-12-31 23:59:59')
    expect(formatShortDateTime(NEW_YEAR_EVE)).toBe('2026-12-31 23:59')
    expect(formatDate(NEW_YEAR_EVE)).toBe('2026-12-31')
  })

  it('a coluna do histórico mostra os segundos no ISO e não nos demais (para caber)', () => {
    setLocale('en')
    setDateFormat('iso')
    expect(formatGridDateTime(NEW_YEAR_EVE)).toBe('2026-12-31 23:59:59')
    setDateFormat('24h')
    expect(formatGridDateTime(NEW_YEAR_EVE)).toBe(formatShortDateTime(NEW_YEAR_EVE))
  })

  it('completa com zeros à esquerda e nunca usa AM/PM no ISO', () => {
    setDateFormat('iso')
    expect(formatDateTime(MORNING)).toBe('2026-01-05 07:04:09')
    expect(formatDateTime(MORNING)).not.toMatch(/AM|PM/i)
  })

  it('"24h" escreve a hora de 0 a 23 no idioma da interface', () => {
    setLocale('en')
    setDateFormat('24h')
    expect(formatDateTime(NEW_YEAR_EVE)).toMatch(/23:59:59/)
    expect(formatDateTime(NEW_YEAR_EVE)).not.toMatch(/AM|PM/i)
  })

  it('"12h" usa AM/PM', () => {
    setLocale('en')
    setDateFormat('12h')
    expect(formatDateTime(NEW_YEAR_EVE)).toMatch(/11:59:59\s?PM/i)
  })

  it('"system" segue o idioma do sistema, não o da interface', () => {
    setLocale('en')
    setDateFormat('system', 'pt-BR')
    expect(formatDateTime(NEW_YEAR_EVE)).toBe(new Date(NEW_YEAR_EVE).toLocaleString('pt-BR'))
    expect(formatDate(NEW_YEAR_EVE)).toBe(new Date(NEW_YEAR_EVE).toLocaleDateString('pt-BR'))
  })

  it('a chave de formato muda com o formato, o idioma do sistema e o idioma da interface', () => {
    setDateFormat('iso')
    const iso = dateFormatKey()
    setDateFormat('24h')
    expect(dateFormatKey()).not.toBe(iso)
    setDateFormat('system', 'de-DE')
    const system = dateFormatKey()
    setLocale('es')
    expect(dateFormatKey()).not.toBe(system)
  })

  it('a configuração é validada ao ler do disco', () => {
    expect(normalizeSettings({}).dateFormat).toBe('iso')
    expect(normalizeSettings({ dateFormat: '12h' }).dateFormat).toBe('12h')
    expect(normalizeSettings({ dateFormat: 'system' }).dateFormat).toBe('system')
    expect(normalizeSettings({ dateFormat: 'banana' }).dateFormat).toBe('iso')
    expect(normalizeSettings({ dateFormat: 5 }).dateFormat).toBe('iso')
  })
})
