import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ConflictResolution } from '../../../shared/types'
import type { Settings } from '../../../shared/settings'
import { useAppActions, useAppSettings, useBusy, useRepoData } from '../context'
import { errorMessage } from '../format'
import { git } from '../git'
import { t } from '../i18n'
import { useResolveAll } from '../bulkConflicts'
import { rememberDecisions, reusePlan, shouldAutoContinue, type Decisions, type ReusePlan } from '../conflictFlow'

// Estado e ações do fluxo de conflitos, compartilhados pelo banner e pela tela Conflitos. Mora num provedor (e não
// no banner) porque o "continuar sozinho" precisa rodar com a tela fechada e porque as decisões lembradas valem
// para as duas telas. Fica no pacote inicial: mantenha-o pequeno e sem importar a tela (que é carregada sob demanda).

/** Quantos nomes de arquivo aparecem no resumo das decisões lembradas (o resto vira "+N"): o custo não cresce com o lote. */
export const REUSE_NAMES = 3

const NO_REUSE: ReusePlan = { ours: [], theirs: [] }
const NO_DECISIONS: Decisions = new Map()

/**
 * Pedido para a tela Conflitos selecionar um arquivo (vem de `openConflict`, por exemplo o clique numa lista de
 * mudanças). Cada pedido é um objeto novo: a tela guarda os que já aplicou pela identidade, então pedir o mesmo
 * arquivo duas vezes funciona e reabrir a tela não repete um pedido antigo.
 */
export interface ConflictFocus {
  path: string
}

export interface ConflictFlowValue {
  /** Último pedido para selecionar um arquivo na tela Conflitos (null = nenhum). */
  focus: ConflictFocus | null
  /** Escolhas "nosso"/"deles" lembradas nesta operação (vazio sem operação). */
  decisions: Decisions
  /** Das decisões lembradas, as que valem para os arquivos em conflito desta parada. */
  plan: ReusePlan
  /** O usuário dispensou a linha de reaproveitar nesta parada. */
  reuseIgnored: boolean
  /** A opção "Continuar automaticamente" está ligada. */
  autoContinue: boolean
  continueOperation(): Promise<void>
  abort(): Promise<void>
  skip(): Promise<void>
  resolve(path: string, resolution: ConflictResolution): Promise<void>
  resolveEvery(resolution: ConflictResolution): Promise<void>
  applyReuse(): Promise<void>
  ignoreReuse(): void
  /** Liga ou desliga "Continuar automaticamente" (grava nas configurações). */
  setAutoContinue(enabled: boolean): void
}

const ConflictFlowContext = createContext<ConflictFlowValue | null>(null)

/** Lança erro fora do provedor. O valor só muda quando algo relevante para quem o lê muda. */
export function useConflictFlow(): ConflictFlowValue {
  const value = useContext(ConflictFlowContext)
  if (!value) throw new Error('useConflictFlow fora do provedor')
  return value
}

