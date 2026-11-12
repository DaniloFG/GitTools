import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppActions, useAppSettings, useBusy, useRepoData } from '../context'
import { git } from '../git'
import { shortSha } from '../format'
import { t, type MessageKey } from '../i18n'
import { BULK_RESOLUTIONS, bulkHelp, bulkLabel, useResolveAll } from '../bulkConflicts'
import { rememberDecisions, reusePlan, shouldAutoContinue, type Decisions, type ReusePlan } from '../conflictFlow'

const LABEL: Record<'merge' | 'cherry-pick' | 'revert' | 'rebase', MessageKey> = {
  merge: 'operation.merge',
  'cherry-pick': 'operation.cherryPick',
  revert: 'operation.revert',
  rebase: 'operation.rebase'
}

/** Quantos nomes de arquivo aparecem no resumo das decisões lembradas (o resto vira "+N"): o custo não cresce com o lote. */
const REUSE_NAMES = 3

const NO_REUSE: ReusePlan = { ours: [], theirs: [] }

/** Acima deste número de arquivos em conflito aparece o campo de filtro por nome. */
const FILTER_FROM = 8

export function OperationBanner({ onShowChanges }: { onShowChanges(): void }) {
  const { repo, data } = useRepoData()
  const { run, confirm, toast, openConflict, openInEditor } = useAppActions()
  // Operação em andamento: abortar, continuar e pular não disparam outra enquanto a primeira não termina.
  const { busy } = useBusy()
  const { settings } = useAppSettings()
  const resolveAll = useResolveAll()
  const [filter, setFilter] = useState('')
  const { operation, status } = data
  const conflicts = status.conflicted
  const kind = operation.kind
  const root = repo.root
  const autoContinue = settings.autoContinueConflicts

  // Contagem de conflitos da leitura anterior, por repositório: trocar de aba não pode parecer "resolvi tudo".
  const seen = useRef({ root, count: conflicts.length })
  // Escolhas "nosso"/"deles" do usuário nesta operação. Ref, porque só a linha de reaproveitar as lê, e `version`
  // avisa o React quando elas mudam (a ref sozinha não redesenha).
  const decisions = useRef<Decisions>(new Map())
  const [version, setVersion] = useState(0)
  // Parada (commit/passo) cuja linha de reaproveitar o usuário dispensou.
  const [ignoredStop, setIgnoredStop] = useState<string | null>(null)

  const remember = (resolutions: { path: string; side: 'ours' | 'theirs' | 'resolved' }[]) => {
    decisions.current = rememberDecisions(decisions.current, resolutions)
    setVersion((v) => v + 1)
  }

  // Continuar sozinho: só a transição "tinha conflito → não tem mais", vista depois que a operação anterior
  // terminou. Sem leitura extra do git: o dado é o mesmo que a tela já recebe, e o `continue` devolve o novo estado.
  useEffect(() => {
    const count = conflicts.length
    const last = seen.current
    if (last.root !== root) {
      // Outro repositório: o que foi lembrado e contado era do anterior.
      decisions.current = new Map()
      seen.current = { root, count }
      return
    }
    if (kind === 'none') {
      decisions.current = new Map()
      seen.current = { root, count }
      return
    }
    if (shouldAutoContinue({ enabled: autoContinue, kind, prevConflicts: last.count, conflicts: count, busy })) {
      // Gravar a contagem nova antes de disparar é a guarda contra disparo duplo (StrictMode, nova renderização
      // antes de `busy` mudar): a próxima passada vê 0 → 0 e não continua de novo.
      seen.current = { root, count }
      void run(t('busy.continuing'), () => git.continueOperation())
      return
    }
    // Com outra operação em andamento a contagem fica como estava: o fim dela pode trazer o 1 → 0 que queremos ver.
    if (!busy) seen.current = { root, count }
  }, [root, kind, conflicts.length, autoContinue, busy, run])

  const stopKey = `${operation.head ?? ''}|${operation.step ?? ''}`
  const plan = useMemo(
    () => (kind === 'none' || decisions.current.size === 0 ? NO_REUSE : reusePlan(conflicts.map((f) => f.path), decisions.current)),
    // `version` entra porque `decisions` é uma ref: ela muda sem redesenhar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conflicts, kind, version]
  )

  if (kind === 'none' && conflicts.length === 0) return null

  const title =
    operation.kind === 'none'
      ? t('operation.conflictedFiles')
      : `${t(LABEL[operation.kind])}${operation.head ? ` — ${shortSha(operation.head)}` : ''}${
          operation.step ? ` ${t('operation.step', { step: operation.step, total: operation.total ?? 0 })}` : ''
        }`

  const abort = async () => {
    const ok = await confirm({
      title: t('operation.abort'),
      message: operation.kind === 'none' ? t('operation.abortFilesMessage') : t('operation.abortMessage'),
      confirmLabel: t('operation.abort'),
      danger: true
    })
    if (ok) await run(t('busy.aborting'), () => git.abortOperation())
  }

  const resolve = (path: string, resolution: 'ours' | 'theirs' | 'resolved') => {
    remember([{ path, side: resolution }])
    return run(t('busy.resolving'), () => git.resolveConflict(path, resolution))
  }

  // O lote ("Resolver todos") também alimenta a memória: lembra o que de fato foi resolvido, sem os que falharam.
  const resolveEvery = async (resolution: 'ours' | 'theirs' | 'resolved') => {
    const paths = conflicts.map((f) => f.path)
    const result = await resolveAll(resolution)
    if (!result || resolution === 'resolved') return
    const failed = new Set(result.failed.map((f) => f.path))
    remember(paths.filter((path) => !failed.has(path)).map((path) => ({ path, side: resolution })))
  }

  // Aplica as decisões lembradas numa só operação (uma releitura no fim), um lote por lado.
  const applyReuse = async () => {
    const result = await run(t('busy.resolving'), async () => {
      const failed: { path: string; message: string }[] = []
      let resolved = 0
      for (const side of ['ours', 'theirs'] as const) {
        if (plan[side].length === 0) continue
        const part = await git.resolveConflicts(plan[side], side)
        resolved += part.resolved
        failed.push(...part.failed)
      }
      return { resolved, failed }
    })
    if (!result) return
    if (result.failed.length === 0) toast('success', t('conflictBulk.done', { count: result.resolved }))
    else {
      const names = result.failed.map((f) => f.path)
      const list = names.slice(0, REUSE_NAMES).join(', ') + (names.length > REUSE_NAMES ? ' …' : '')
      toast('warning', t('conflictBulk.partial', { resolved: result.resolved, failed: names.length, list }))
    }
  }

  // Pular o commit não é "resolver o último conflito": a próxima parada limpa não continua sozinha.
  const skip = () => {
    seen.current = { root, count: 0 }
    return run(t('busy.skipping'), () => git.skipOperation())
  }

  const reuseTotal = plan.ours.length + plan.theirs.length
  const reuseNames = [...plan.ours, ...plan.theirs]
  const reuseFiles = reuseNames.slice(0, REUSE_NAMES).join(', ') + (reuseNames.length > REUSE_NAMES ? ` +${reuseNames.length - REUSE_NAMES}` : '')
  const reuseText =
    plan.ours.length > 0 && plan.theirs.length > 0
      ? t('operation.reuseBoth', { ours: plan.ours.length, theirs: plan.theirs.length, files: reuseFiles })
      : plan.ours.length > 0
        ? t('operation.reuseOurs', { count: plan.ours.length, files: reuseFiles })
        : t('operation.reuseTheirs', { count: plan.theirs.length, files: reuseFiles })

  const needle = filter.trim().toLowerCase()
  const shown = needle ? conflicts.filter((f) => f.path.toLowerCase().includes(needle)) : conflicts

  return (
    <div className={`operation-banner ${conflicts.length ? 'has-conflicts' : ''}`}>
      <div className="operation-title">
        <strong>{title}</strong>
        <span className="muted">
          {conflicts.length ? t('operation.conflictsHelp', { count: conflicts.length }) : t('operation.noConflicts')}
        </span>
      </div>
      {conflicts.length > 0 && (
        <div className="conflict-panel">
          {reuseTotal > 0 && ignoredStop !== stopKey && (
            <div className="conflict-tools">
              <span className="small">{reuseText}</span>
              <button className="primary" disabled={busy !== null} onClick={applyReuse}>
                {t('operation.reuseApply')}
              </button>
              <button onClick={() => setIgnoredStop(stopKey)}>{t('operation.reuseIgnore')}</button>
            </div>
          )}
          <div className="conflict-tools">
            {conflicts.length > FILTER_FROM && (
              <>
                <input
                  type="search"
                  className="conflict-filter"
                  value={filter}
                  placeholder={t('conflictBulk.filterPlaceholder')}
                  aria-label={t('conflictBulk.filterLabel')}
                  onChange={(e) => setFilter(e.target.value)}
                />
                {needle && <span className="muted small">{t('conflictBulk.showing', { shown: shown.length, count: conflicts.length })}</span>}
              </>
            )}
            <div className="conflict-bulk" role="group" aria-label={t('conflictBulk.title')}>
              <span className="muted small">{t('conflictBulk.resolveAllLabel')}</span>
              {BULK_RESOLUTIONS.map((resolution) => (
                <button key={resolution} title={t(bulkHelp(resolution))} onClick={() => resolveEvery(resolution)}>
                  {t(bulkLabel(resolution))}
                </button>
              ))}
            </div>
          </div>
          <ul className="conflict-list">
            {shown.map((f) => (
              <li key={f.path}>
                <span className="conflict-path">{f.path}</span>
                <button className="primary" onClick={() => openConflict(f.path)} title={t('operation.sideBySideHelp')}>
                  {t('operation.sideBySide')}
                </button>
                <button onClick={() => openInEditor(f.path)}>{t('common.openInEditor')}</button>
                <button onClick={() => resolve(f.path, 'ours')} title={t('operation.useOursHelp')}>
                  {t('conflict.useOurs')}
                </button>
                <button onClick={() => resolve(f.path, 'theirs')} title={t('operation.useTheirsHelp')}>
                  {t('conflict.useTheirs')}
                </button>
                <button onClick={() => resolve(f.path, 'resolved')} title={t('operation.resolvedHelp')}>
                  ✓ {t('operation.resolved')}
                </button>
              </li>
            ))}
            {shown.length === 0 && <li className="muted small">{t('conflictBulk.noMatch')}</li>}
          </ul>
        </div>
      )}
      <div className="operation-actions">
        {operation.kind !== 'none' ? (
          <>
            <button
              className="primary"
              disabled={conflicts.length > 0 || busy !== null}
              title={conflicts.length > 0 ? t('feedback.blocked.conflicts') : undefined}
              onClick={() => run(t('busy.continuing'), () => git.continueOperation())}
            >
              {t('operation.continue')}
            </button>
            {operation.kind !== 'merge' && (
              <button disabled={busy !== null} onClick={skip}>{t('operation.skip')}</button>
            )}
          </>
        ) : (
          <button onClick={onShowChanges}>{t('operation.showChanges')}</button>
        )}
        <button className="danger" disabled={busy !== null} onClick={abort}>
          {t('operation.abort')}
        </button>
      </div>
    </div>
  )
}
