import { useEffect, useMemo, useState } from 'react'
import type { ConflictDetails } from '../../../shared/types'
import { buildResult, parseConflicts, resolveChunk, type ChunkResolution, type MergeChunk } from '../../../shared/conflicts'
import { useApp } from '../context'
import { errorMessage } from '../format'
import { git } from '../git'
import { Modal } from './Modal'

type Conflict = Extract<MergeChunk, { kind: 'conflict' }>
const CONTEXT = 3

/**
 * Editor de conflitos em três colunas: versão atual (HEAD) × resultado × versão que entra.
 * Cada bloco em conflito é resolvido com um clique (ou editando o resultado à mão).
 */
export function ConflictEditor({ path, onClose }: { path: string; onClose(): void }) {
  const { run, toast } = useApp()
  const [details, setDetails] = useState<ConflictDetails | null>(null)
  const [resolutions, setResolutions] = useState<(ChunkResolution | undefined)[]>([])
  const [showFinal, setShowFinal] = useState(false)

  useEffect(() => {
    git.conflictDetails(path).then(setDetails, (e) => {
      toast('error', errorMessage(e))
      onClose()
    })
  }, [path, toast, onClose])

  const parsed = useMemo(() => (details?.working != null ? parseConflicts(details.working) : null), [details])
  const conflicts = parsed?.chunks.filter((c): c is Conflict => c.kind === 'conflict') ?? []
  const resolvedCount = conflicts.filter((_, i) => resolutions[i]).length
  const result = parsed ? buildResult(parsed, resolutions) : ''

  const setAt = (index: number, resolution: ChunkResolution | undefined) => {
    const next = [...resolutions]
    next[index] = resolution
    setResolutions(next)
  }

  const save = async () => {
    const done = await run('Salvando resolução', async () => {
      await git.saveConflictResolution(path, result)
      return true
    })
    if (done) onClose()
  }

  const resolveWhole = async (side: 'ours' | 'theirs') => {
    const done = await run('Resolvendo', async () => {
      await git.resolveConflict(path, side)
      return true
    })
    if (done) onClose()
  }

  if (!details) {
    return (
      <Modal title={`Conflito em ${path}`} onClose={onClose} size="medium">
        <p className="empty">
          <span className="spinner" /> Carregando versões…
        </p>
      </Modal>
    )
  }

  // Conflitos sem marcadores no texto: binário, ou um lado removeu o arquivo.
  if (details.binary || !parsed || details.ours === null || details.theirs === null) {
    const reason = details.binary
      ? 'É um arquivo binário: escolha qual versão manter.'
      : details.ours === null
        ? 'A branch atual removeu este arquivo, mas a versão que entra o alterou.'
        : details.theirs === null
          ? 'A versão que entra removeu este arquivo, mas a branch atual o alterou.'
          : 'Não foi possível ler o arquivo.'
    return (
      <Modal title={`Conflito em ${path}`} onClose={onClose} size="medium">
        <p>{reason}</p>
        <div className="choice-list">
          <button className="choice" onClick={() => resolveWhole('ours')}>
            <strong>{details.ours === null ? 'Remover o arquivo' : 'Manter a versão atual (HEAD)'}</strong>
          </button>
          <button className="choice" onClick={() => resolveWhole('theirs')}>
            <strong>{details.theirs === null ? 'Remover o arquivo' : 'Manter a versão que entra'}</strong>
          </button>
          <button className="choice" onClick={() => window.gittools.openFile(path)}>
            <strong>Abrir no editor</strong>
            <span>Depois de editar, use “✓ Resolvido” no painel de conflitos.</span>
          </button>
        </div>
      </Modal>
    )
  }

  let conflictIndex = -1
  return (
    <Modal
      title={`Resolver conflito — ${path}`}
      onClose={onClose}
      size="large"
      footer={
        <>
          <span className="footer-summary">
            {conflicts.length === 0
              ? 'Não há marcadores de conflito no arquivo.'
              : `${resolvedCount} de ${conflicts.length} bloco(s) resolvido(s)`}
          </span>
          <button onClick={() => window.gittools.openFile(path)}>Abrir no editor</button>
          <button onClick={onClose}>Cancelar</button>
          <button className="primary" disabled={resolvedCount < conflicts.length} onClick={save}>
            Salvar e marcar como resolvido
          </button>
        </>
      }
    >
      <div className="merge-toolbar">
        <span className="muted">Resolver todos:</span>
        <button onClick={() => setResolutions(conflicts.map(() => ({ kind: 'ours' })))}>← Usar a atual</button>
        <button onClick={() => setResolutions(conflicts.map(() => ({ kind: 'theirs' })))}>Usar a que entra →</button>
        <button onClick={() => setResolutions(conflicts.map(() => ({ kind: 'ours-theirs' })))}>Manter as duas</button>
        <button className="link" onClick={() => setResolutions([])}>
          desfazer escolhas
        </button>
        <span className="toolbar-spacer" />
        <label className="checkbox">
          <input type="checkbox" checked={showFinal} onChange={(e) => setShowFinal(e.target.checked)} />
          Ver arquivo final
        </label>
      </div>

      {showFinal ? (
        <pre className="merge-final">{result}</pre>
      ) : (
        <div className="merge-grid">
          <div className="merge-head ours">Atual ({conflicts[0]?.oursLabel ?? 'HEAD'})</div>
          <div className="merge-head result">Resultado</div>
          <div className="merge-head theirs">Que entra ({conflicts[0]?.theirsLabel ?? ''})</div>
          {parsed.chunks.map((chunk, c) => {
            if (chunk.kind === 'common') {
              return <CommonChunk key={c} lines={chunk.lines} first={c === 0} last={c === parsed.chunks.length - 1} />
            }
            const index = ++conflictIndex
            return (
              <ConflictBlock
                key={c}
                index={index}
                total={conflicts.length}
                chunk={chunk}
                resolution={resolutions[index]}
                onResolve={(r) => setAt(index, r)}
              />
            )
          })}
        </div>
      )}
    </Modal>
  )
}

