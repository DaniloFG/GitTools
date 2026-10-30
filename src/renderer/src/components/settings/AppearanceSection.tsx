import { useState } from 'react'
import { DATE_FORMATS, DIVIDER_WIDTHS, PANE_BUTTON_SCALES, ZOOM_LEVELS, type DateFormatSetting, type ThemeSetting } from '../../../../shared/settings'
import { formatDateTime, t, type MessageKey } from '../../i18n'
import { fullDate } from '../../format'
import { resetLayout } from '../../layout'
import { applySavedLayout, cleanName, findByName, removeSavedLayout, saveCurrentLayout, useSavedLayouts } from '../../savedLayouts'
import type { SettingsSectionProps } from './sections'
import { useAppInfo } from './useAppInfo'

const THEMES: { id: ThemeSetting; label: MessageKey }[] = [
  { id: 'system', label: 'settings.appearance.themeSystem' },
  { id: 'dark', label: 'settings.appearance.themeDark' },
  { id: 'light', label: 'settings.appearance.themeLight' }
]

const DATE_FORMAT_LABELS: Record<DateFormatSetting, MessageKey> = {
  iso: 'settings.appearance.dateFormatIso',
  system: 'settings.appearance.dateFormatSystem',
  '24h': 'settings.appearance.dateFormat24h',
  '12h': 'settings.appearance.dateFormat12h'
}

/** Salvar o layout de agora com um nome, reaplicar um salvo ou apagá-lo. */
function SavedLayouts() {
  const [saved, setSaved] = useSavedLayouts()
  const [name, setName] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const clean = cleanName(name)
  const replacing = clean ? findByName(saved, clean) : undefined

  const save = () => {
    if (!clean) return
    saveCurrentLayout(saved, setSaved, clean)
    setMessage(t('layouts.saved', { name: replacing?.name ?? clean }))
    setName('')
  }

  return (
    <>
      <h4>{t('layouts.title')}</h4>
      <p className="muted small">{t('layouts.help')}</p>
      <div className="settings-row">
        <input
          value={name}
          placeholder={t('layouts.namePlaceholder')}
          maxLength={60}
          aria-label={t('layouts.name')}
          onChange={(e) => {
            setName(e.target.value)
            setMessage(null)
          }}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
        <button disabled={!clean} onClick={save}>
          {replacing ? t('layouts.replace') : t('layouts.save')}
        </button>
      </div>
      {message && <p className="success-text">✓ {message}</p>}
      {saved.length === 0 ? (
        <p className="muted small">{t('layouts.none')}</p>
      ) : (
        saved.map((layout) => (
          <div key={layout.id} className="settings-row">
            <div>
              <span>{layout.name}</span>
              {layout.savedAt > 0 && <p className="muted small">{fullDate(layout.savedAt)}</p>}
            </div>
            <span className="button-row">
              <button
                onClick={() => {
                  applySavedLayout(layout)
                  setMessage(t('layouts.applied', { name: layout.name }))
                }}
              >
                {t('layouts.apply')}
              </button>
              <button className="danger" title={t('layouts.delete')} aria-label={t('layouts.delete')} onClick={() => setSaved(removeSavedLayout(saved, layout.id))}>
                ✕
              </button>
            </span>
          </div>
        ))
      )}
    </>
  )
}

