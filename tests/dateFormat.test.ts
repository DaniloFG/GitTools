import { afterEach, describe, expect, it, vi } from 'vitest'
import { LOCALE_IDS, dateFormatKey, formatDate, formatDateTime, formatGridDateTime, formatRelative, formatShortDateTime, setDateFormat, setLocale } from '../src/shared/i18n'
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/shared/settings'
import { dateSearchText } from '../src/renderer/src/graph'

// 31/12/2026 23:59:59 no fuso da máquina (o formato ISO usa o horário local).
const NEW_YEAR_EVE = new Date(2026, 11, 31, 23, 59, 59).getTime()
const MORNING = new Date(2026, 0, 5, 7, 4, 9).getTime()
const MIDNIGHT = new Date(2026, 0, 1, 0, 0, 0).getTime()
const NOON = new Date(2026, 5, 15, 12, 0, 0).getTime()
const INSTANTS = [NEW_YEAR_EVE, MORNING, MIDNIGHT, NOON]

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

// Valor esperado calculado do jeito antigo (toLocaleString / toLocaleDateString direto).
const pad2 = (n: number) => String(n).padStart(2, '0')
const SHORT_OPTS: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }
const FULL_OPTS: Intl.DateTimeFormatOptions = { ...SHORT_OPTS, second: '2-digit' }

describe('texto igual ao de antes, para todo idioma e formato', () => {
  it.each([...LOCALE_IDS])('%s', (locale) => {
    setLocale(locale)
    for (const ms of INSTANTS) {
      const d = new Date(ms)
      const iso = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
      const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`

      setDateFormat('iso')
      expect(formatDateTime(ms)).toBe(`${iso} ${hm}:${pad2(d.getSeconds())}`)
      expect(formatShortDateTime(ms)).toBe(`${iso} ${hm}`)
      expect(formatDate(ms)).toBe(iso)

      for (const hour12 of [false, true]) {
        setDateFormat(hour12 ? '12h' : '24h')
        expect(formatDateTime(ms)).toBe(d.toLocaleString(locale, { ...FULL_OPTS, hour12 }))
        expect(formatShortDateTime(ms)).toBe(d.toLocaleString(locale, { ...SHORT_OPTS, hour12 }))
        expect(formatDate(ms)).toBe(d.toLocaleDateString(locale))
      }

      // "system" segue o idioma do sistema (indefinido ou um idioma fixo), não o da interface.
      for (const system of [undefined, 'de-DE']) {
        setDateFormat('system', system)
        expect(formatDateTime(ms)).toBe(d.toLocaleString(system))
        expect(formatShortDateTime(ms)).toBe(d.toLocaleString(system, SHORT_OPTS))
        expect(formatDate(ms)).toBe(d.toLocaleDateString(system))
      }
    }
  })

  it.each([undefined, ...LOCALE_IDS])('texto de pesquisa do histórico (%s)', (locale) => {
    for (const ms of INSTANTS) {
      const d = new Date(ms)
      const iso = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
      const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
      const expected = [
        `${iso} ${time}`,
        `${d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })} ${time}`,
        d.toLocaleString(locale, SHORT_OPTS),
        d.toLocaleDateString(locale),
      ].join('\n')
      expect(dateSearchText(ms, locale)).toBe(expected)
    }
  })
})

describe('formatadores guardados são reaproveitados', () => {
  it('muitas chamadas com o mesmo idioma e formato não criam outro Intl.DateTimeFormat', () => {
    setLocale('ar')
    setDateFormat('12h')
    // Aquece: o primeiro uso de cada formato cria o formatador.
    formatDateTime(NOON)
    formatShortDateTime(NOON)
    formatDate(NOON)
    const spy = vi.spyOn(Intl, 'DateTimeFormat')
    try {
      for (let i = 0; i < 500; i++) {
        formatDateTime(NOON + i * 60_000)
        formatShortDateTime(NOON + i * 60_000)
        formatDate(NOON + i * 60_000)
      }
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('muitas chamadas de formatRelative não criam outro Intl.RelativeTimeFormat', () => {
    setLocale('en')
    formatRelative(NOON - 60_000, NOON)
    const spy = vi.spyOn(Intl, 'RelativeTimeFormat')
    try {
      for (let i = 0; i < 500; i++) formatRelative(NOON - i * 1000, NOON)
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
})

describe('formatRelative com "agora" fixo', () => {
  it('segundos, minutos, horas, dias e mais de 30 dias', () => {
    setLocale('en')
    setDateFormat('iso')
    const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
    const DAY = 86_400_000
    expect(formatRelative(NOON - 30_000, NOON)).toBe(rtf.format(0, 'second'))
    expect(formatRelative(NOON - 5 * 60_000, NOON)).toBe(rtf.format(-5, 'minute'))
    expect(formatRelative(NOON + 3 * 3_600_000, NOON)).toBe(rtf.format(3, 'hour'))
    expect(formatRelative(NOON - DAY, NOON)).toBe(rtf.format(-1, 'day'))
    expect(formatRelative(NOON - 3 * DAY, NOON)).toBe(rtf.format(-3, 'day'))
    expect(formatRelative(NOON - 40 * DAY, NOON)).toBe(formatDate(NOON - 40 * DAY))
  })
})