export function ConflictFlowProvider({
  onSaveSettings,
  focus,
  children
}: {
  onSaveSettings(next: Settings): Promise<void>
  focus: ConflictFocus | null
  children: ReactNode
}) {
  const { repo, data } = useRepoData()
  const { run, confirm, toast } = useAppActions()
  // Operação em andamento: continuar e pular sozinhos não disparam outra enquanto a primeira não termina.
  const { busy } = useBusy()
  const { settings } = useAppSettings()
  const resolveAll = useResolveAll()
  const { operation, status } = data
  const conflicts = status.conflicted
  const kind = operation.kind
  const root = repo.root
  const autoContinue = settings.autoContinueConflicts

  // Contagem de conflitos da leitura anterior, por repositório: trocar de aba não pode parecer "resolvi tudo".
  const seen = useRef({ root, count: conflicts.length })
  // Escolhas "nosso"/"deles" do usuário nesta operação. Ref, porque só quem mostra o resumo as lê, e `version`
  // avisa o React quando elas mudam (a ref sozinha não redesenha).
  const decisionsRef = useRef<Decisions>(new Map())
  const [version, setVersion] = useState(0)
  // Parada (commit/passo) cuja linha de reaproveitar o usuário dispensou.
  const [ignoredStop, setIgnoredStop] = useState<string | null>(null)

  // Valores lidos no momento da chamada: as ações abaixo ficam estáveis e o valor do contexto não muda à toa.
  const latest = useRef({ conflicts, kind, resolveAll, settings, onSaveSettings })
  latest.current = { conflicts, kind, resolveAll, settings, onSaveSettings }

  const remember = useCallback((resolutions: { path: string; side: ConflictResolution }[]) => {
    decisionsRef.current = rememberDecisions(decisionsRef.current, resolutions)
    setVersion((v) => v + 1)
  }, [])

  // Continuar sozinho: só a transição "tinha conflito → não tem mais", vista depois que a operação anterior
  // terminou. Sem leitura extra do git: o dado é o mesmo que a tela já recebe, e o `continue` devolve o novo estado.
  useEffect(() => {
    const count = conflicts.length
    const last = seen.current
    if (last.root !== root) {
      // Outro repositório: o que foi lembrado e contado era do anterior.
      decisionsRef.current = new Map()
      seen.current = { root, count }
      return
    }
    if (kind === 'none') {
      decisionsRef.current = new Map()
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
    () => (kind === 'none' || decisionsRef.current.size === 0 ? NO_REUSE : reusePlan(conflicts.map((f) => f.path), decisionsRef.current)),
    // `version` entra porque `decisions` é uma ref: ela muda sem redesenhar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conflicts, kind, version]
  )
  // Sem operação o efeito acima zera a memória; aqui o valor já nasce vazio, sem esperar outro desenho.
  const decisions = useMemo(
    () => (kind === 'none' ? NO_DECISIONS : decisionsRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, version]
  )
  const reuseIgnored = ignoredStop === stopKey
  // A dispensa vale para a parada atual: `stopKey` por ref para `ignoreReuse` ficar estável.
  const stopKeyRef = useRef(stopKey)
  stopKeyRef.current = stopKey
  const planRef = useRef(plan)
  planRef.current = plan

  const actions = useMemo(() => {
    const abort = async () => {
      const none = latest.current.kind === 'none'
      const ok = await confirm({
        title: t('operation.abort'),
        message: none ? t('operation.abortFilesMessage') : t('operation.abortMessage'),
        confirmLabel: t('operation.abort'),
        danger: true
      })
      if (ok) await run(t('busy.aborting'), () => git.abortOperation())
    }

    const continueOperation = async () => {
      await run(t('busy.continuing'), () => git.continueOperation())
    }

    const resolve = async (path: string, resolution: ConflictResolution) => {
      // Só lembra a escolha se a resolução deu certo: `run` devolve undefined quando o git falha.
      const ok = await run(t('busy.resolving'), async () => {
        await git.resolveConflict(path, resolution)
        return true
      })
      if (ok) remember([{ path, side: resolution }])
    }

    // O lote ("Resolver todos") também alimenta a memória: lembra o que de fato foi resolvido, sem os que falharam.
    const resolveEvery = async (resolution: ConflictResolution) => {
      const paths = latest.current.conflicts.map((f) => f.path)
      const result = await latest.current.resolveAll(resolution)
      if (!result || resolution === 'resolved') return
      const failed = new Set(result.failed.map((f) => f.path))
      remember(paths.filter((path) => !failed.has(path)).map((path) => ({ path, side: resolution })))
    }

    // Aplica as decisões lembradas numa só operação (uma releitura no fim), um lote por lado.
    const applyReuse = async () => {
      const current = planRef.current
      const result = await run(t('busy.resolving'), async () => {
        const failed: { path: string; message: string }[] = []
        let resolved = 0
        for (const side of ['ours', 'theirs'] as const) {
          if (current[side].length === 0) continue
          const part = await git.resolveConflicts(current[side], side)
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
    const skip = async () => {
      seen.current = { root, count: 0 }
      await run(t('busy.skipping'), () => git.skipOperation())
    }

    const ignoreReuse = () => setIgnoredStop(stopKeyRef.current)

    const setAutoContinue = (enabled: boolean) => {
      const { settings: current, onSaveSettings: save } = latest.current
      save({ ...current, autoContinueConflicts: enabled }).catch((error) => toast('error', errorMessage(error)))
    }

    return { continueOperation, abort, skip, resolve, resolveEvery, applyReuse, ignoreReuse, setAutoContinue }
  }, [run, confirm, toast, remember, root])

  const value = useMemo<ConflictFlowValue>(
    () => ({ focus, decisions, plan, reuseIgnored, autoContinue, ...actions }),
    [focus, decisions, plan, reuseIgnored, autoContinue, actions]
  )

  return <ConflictFlowContext.Provider value={value}>{children}</ConflictFlowContext.Provider>
}
