import { useEffect, useState } from 'react'
import type { RebaseAction, RebasePlan } from '../../../shared/types'
import { useApp } from '../context'
import { errorMessage, plural, relativeDate, shortSha } from '../format'
import { git } from '../git'
import { Modal } from './Modal'

interface Row {
  sha: string
  subject: string
  author: string
  date: number
  action: RebaseAction
  message: string
}

const ACTIONS: { id: RebaseAction; label: string; help: string }[] = [
  { id: 'pick', label: 'Manter', help: 'Mantém o commit como está.' },
  { id: 'reword', label: 'Editar mensagem', help: 'Mantém as alterações e troca a mensagem.' },
  { id: 'squash', label: 'Juntar ao anterior', help: 'Junta ao commit de cima, combinando as mensagens (ou usando a que você escrever).' },
  { id: 'fixup', label: 'Juntar (descartar mensagem)', help: 'Junta ao commit de cima e descarta a mensagem deste.' },
  { id: 'drop', label: 'Remover', help: 'Remove o commit do histórico.' }
]

/** Rebase interativo visual: arraste para reordenar e escolha o que fazer com cada commit. */
export function RebaseEditor({ fromSha, onClose }: { fromSha: string; onClose(): void }) {
  const { run, toast, data } = useApp()
  const [plan, setPlan] = useState<RebasePlan | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [dragging, setDragging] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  useEffect(() => {
    git.rebasePlan(fromSha).then(
      (p) => {
        setPlan(p)
        setRows(p.commits.map((c) => ({ sha: c.sha, subject: c.subject, author: c.author, date: c.date, action: 'pick', message: '' })))
      },
      (e) => {
        toast('error', errorMessage(e))
        onClose()
      }
    )
  }, [fromSha, toast, onClose])

  const update = (index: number, patch: Partial<Row>) => setRows(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)))

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= rows.length) return
    const next = [...rows]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    setRows(next)
  }

  const kept = rows.filter((r) => r.action !== 'drop')
  const firstKept = kept[0]
  const invalid = firstKept && (firstKept.action === 'squash' || firstKept.action === 'fixup')
  const resulting = kept.filter((r) => r.action !== 'squash' && r.action !== 'fixup').length
  const changed = rows.some((r, i) => r.action !== 'pick' || r.sha !== plan?.commits[i]?.sha)

  const apply = async () => {
    if (!plan) return
    const result = await run('Reescrevendo histórico', () =>
      git.interactiveRebase(
        plan.base,
        rows.map((r) => ({
          sha: r.sha,
          action: r.action,
          message: r.action === 'reword' || r.action === 'squash' ? r.message || undefined : undefined
        }))
      )
    )
    if (result) onClose()
  }

  return (
    <Modal
      title={`✎ Rebase interativo — ${data.status.branch ?? ''}`}
      onClose={onClose}
      size="large"
      footer={
        <>
          <span className="footer-summary">
            {invalid
              ? 'O primeiro commit mantido não pode ser juntado a um anterior.'
              : plan
                ? `${plural(rows.length, 'commit', 'commits')} → ${plural(resulting, 'commit', 'commits')} depois do rebase`
                : ''}
          </span>
          <button onClick={onClose}>Cancelar</button>
          <button className="primary" disabled={!plan || !changed || !!invalid} onClick={apply}>
            Reescrever histórico
          </button>
        </>
      }
    >
      {!plan ? (
        <p className="empty">
          <span className="spinner" /> Carregando commits…
        </p>
      ) : (
        <>
          <p className="muted">
            Arraste as linhas para mudar a ordem (de cima = mais antigo, para baixo = mais novo). Os commits a partir de{' '}
            <code>{plan.base ? shortSha(plan.base) : 'o início'}</code> serão recriados.
            {data.branches.some((b) => b.current && b.upstream) && ' Se a branch já foi enviada (push), será preciso forçar o próximo push.'}
          </p>
          {plan.hasMerges && <p className="warning-text">Atenção: há commits de merge neste trecho; eles não aparecem na lista e o histórico ficará linear.</p>}
          <ol className="rebase-list">
            {rows.map((row, i) => (
              <li
                key={row.sha}
                className={`rebase-row action-${row.action} ${dragging === i ? 'dragging' : ''} ${overIndex === i && dragging !== null && dragging !== i ? 'drop-target' : ''}`}
                draggable
                onDragStart={(e) => {
                  setDragging(i)
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', row.sha)
                }}
                onDragOver={(e) => {
                  if (dragging === null) return
                  e.preventDefault()
                  setOverIndex(i)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  if (dragging !== null) move(dragging, i)
                  setDragging(null)
                  setOverIndex(null)
                }}
                onDragEnd={() => {
                  setDragging(null)
                  setOverIndex(null)
                }}
              >
                <span className="drag-handle" title="Arraste para reordenar">
                  ⠿
                </span>
                <span className="rebase-move">
                  <button className="icon-button" disabled={i === 0} onClick={() => move(i, i - 1)} title="Subir">
                    ▲
                  </button>
                  <button className="icon-button" disabled={i === rows.length - 1} onClick={() => move(i, i + 1)} title="Descer">
                    ▼
                  </button>
                </span>
                <select
                  value={row.action}
                  onChange={(e) => {
                    const action = e.target.value as RebaseAction
                    update(i, { action, message: action === 'reword' && !row.message ? row.subject : row.message })
                  }}
                  title={ACTIONS.find((a) => a.id === row.action)!.help}
                >
                  {ACTIONS.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
                <code>{shortSha(row.sha)}</code>
                <div className="rebase-text">
                  {(row.action === 'squash' || row.action === 'fixup') && <span className="muted">↳ junta ao de cima · </span>}
                  {row.action === 'reword' || row.action === 'squash' ? (
                    <textarea
                      rows={row.action === 'reword' ? 2 : 1}
                      value={row.message}
                      placeholder={row.action === 'squash' ? `${row.subject} — deixe vazio para combinar as mensagens` : row.subject}
                      onChange={(e) => update(i, { message: e.target.value })}
                    />
                  ) : (
                    <span className="commit-subject">{row.subject}</span>
                  )}
                </div>
                <small className="muted">
                  {row.author} · {relativeDate(row.date)}
                </small>
              </li>
            ))}
          </ol>
        </>
      )}
    </Modal>
  )
}
