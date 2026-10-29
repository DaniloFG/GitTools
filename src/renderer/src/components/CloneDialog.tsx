import { useEffect, useState } from 'react'
import type { RepoInfo } from '../../../shared/types'
import { errorMessage } from '../format'
import { t } from '../i18n'
import { Modal } from './Modal'
import { Loader } from './Loader'

/** Nome de pasta sugerido a partir da URL (ex.: ".../org/projeto.git" → "projeto"). */
function nameFromUrl(url: string): string {
  const clean = url.trim().replace(/[\\/]+$/, '').replace(/\.git$/i, '')
  return (clean.split(/[\\/:]/).pop() ?? '').replace(/[^\w.-]/g, '')
}

/** git clone: URL, pasta onde criar e nome da pasta; ao terminar, o repositório é aberto. */
export function CloneDialog({ onClose, onCloned }: { onClose(): void; onCloned(info: RepoInfo): void }) {
  const [url, setUrl] = useState('')
  const [parent, setParent] = useState('')
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [cloning, setCloning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.gittools.defaultCloneFolder().then((dir) => setParent((prev) => prev || dir), () => undefined)
  }, [])

  useEffect(() => {
    if (!nameTouched) setName(nameFromUrl(url))
  }, [url, nameTouched])

  const choose = async () => {
    const dir = await window.gittools.chooseFolder(t('clone.folder'))
    if (dir) setParent(dir)
  }

  const clone = async () => {
    setCloning(true)
    setError(null)
    try {
      onCloned(await window.gittools.cloneRepository(url, parent, name))
    } catch (e) {
      setError(errorMessage(e))
      setCloning(false)
    }
  }

  const ready = !!url.trim() && !!parent && !!name.trim() && !cloning
  const separator = parent.includes('\\') ? '\\' : '/'

  return (
    <Modal
      id="clone"
      title={`⇣ ${t('clone.title')}`}
      size="medium"
      onClose={() => !cloning && onClose()}
      footer={
        <>
          <span className="footer-summary muted small">{cloning ? t('clone.cloning', { url }) : parent && name ? `${parent}${separator}${name}` : ''}</span>
          <button disabled={cloning} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="primary" disabled={!ready} onClick={clone}>
            {cloning ? <Loader size="sm" /> : t('clone.clone')}
          </button>
        </>
      }
    >
      <div className="clone-form">
        <label className="field">
          <span>{t('clone.url')}</span>
          <input
            autoFocus
            dir="ltr"
            value={url}
            placeholder={t('clone.urlPlaceholder')}
            spellCheck={false}
            disabled={cloning}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && ready && clone()}
          />
        </label>
        <label className="field">
          <span>{t('clone.folder')}</span>
          <div className="field-row">
            <input dir="ltr" value={parent} spellCheck={false} disabled={cloning} onChange={(e) => setParent(e.target.value)} />
            <button disabled={cloning} onClick={choose}>
              {t('clone.choose')}
            </button>
          </div>
        </label>
        <label className="field">
          <span>{t('clone.name')}</span>
          <input
            dir="ltr"
            value={name}
            spellCheck={false}
            disabled={cloning}
            onChange={(e) => {
              setNameTouched(true)
              setName(e.target.value)
            }}
          />
        </label>
        <p className="muted small">{t('clone.help')}</p>
        {error && <p className="warning-text pre-line">{error}</p>}
      </div>
    </Modal>
  )
}