function CommonChunk({ lines, first, last }: { lines: string[]; first: boolean; last: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const head = first ? [] : lines.slice(0, CONTEXT)
  const tail = last ? [] : lines.slice(-CONTEXT)
  const hidden = lines.length - head.length - tail.length
  if (expanded || hidden <= 2) return <pre className="merge-common">{lines.join('\n')}</pre>
  return (
    <>
      {head.length > 0 && <pre className="merge-common">{head.join('\n')}</pre>}
      <button className="merge-fold" onClick={() => setExpanded(true)}>
        ⋯ {hidden} linha(s) iguais nas duas versões — clique para mostrar
      </button>
      {tail.length > 0 && <pre className="merge-common">{tail.join('\n')}</pre>}
    </>
  )
}

interface BlockProps {
  index: number
  total: number
  chunk: Conflict
  resolution: ChunkResolution | undefined
  onResolve(resolution: ChunkResolution | undefined): void
}

function ConflictBlock({ index, total, chunk, resolution, onResolve }: BlockProps) {
  const lines = resolveChunk(chunk, resolution)
  const is = (kind: ChunkResolution['kind']) => resolution?.kind === kind
  return (
    <>
      <div className="merge-block-bar">
        <strong>
          Conflito {index + 1} de {total}
        </strong>
        <button className={is('ours') ? 'active' : ''} onClick={() => onResolve({ kind: 'ours' })}>
          ← Usar a atual
        </button>
        <button className={is('ours-theirs') ? 'active' : ''} onClick={() => onResolve({ kind: 'ours-theirs' })}>
          Ambas (atual primeiro)
        </button>
        <button className={is('theirs-ours') ? 'active' : ''} onClick={() => onResolve({ kind: 'theirs-ours' })}>
          Ambas (que entra primeiro)
        </button>
        <button className={is('theirs') ? 'active' : ''} onClick={() => onResolve({ kind: 'theirs' })}>
          Usar a que entra →
        </button>
        {chunk.base && (
          <button className={is('base') ? 'active' : ''} onClick={() => onResolve({ kind: 'base' })} title="Versão do ancestral comum">
            Original
          </button>
        )}
        <button className={is('custom') && resolution?.kind === 'custom' && resolution.text === '' ? 'active' : ''} onClick={() => onResolve({ kind: 'custom', text: '' })}>
          Nenhuma
        </button>
        {resolution && (
          <button className="link" onClick={() => onResolve(undefined)}>
            limpar
          </button>
        )}
      </div>
      <pre className={`merge-side ours ${is('ours') || is('ours-theirs') || is('theirs-ours') ? 'chosen' : ''}`}>{chunk.ours.join('\n') || ' '}</pre>
      <textarea
        className={`merge-result ${resolution ? 'resolved' : 'pending'}`}
        value={lines ? lines.join('\n') : ''}
        placeholder="Escolha uma das versões acima ou digite o resultado aqui"
        rows={Math.max(3, chunk.ours.length, chunk.theirs.length, lines?.length ?? 0)}
        spellCheck={false}
        onChange={(e) => onResolve({ kind: 'custom', text: e.target.value })}
      />
      <pre className={`merge-side theirs ${is('theirs') || is('ours-theirs') || is('theirs-ours') ? 'chosen' : ''}`}>{chunk.theirs.join('\n') || ' '}</pre>
    </>
  )
}
