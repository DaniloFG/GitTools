import { useContext, useEffect, useState } from 'react'
import type { RemoteInfo } from '../../../../shared/types'
import { AppContext } from '../../context'
import { errorMessage } from '../../format'
import { git } from '../../git'
import { t } from '../../i18n'
import { Loader } from '../Loader'

/**
 * Remotes (servidores) do repositório aberto: ver as URLs, adicionar outro remote — por exemplo o
 * repositório original de um fork ou um espelho —, trocar a URL, renomear e remover.
 */
export function RemotesSection() {
  const app = useContext(AppContext)
  const [remotes, setRemotes] = useState<RemoteInfo[] | null>(null)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [fetchNow, setFetchNow] = useState(true)
  const [editing, setEditing] = useState<{ name: string; url: string } | null>(null)
  /** URL de envio digitada para cada remote (campo "adicionar destino de push"). */
  const [pushDrafts, setPushDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const load = () =>
    git.remotes().then(
      (list) => {
        setRemotes(list)
        // Sugere um nome livre: "origin" para o primeiro, "upstream" para o seguinte.
        setName((current) => current || (list.some((r) => r.name === 'origin') ? (list.some((r) => r.name === 'upstream') ? '' : 'upstream') : 'origin'))
      },
      (e) => setMessage({ ok: false, text: errorMessage(e) })
    )

  useEffect(() => {
    if (app) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!app) return null

  /** Executa uma alteração e atualiza a lista e a tela principal (as branches remotas podem mudar). */
  const change = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true)
    setMessage(null)
    try {
      await action()
      setMessage({ ok: true, text: success })
      await load()
      await app.refresh()
      return true
    } catch (e) {
      setMessage({ ok: false, text: errorMessage(e) })
      return false
    } finally {
      setBusy(false)
    }
  }

  const add = async () => {
    const added = name.trim()
    if (await change(() => git.addRemote(added, url.trim(), fetchNow), t('remotes.added', { name: added }))) {
      setName('')
      setUrl('')
    }
  }

  const remove = async (remote: RemoteInfo) => {
    const ok = await app.confirm({
      title: t('remotes.removeTitle'),
      message: t('remotes.removeMessage', { name: remote.name, url: remote.fetchUrl }),
      confirmLabel: t('remotes.remove'),
      danger: true
    })
    if (ok) await change(() => git.removeRemote(remote.name), t('remotes.removed', { name: remote.name }))
  }

  const rename = async (remote: RemoteInfo) => {
    const next = await app.prompt({ title: t('remotes.renameTitle'), label: t('remotes.name'), initial: remote.name, confirmLabel: t('remotes.rename') })
    if (next && next.trim() !== remote.name) await change(() => git.renameRemote(remote.name, next.trim()), t('remotes.renamed', { name: next.trim() }))
  }

  const addPushUrl = async (remote: RemoteInfo) => {
    const url = (pushDrafts[remote.name] ?? '').trim()
    if (await change(() => git.addRemoteUrl(remote.name, url), t('remotes.pushUrlAdded', { name: remote.name }))) setPushDrafts((d) => ({ ...d, [remote.name]: '' }))
  }

  const removePushUrl = (remote: RemoteInfo, url: string) => change(() => git.removeRemoteUrl(remote.name, url), t('remotes.pushUrlRemoved', { name: remote.name }))

  const saveUrl = async () => {
    if (!editing) return
    if (await change(() => git.setRemoteUrl(editing.name, editing.url.trim()), t('remotes.urlChanged', { name: editing.name }))) setEditing(null)
  }

  return (
    <div className="settings-group remotes">
      <h4>{t('remotes.title')}</h4>
      <p className="muted small">{t('remotes.help')}</p>

      {remotes === null ? (
        <p className="muted">
          <Loader size="sm" label={t('loader.loading')} />
        </p>
      ) : remotes.length === 0 ? (
        <p className="empty small">{t('remotes.none')}</p>
      ) : (
        <ul className="remote-list">
          {remotes.map((remote) => (
            <li key={remote.name} className="remote-item">
              <div className="remote-head">
                <strong>{remote.name}</strong>
                <span className="toolbar-spacer" />
                <button disabled={busy} onClick={() => setEditing({ name: remote.name, url: remote.fetchUrl })}>
                  {t('remotes.editUrl')}
                </button>
                <button disabled={busy} onClick={() => rename(remote)}>
                  {t('remotes.rename')}
                </button>
                <button className="danger subtle" disabled={busy} onClick={() => remove(remote)}>
                  {t('remotes.remove')}
                </button>
              </div>
              {editing?.name === remote.name ? (
                <div className="field-row">
                  <input
                    dir="ltr"
                    autoFocus
                    value={editing.url}
                    onChange={(e) => setEditing({ ...editing, url: e.target.value })}
                    onKeyDown={(e) => (e.key === 'Enter' ? void saveUrl() : e.key === 'Escape' && setEditing(null))}
                  />
                  <button className="primary" disabled={busy || !editing.url.trim() || editing.url.trim() === remote.fetchUrl} onClick={saveUrl}>
                    {t('common.save')}
                  </button>
                  <button onClick={() => setEditing(null)}>{t('common.cancel')}</button>
                </div>
              ) : (
                <code className="remote-url" dir="ltr" title={t('remotes.fetchUrl')}>
                  {remote.fetchUrl}
                </code>
              )}
              <div className="remote-pushes">
                <span className="muted small" title={t('remotes.pushUrlsHelp')}>
                  {t('remotes.pushUrls')}
                </span>
                <ul className="remote-push-list">
                  {remote.pushUrls.map((pushUrl) => (
                    <li key={pushUrl} className="remote-push">
                      <code className="remote-url muted" dir="ltr" title={t('remotes.pushUrl')}>
                        ↑ {pushUrl}
                      </code>
                      {!remote.customPush && <span className="muted small">({t('remotes.pushUrlDefault')})</span>}
                      {remote.customPush && (
                        <button className="danger subtle" disabled={busy} title={t('remotes.removePushUrl')} aria-label={t('remotes.removePushUrl')} onClick={() => void removePushUrl(remote, pushUrl)}>
                          ✕
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="field-row">
                  <input
                    dir="ltr"
                    value={pushDrafts[remote.name] ?? ''}
                    placeholder={t('remotes.addPushUrlPlaceholder')}
                    aria-label={t('remotes.addPushUrl')}
                    onChange={(e) => setPushDrafts((d) => ({ ...d, [remote.name]: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && (pushDrafts[remote.name] ?? '').trim() && !busy && void addPushUrl(remote)}
                  />
                  <button disabled={busy || !(pushDrafts[remote.name] ?? '').trim()} onClick={() => void addPushUrl(remote)}>
                    {t('remotes.addPushUrl')}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h4>{t('remotes.addTitle')}</h4>
      <div className="identity-fields">
        <label className="field">
          <span>{t('remotes.name')}</span>
          <input dir="ltr" value={name} placeholder="origin" onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>{t('remotes.url')}</span>
          <input
            dir="ltr"
            value={url}
            placeholder={t('remotes.urlPlaceholder')}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && url.trim() && !busy && add()}
          />
        </label>
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={fetchNow} onChange={(e) => setFetchNow(e.target.checked)} />
        <span>{t('remotes.fetchNow')}</span>
      </label>
      <div className="button-row">
        <button className="primary" disabled={busy || !name.trim() || !url.trim()} onClick={add}>
          {busy ? <Loader size="sm" /> : t('remotes.add')}
        </button>
      </div>
      {message && <p className={message.ok ? 'success-text' : 'warning-text pre-line'}>{message.text}</p>}
    </div>
  )
}
