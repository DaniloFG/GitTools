import { useApp } from '../context'
import { git } from '../git'
import { shortSha } from '../format'

const LABEL = {
  merge: 'Merge em andamento',
  'cherry-pick': 'Cherry-pick em andamento',
  revert: 'Revert em andamento',
  rebase: 'Rebase em andamento'
} as const

export function OperationBanner({ onShowChanges }: { onShowChanges(): void }) {
  const { data, run, confirm } = useApp()
  const { operation, status } = data
  const conflicts = status.conflicted
  if (operation.kind === 'none' && conflicts.length === 0) return null

  const title =
    operation.kind === 'none'
      ? 'Arquivos em conflito'
      : `${LABEL[operation.kind]}${operation.head ? ` — ${shortSha(operation.head)}` : ''}${
          operation.step ? ` (passo ${operation.step} de ${operation.total})` : ''
        }`

  const abort = async () => {
    const ok = await confirm({
      title: 'Abortar',
      message:
        operation.kind === 'none'
          ? 'Voltar os arquivos em conflito para a versão do último commit?'
          : 'Desfazer a operação e voltar ao estado de antes de começar?',
      confirmLabel: 'Abortar',
      danger: true
    })
    if (ok) await run('Abortando', () => git.abortOperation())
  }

  return (
    <div className={`operation-banner ${conflicts.length ? 'has-conflicts' : ''}`}>
      <div className="operation-title">
        <strong>{title}</strong>
        <span className="muted">
          {conflicts.length
            ? `${conflicts.length} arquivo(s) em conflito. Para cada um, escolha uma versão ou edite e marque como resolvido.`
            : 'Sem conflitos pendentes. Continue para concluir.'}
        </span>
      </div>
      {conflicts.length > 0 && (
        <ul className="conflict-list">
          {conflicts.map((f) => (
            <li key={f.path}>
              <span className="conflict-path">{f.path}</span>
              <button onClick={() => window.gittools.openFile(f.path)}>Abrir no editor</button>
              <button onClick={() => run('Resolvendo', () => git.resolveConflict(f.path, 'ours'))} title="Mantém a versão da branch atual (HEAD)">
                Usar a atual
              </button>
              <button onClick={() => run('Resolvendo', () => git.resolveConflict(f.path, 'theirs'))} title="Mantém a versão que está sendo aplicada">
                Usar a que entra
              </button>
              <button onClick={() => run('Resolvendo', () => git.resolveConflict(f.path, 'resolved'))} title="Já editei o arquivo e removi os marcadores <<<<<<< >>>>>>>">
                ✓ Resolvido
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="operation-actions">
        {operation.kind !== 'none' ? (
          <>
            <button className="primary" disabled={conflicts.length > 0} onClick={() => run('Continuando', () => git.continueOperation())}>
              Continuar
            </button>
            {operation.kind !== 'merge' && <button onClick={() => run('Pulando', () => git.skipOperation())}>Pular este commit</button>}
          </>
        ) : (
          <button onClick={onShowChanges}>Ver alterações</button>
        )}
        <button className="danger" onClick={abort}>
          Abortar
        </button>
      </div>
    </div>
  )
}
