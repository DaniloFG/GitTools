import { useEffect, useState } from 'react'
import type { FileDiff } from '../../../shared/types'
import { useApp } from '../context'
import { errorMessage, shortSha } from '../format'
import { git } from '../git'
import { t } from '../i18n'
import { DiffView } from './DiffView'
import { Modal } from './Modal'

/** Arquivo de um commit aberto sozinho numa janela de diff. */
export interface DiffWindowRequest {
  sha: string
  path: string
}

/** Janela só com o diff de um arquivo (duplo clique nos arquivos expandidos do histórico). */
export function DiffWindow({ request, onClose }: { request: DiffWindowRequest; onClose(): void }) {
  const { toast, openFileView, openInEditor } = useApp()
  const { sha, path } = request
  const [diff, setDiff] = useState<FileDiff | null | 'error'>(null)

  useEffect(() => {
    setDiff(null)
    git.diff({ kind: 'commit', sha, path }).then(
      (files) => setDiff(files.find((f) => f.path === path) ?? files[0] ?? 'error'),
      (e) => {
        setDiff('error')
        toast('error', errorMessage(e))
      }
    )
  }, [sha, path, toast])

  return (
    <Modal
      id="diff-window"
      size="large"
      title={`${path} · ${shortSha(sha)}`}
      onClose={onClose}
      footer={
        <>
          <button
            onClick={() => {
              onClose()
              openFileView(path)
            }}
          >
            {t('common.blameHistory')}
          </button>
          <button onClick={() => openInEditor(path)}>{t('common.openInEditor')}</button>
          <button className="primary" onClick={onClose}>
            {t('common.close')}
          </button>
        </>
      }
    >
      <div className="diff-window">
        {diff === null ? (
          <p className="empty">
            <span className="spinner" />
          </p>
        ) : diff === 'error' ? (
          <p className="empty">{t('diff.noContent')}</p>
        ) : (
          <DiffView file={diff} />
        )}
      </div>
    </Modal>
  )
}
