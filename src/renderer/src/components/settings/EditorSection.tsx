import { useEffect, useState } from 'react'
import type { EditorInfo } from '../../../../shared/api'
import type { DiffLayout } from '../../../../shared/settings'
import { t, type MessageKey } from '../../i18n'
import type { SettingsSectionProps } from './sections'

const DIFF_LAYOUTS: { id: DiffLayout; label: MessageKey; help: MessageKey }[] = [
  { id: 'inline', label: 'diff.inline', help: 'diff.inlineHelp' },
  { id: 'split', label: 'diff.split', help: 'diff.splitHelp' }
]

/** Editor usado por "Abrir no editor" (entre os instalados no computador) e modo padrão do diff. */
export function EditorSection({ draft, update }: SettingsSectionProps) {
  const [editors, setEditors] = useState<EditorInfo[] | null>(null)

  useEffect(() => {
    window.gittools.detectEditors().then(setEditors, () => setEditors([]))
  }, [])

  const custom = !!draft.editor && !!editors && !editors.some((e) => e.id === draft.editor)

  const browse = async () => {
    const path = await window.gittools.chooseEditor()
    if (path) update({ editor: path })
  }

  return (
    <div className="settings-group">
      <h4>{t('settings.editor.editor')}</h4>
      <p className="muted small">{t('settings.editor.editorHelp')}</p>
      {!editors ? (
        <p className="muted">
          <span className="spinner" /> {t('settings.editor.detecting')}
        </p>
      ) : (
        <div className="language-list" role="radiogroup" aria-label={t('settings.editor.editor')}>
          {editors.length === 0 && <p className="muted small">{t('settings.editor.noneFound')}</p>}
          {editors.map((editor) => (
            <label key={editor.id} className={`language-option ${draft.editor === editor.id ? 'selected' : ''}`}>
              <input type="radio" name="editor" checked={draft.editor === editor.id} onChange={() => update({ editor: editor.id })} />
              <span className="language-native">{editor.name}</span>
              <span className="muted small editor-command" dir="ltr" title={editor.command}>
                {editor.command}
              </span>
            </label>
          ))}
          {custom && (
            <label className="language-option selected">
              <input type="radio" name="editor" checked readOnly />
              <span className="language-native">{t('settings.editor.custom')}</span>
              <span className="muted small editor-command" dir="ltr" title={draft.editor}>
                {draft.editor}
              </span>
            </label>
          )}
        </div>
      )}
      <div className="button-row">
        <button onClick={browse}>{t('settings.editor.browse')}</button>
        {draft.editor && <button onClick={() => update({ editor: '' })}>{t('settings.editor.clear')}</button>}
      </div>

      <h4>{t('settings.editor.diffLayout')}</h4>
      <p className="muted small">{t('settings.editor.diffLayoutHelp')}</p>
      <div className="settings-row">
        <span>{t('diff.layout')}</span>
        <div className="segmented">
          {DIFF_LAYOUTS.map((layout) => (
            <button
              key={layout.id}
              className={draft.diffLayout === layout.id ? 'active' : ''}
              title={t(layout.help)}
              onClick={() => update({ diffLayout: layout.id })}
            >
              {t(layout.label)}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
