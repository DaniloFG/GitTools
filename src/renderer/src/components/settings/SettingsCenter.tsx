import { useEffect, useMemo, useState } from 'react'
import type { Settings } from '../../../../shared/settings'
import { t } from '../../i18n'
import { Modal } from '../Modal'
import { Split } from '../Split'
import { SETTINGS_SECTIONS } from './sections'

interface Props {
  settings: Settings
  initialSection: string
  /** Aplica o rascunho na hora (tema, idioma, escala) para o usuário ver o resultado. */
  onPreview(draft: Settings | null): void
  onSave(settings: Settings): Promise<void>
  onClose(): void
  onShowShortcuts(): void
}

/** Central de Configurações: todas as opções gerais do GitTools, organizadas em seções. */
export function SettingsCenter({ settings, initialSection, onPreview, onSave, onClose, onShowShortcuts }: Props) {
  const [draft, setDraft] = useState<Settings>(settings)
  const [sectionId, setSectionId] = useState(
    SETTINGS_SECTIONS.some((s) => s.id === initialSection) ? initialSection : SETTINGS_SECTIONS[0].id
  )
  const section = SETTINGS_SECTIONS.find((s) => s.id === sectionId)!
  const Section = section.component

  useEffect(() => {
    onPreview(draft)
  }, [draft, onPreview])

  const errors = useMemo(
    () =>
      SETTINGS_SECTIONS.flatMap((s) => {
        const error = s.validate?.(draft)
        return error ? [{ id: s.id, error }] : []
      }),
    [draft]
  )
  const changed = JSON.stringify(draft) !== JSON.stringify(settings)

  const [applying, setApplying] = useState(false)

  /** Grava as configurações; com `close`, fecha a tela em seguida. "Aplicar" grava e a mantém aberta (para seguir mexendo). */
  const commit = async (close: boolean) => {
    setApplying(true)
    try {
      await onSave(draft)
      if (close) onClose()
      else window.dispatchEvent(new CustomEvent('gittools:toast', { detail: { kind: 'success', text: t('settings.applied') } }))
    } finally {
      setApplying(false)
    }
  }

  return (
    <Modal
      title={`⚙ ${t('settings.title')}`}
      size="settings"
      onClose={onClose}
      footer={
        <>
          <span className="footer-summary">
            {errors.length > 0 ? <span className="warning-text">{t(errors[0].error)}</span> : changed ? t('settings.unsaved') : ''}
          </span>
          <button onClick={onClose}>{changed ? t('common.cancel') : t('common.close')}</button>
          <button disabled={errors.length > 0 || !changed || applying} title={t('settings.applyHelp')} onClick={() => void commit(false)}>
            {t('settings.apply')}
          </button>
          <button className="primary" disabled={errors.length > 0 || !changed || applying} title={t('settings.saveHelp')} onClick={() => void commit(true)}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <Split id="settings" className="settings-layout" fixed initial={210} min={[140, 320]} collapsible={[false, false]} arrangeable={false}>
        <nav className="settings-nav" aria-label={t('settings.title')}>
          {SETTINGS_SECTIONS.map((s) => (
            <button key={s.id} className={s.id === sectionId ? 'active' : ''} onClick={() => setSectionId(s.id)}>
              <span className="settings-nav-icon">{s.icon}</span>
              <span>{t(s.title)}</span>
              {errors.some((e) => e.id === s.id) && <span className="settings-nav-error">!</span>}
            </button>
          ))}
        </nav>
        <section className="settings-content">
          <header className="settings-section-header">
            <h3>{t(section.title)}</h3>
            <p className="muted">{t(section.description)}</p>
          </header>
          <Section
            draft={draft}
            update={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            replace={setDraft}
          />
          {section.id === 'shortcuts' && (
            <button className="link settings-help-link" onClick={onShowShortcuts}>
              {t('settings.shortcuts.showList')}
            </button>
          )}
        </section>
      </Split>
    </Modal>
  )
}
