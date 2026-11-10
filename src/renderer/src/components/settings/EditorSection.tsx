import { useEffect, useState } from 'react'
import type { EditorInfo } from '../../../../shared/api'
import { DEFAULT_SETTINGS, type DiffLayout } from '../../../../shared/settings'
import { t, type MessageKey } from '../../i18n'
import { getActiveRoot } from '../../git'
import { SettingCheckbox, SettingRow, SettingSegmented, SettingSelect } from './SettingRow'
import type { SettingsSectionProps } from './sections'
import { useAppInfo } from './useAppInfo'

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
      await window.gittools.testEditor(draft.editor, getActiveRoot() ?? undefined)
      setTest({ ok: true, message: t('editorSetup.testOk') })
    } catch (error) {
      setTest({ ok: false, message: error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(error) })
    }
  }

  const info = useAppInfo()
  // Dentro do VS Code os arquivos abrem no próprio editor dele: não há o que escolher.
  const insideVsCode = info?.host === 'vscode'

  // "" = nenhum escolhido; depois os editores encontrados e, se for um caminho manual, ele mesmo.
  const editorOptions = !editors
    ? [{ value: '', label: t('settings.editor.detecting'), disabled: true }]
    : [
        { value: '', label: t('settings.editor.clear') },
        ...editors.map((e) => ({ value: e.id, label: e.name })),
        ...(custom ? [{ value: draft.editor, label: `${t('settings.editor.custom')}: ${draft.editor}` }] : [])
      ]

  return (
    <div className="settings-group">
      {insideVsCode && <p className="muted small setting-note">{t('settings.editor.vscodeNote')}</p>}

      {!insideVsCode && (
        <>
          <SettingRow id="setting-editor" title={t('settings.editor.editor')} description={t('settings.editor.editorHelp')} modified={draft.editor !== DEFAULT_SETTINGS.editor}>
            <SettingSelect id="setting-editor" value={draft.editor} options={editorOptions} disabled={!editors} onChange={(editor) => update({ editor })} />
            {editors?.length === 0 && <p className="setting-hint">{t('settings.editor.noneFound')}</p>}
          </SettingRow>

          <SettingRow id="setting-editor-path" title={t('editorSetup.manual')} description={t('editorSetup.manualHelp')}>
            <div className="setting-inline">
              <input
                id="setting-editor-path"
                dir="ltr"
                value={draft.editor}
                placeholder={t('editorSetup.manualPlaceholder')}
                spellCheck={false}
                onChange={(e) => {
                  setTest(null)
                  update({ editor: e.target.value })
                }}
              />
              <button onClick={browse}>{t('settings.editor.browse')}</button>
              <button disabled={!draft.editor.trim() || test === 'running'} onClick={runTest}>
                {test === 'running' ? <span className="setting-hint">…</span> : '▶'} {t('editorSetup.test')}
              </button>
            </div>
            {test && test !== 'running' && <p className={test.ok ? 'success-text' : 'warning-text'}>{test.message}</p>}
          </SettingRow>
        </>
      )}

      <SettingCheckbox
        id="setting-inline-blame"
        title={t('settings.editor.inlineBlame')}
        description={t('settings.editor.inlineBlameLabel')}
        checked={draft.inlineBlame}
        modified={draft.inlineBlame !== DEFAULT_SETTINGS.inlineBlame}
        onChange={(inlineBlame) => update({ inlineBlame })}
      />

      <SettingRow title={t('settings.editor.diffContent')} description={t('settings.editor.diffContentHelp')} modified={draft.diffFullFile !== DEFAULT_SETTINGS.diffFullFile}>
        <SettingSegmented
          ariaLabel={t('settings.editor.diffContent')}
          value={draft.diffFullFile ? 'full' : 'changes'}
          options={[
            { value: 'changes', label: t('settings.editor.diffContentChanges') },
            { value: 'full', label: t('settings.editor.diffContentFull') }
          ]}
          onChange={(v) => update({ diffFullFile: v === 'full' })}
        />
      </SettingRow>

      <SettingRow title={t('settings.editor.diffLayout')} description={t('settings.editor.diffLayoutHelp')} modified={draft.diffLayout !== DEFAULT_SETTINGS.diffLayout}>
        <SettingSegmented
          ariaLabel={t('settings.editor.diffLayout')}
          value={draft.diffLayout}
          options={DIFF_LAYOUTS.map((layout) => ({ value: layout.id, label: t(layout.label), title: t(layout.help) }))}
          onChange={(diffLayout) => update({ diffLayout })}
        />
      </SettingRow>
    </div>
  )
}
