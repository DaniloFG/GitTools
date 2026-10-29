import { useEffect, useState } from 'react'
import type { EditorInfo } from '../../../../shared/api'
import type { DiffLayout } from '../../../../shared/settings'
import { t, type MessageKey } from '../../i18n'
import type { SettingsSectionProps } from './sections'
import { useAppInfo } from './useAppInfo'
import { Loader } from '../Loader'

const DIFF_LAYOUTS: { id: DiffLayout; label: MessageKey; help: MessageKey }[] = [
  { id: 'inline', label: 'diff.inline', help: 'diff.inlineHelp' },
  { id: 'split', label: 'diff.split', help: 'diff.splitHelp' }
]

/** Editor usado por "Abrir no editor" (entre os instalados no computador) e modo padrão do diff. */
export function EditorSection({ draft, update }: SettingsSectionProps) {
  const [editors, setEditors] = useState<EditorInfo[] | null>(null)
  const [test, setTest] = useState<{ ok: boolean; message: string } | 'running' | null>(null)

  useEffect(() => {
    window.gittools.detectEditors().then(setEditors, () => setEditors([]))
  }, [])

  const custom = !!draft.editor && !!editors && !editors.some((e) => e.id === draft.editor)

  const browse = async () => {
    const path = await window.gittools.chooseEditor()
    if (path) update({ editor: path })
  }

  /** Abre a pasta do repositório com o editor escolhido, sem precisar salvar antes. */
  const runTest = async () => {
    setTest('running')
    try {
      await window.gittools.testEditor(draft.editor)
      setTest({ ok: true, message: t('editorSetup.testOk') })
    } catch (error) {
      setTest({ ok: false, message: error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(error) })
    }
  }

  const info = useAppInfo()
  // Dentro do VS Code os arquivos abrem no próprio editor dele: não há o que escolher.
  const insideVsCode = info?.host === 'vscode'

  return (
    <div className="settings-group">
      {insideVsCode ? <p className="muted">{t('settings.editor.vscodeNote')}</p> : (<>
      <h4>{t('settings.editor.editor')}</h4>
      <p className="muted small">{t('settings.editor.editorHelp')}</p>
      {!editors ? (
        <p className="muted">
          <Loader size="sm" label={t('settings.editor.detecting')} />
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
      <label className="field editor-manual">
        <span>{t('editorSetup.manual')}</span>
        <input
          dir="ltr"
          value={draft.editor}
          placeholder={t('editorSetup.manualPlaceholder')}
          onChange={(e) => {
            setTest(null)
            update({ editor: e.target.value })
          }}
          spellCheck={false}
        />
        <small className="muted">{t('editorSetup.manualHelp')}</small>
      </label>
      <div className="button-row">
        <button onClick={browse}>{t('settings.editor.browse')}</button>
        <button disabled={!draft.editor.trim() || test === 'running'} onClick={runTest}>
          {test === 'running' ? <Loader size="sm" /> : '▶'} {t('editorSetup.test')}
        </button>
        {draft.editor && <button onClick={() => update({ editor: '' })}>{t('settings.editor.clear')}</button>}
      </div>
      {test && test !== 'running' && <p className={test.ok ? 'success-text' : 'warning-text'}>{test.message}</p>}
      </>)}

      <h4>{t('settings.editor.inlineBlame')}</h4>
      <p className="muted small">{t('settings.editor.inlineBlameHelp')}</p>
      <div className="settings-row">
        <span>{t('settings.editor.inlineBlameLabel')}</span>
        <label className="checkbox">
          <input type="checkbox" checked={draft.inlineBlame} onChange={(e) => update({ inlineBlame: e.target.checked })} />
        </label>
      </div>

      <h4>{t('settings.editor.diffContent')}</h4>
      <p className="muted small">{t('settings.editor.diffContentHelp')}</p>
      <div className="settings-row">
        <span>{t('settings.editor.diffContentLabel')}</span>
        <div className="segmented">
          <button className={!draft.diffFullFile ? 'active' : ''} aria-pressed={!draft.diffFullFile} onClick={() => update({ diffFullFile: false })}>
            {t('settings.editor.diffContentChanges')}
          </button>
          <button className={draft.diffFullFile ? 'active' : ''} aria-pressed={draft.diffFullFile} onClick={() => update({ diffFullFile: true })}>
            {t('settings.editor.diffContentFull')}
          </button>
        </div>
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