export function AppearanceSection({ draft, update }: SettingsSectionProps) {
  const info = useAppInfo()
  const [layoutReset, setLayoutReset] = useState(false)
  const [confirmingReset, setConfirmingReset] = useState(false)
  const inVsCode = info?.host === 'vscode'
  return (
    <div className="settings-group">
      <div className="settings-row">
        <span>{t('settings.appearance.theme')}</span>
        <div className="segmented">
          {THEMES.map((theme) => (
            <button key={theme.id} className={draft.theme === theme.id ? 'active' : ''} onClick={() => update({ theme: theme.id })}>
              {theme.id === 'system' && inVsCode ? t('settings.appearance.themeVscode') : t(theme.label)}
            </button>
          ))}
        </div>
      </div>
      <div className="settings-row">
        <div>
          <span>{t('settings.appearance.fileIcons')}</span>
          <p className="muted small">{t('settings.appearance.fileIconsHelp')}</p>
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={draft.fileIcons} onChange={(e) => update({ fileIcons: e.target.checked })} />
        </label>
      </div>
      <div className="settings-row">
        <div>
          <span>{t('settings.appearance.statusLetters')}</span>
          <p className="muted small">{t('settings.appearance.statusLettersHelp')}</p>
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={draft.statusLetters} onChange={(e) => update({ statusLetters: e.target.checked })} />
        </label>
      </div>
      <div className="settings-row">
        <div>
          <span>{t('settings.appearance.dateFormat')}</span>
          <p className="muted small">{t('settings.appearance.dateFormatHelp')}</p>
          <p className="muted small">{t('settings.appearance.dateFormatSample', { sample: formatDateTime(Date.now()) })}</p>
        </div>
        <select value={draft.dateFormat} aria-label={t('settings.appearance.dateFormat')} onChange={(e) => update({ dateFormat: e.target.value as DateFormatSetting })}>
          {DATE_FORMATS.map((id) => (
            <option key={id} value={id}>
              {t(DATE_FORMAT_LABELS[id])}
            </option>
          ))}
        </select>
      </div>
      {info?.host !== 'vscode' && (
      <div className="settings-row">
        <span>{t('settings.appearance.zoom')}</span>
        <select value={draft.zoom} onChange={(e) => update({ zoom: Number(e.target.value) })}>
          {ZOOM_LEVELS.map((n) => (
            <option key={n} value={n}>
              {Math.round(n * 100)}%{n === 1 ? ` ${t('settings.appearance.default')}` : ''}
            </option>
          ))}
        </select>
      </div>
      )}
      <h4>{t('settings.appearance.layout')}</h4>
      <p className="muted small">{t('settings.appearance.layoutHelp')}</p>
      <div className="settings-row">
        <span>{t('settings.appearance.dividerWidth')}</span>
        <div className="segmented">
          {DIVIDER_WIDTHS.map((n) => (
            <button key={n} className={draft.dividerWidth === n ? 'active' : ''} onClick={() => update({ dividerWidth: n })}>
              {n}px
            </button>
          ))}
        </div>
      </div>
      <div className="settings-row">
        <span>{t('settings.appearance.paneButtons')}</span>
        <div className="segmented">
          {PANE_BUTTON_SCALES.map((n) => (
            <button key={n} className={draft.paneButtonScale === n ? 'active' : ''} onClick={() => update({ paneButtonScale: n })}>
              {Math.round(n * 100)}%
            </button>
          ))}
        </div>
      </div>
      {/* Amostra: a divisória e os botões como ficam nos painéis (os botões crescem com o mouse em cima). */}
      <div className="split split-row divider-preview" aria-hidden>
        <div className="divider-preview-pane" />
        <div className="split-divider divider-preview-line">
          <div className="split-divider-buttons">
            <button tabIndex={-1}>◂</button>
            <button tabIndex={-1}>▸</button>
          </div>
        </div>
        <div className="divider-preview-pane" />
      </div>
      <p className="muted small">{t('settings.appearance.dividerPreview')}</p>
      <div className="settings-row">
        <span>{layoutReset ? `✓ ${t('settings.appearance.layoutRestored')}` : confirmingReset ? t('layout.resetConfirm.message') : t('settings.appearance.resetLayoutHelp')}</span>
        {confirmingReset ? (
          <span className="button-row">
            <button onClick={() => setConfirmingReset(false)}>{t('common.cancel')}</button>
            <button
              className="danger"
              onClick={() => {
                resetLayout()
                setConfirmingReset(false)
                setLayoutReset(true)
              }}
            >
              {t('layout.resetConfirm.confirm')}
            </button>
          </span>
        ) : (
          <button onClick={() => setConfirmingReset(true)}>{t('settings.appearance.resetLayout')}</button>
        )}
      </div>
      <SavedLayouts />
    </div>
  )
}
