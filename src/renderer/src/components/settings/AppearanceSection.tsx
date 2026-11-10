import { useState } from 'react'
import { DATE_FORMATS, DEFAULT_SETTINGS, DIVIDER_WIDTHS, PANE_BUTTON_SCALES, ZOOM_LEVELS, type DateFormatSetting, type ThemeSetting } from '../../../../shared/settings'
import { formatDateTime, t, type MessageKey } from '../../i18n'
import { fullDate } from '../../format'
import { resetLayout } from '../../layout'
import { applySavedLayout, cleanName, deleteSavedLayout, findByName, saveCurrentLayout, useCurrentLayoutName, useSavedLayouts } from '../../savedLayouts'
import { SettingCheckbox, SettingRow, SettingSegmented, SettingSelect } from './SettingRow'
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
  // Vem preenchido com o nome do layout em uso (pode ser trocado para salvar com outro nome).
  const currentName = useCurrentLayoutName()
  const [name, setName] = useState(currentName ?? '')
  const [message, setMessage] = useState<string | null>(null)
  const clean = cleanName(name)
  const replacing = clean ? findByName(saved, clean) : undefined
  const category = t('layouts.title')

  const save = () => {
    if (!clean) return
    saveCurrentLayout(saved, setSaved, clean)
    setMessage(t('layouts.saved', { name: replacing?.name ?? clean }))
    setName(clean)
  }

  return (
    <>
      <SettingRow id="setting-layout-name" title={t('layouts.title')} description={t('layouts.help')}>
        <div className="setting-inline">
          <input
            id="setting-layout-name"
            value={name}
            placeholder={t('layouts.namePlaceholder')}
            maxLength={60}
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
      </SettingRow>
      {saved.length === 0 ? (
        <p className="empty settings-empty">{t('layouts.none')}</p>
      ) : (
        saved.map((layout) => (
          <SettingRow key={layout.id} category={category} title={layout.name} description={layout.savedAt > 0 ? fullDate(layout.savedAt) : undefined}>
            <span className="button-row">
              <button
                onClick={() => {
                  applySavedLayout(layout)
                  setMessage(t('layouts.applied', { name: layout.name }))
                }}
              >
                {t('layouts.apply')}
              </button>
              <button className="danger" title={t('layouts.delete')} aria-label={t('layouts.delete')} onClick={() => deleteSavedLayout(saved, setSaved, layout.id)}>
                ✕
              </button>
            </span>
          </SettingRow>
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
  const category = t('settings.appearance.title')
  const dateSample = formatDateTime(Date.now())

  return (
    <div className="settings-group">
      <SettingRow category={category} title={t('settings.appearance.theme')} modified={draft.theme !== DEFAULT_SETTINGS.theme}>
        <SettingSegmented
          ariaLabel={t('settings.appearance.theme')}
          value={draft.theme}
          options={THEMES.map((theme) => ({ value: theme.id, label: theme.id === 'system' && inVsCode ? t('settings.appearance.themeVscode') : t(theme.label) }))}
          onChange={(theme) => update({ theme })}
        />
      </SettingRow>

      {!inVsCode && (
        <SettingRow id="setting-zoom" category={category} title={t('settings.appearance.zoom')} modified={draft.zoom !== DEFAULT_SETTINGS.zoom}>
          <SettingSelect
            id="setting-zoom"
            value={draft.zoom}
            options={ZOOM_LEVELS.map((n) => ({ value: n, label: `${Math.round(n * 100)}%${n === 1 ? ` ${t('settings.appearance.default')}` : ''}` }))}
            onChange={(zoom) => update({ zoom })}
          />
        </SettingRow>
      )}

      <SettingRow id="setting-date-format" category={category} title={t('settings.appearance.dateFormat')} description={t('settings.appearance.dateFormatHelp')} modified={draft.dateFormat !== DEFAULT_SETTINGS.dateFormat}>
        <SettingSelect
          id="setting-date-format"
          value={draft.dateFormat}
          options={DATE_FORMATS.map((id) => ({ value: id, label: t(DATE_FORMAT_LABELS[id]) }))}
          onChange={(dateFormat) => update({ dateFormat })}
        />
        <p className="setting-hint">{t('settings.appearance.dateFormatSample', { sample: dateSample })}</p>
      </SettingRow>

      <SettingCheckbox
        id="setting-file-icons"
        category={category}
        title={t('settings.appearance.fileIcons')}
        description={t('settings.appearance.fileIconsHelp')}
        checked={draft.fileIcons}
        modified={draft.fileIcons !== DEFAULT_SETTINGS.fileIcons}
        onChange={(fileIcons) => update({ fileIcons })}
      />
      <SettingCheckbox
        id="setting-status-letters"
        category={category}
        title={t('settings.appearance.statusLetters')}
        description={t('settings.appearance.statusLettersHelp')}
        checked={draft.statusLetters}
        modified={draft.statusLetters !== DEFAULT_SETTINGS.statusLetters}
        onChange={(statusLetters) => update({ statusLetters })}
      />

      <SettingRow category={category} title={t('settings.appearance.dividerWidth')} description={t('settings.appearance.layoutHelp')} modified={draft.dividerWidth !== DEFAULT_SETTINGS.dividerWidth}>
        <SettingSegmented
          ariaLabel={t('settings.appearance.dividerWidth')}
          value={draft.dividerWidth}
          options={DIVIDER_WIDTHS.map((n) => ({ value: n, label: `${n}px` }))}
          onChange={(dividerWidth) => update({ dividerWidth })}
        />
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
      </SettingRow>

      <SettingRow category={category} title={t('settings.appearance.paneButtons')} description={t('settings.appearance.dividerPreview')} modified={draft.paneButtonScale !== DEFAULT_SETTINGS.paneButtonScale}>
        <SettingSegmented
          ariaLabel={t('settings.appearance.paneButtons')}
          value={draft.paneButtonScale}
          options={PANE_BUTTON_SCALES.map((n) => ({ value: n, label: `${Math.round(n * 100)}%` }))}
          onChange={(paneButtonScale) => update({ paneButtonScale })}
        />
      </SettingRow>

      <SettingRow
        category={category}
        title={t('settings.appearance.resetLayout')}
        description={layoutReset ? `✓ ${t('settings.appearance.layoutRestored')}` : confirmingReset ? t('layout.resetConfirm.message') : t('settings.appearance.resetLayoutHelp')}
      >
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
      </SettingRow>
      <SavedLayouts />
    </div>
  )
}
