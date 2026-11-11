import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { DIFF_MAX_BYTES, type DiffLine, type FileDiff, type LineKey } from '../../../shared/types'
import { changeKeys, hunkKeys, lineKey } from '../../../shared/diffKeys'
import { DEFAULT_SETTINGS, type DiffLayout } from '../../../shared/settings'
import { AppActionsContext, AppSettingsContext } from '../context'
import { copyAndNotify, copyItemsAt, selectionText } from '../copy'
import { diffLinesText, markedDiffLines } from '../copyText'
import { stepIndex, useDiffNav } from '../diffNav'
import { t, type MessageKey } from '../i18n'
import { useLayout } from '../layout'
import { displayCombo, resolveBindings } from '../shortcuts'
import type { MenuItem } from './ContextMenu'
import { ChangeRuler } from './ChangeRuler'
import { VirtualList, type VirtualListHandle } from './VirtualList'
import { diffViewGroups, ViewOptionsButton } from './ViewOptions'
import { allowFullDiff } from '../diffLimit'
import { BLOCK_ROWS, buildRows, changeBlocks, chunkRows, rowKeys, rowKind, type DiffRow } from '../diffBlocks'
import { marksFromRows, type RulerIndexRow } from '../changeRuler'

/**
 * Escolha entre "cima e baixo" e "lado a lado": todo diff abre no modo padrão das configurações;
 * os botões do cabeçalho trocam o modo só enquanto o diff está aberto.
 */
export function useDiffLayout(): [DiffLayout, (layout: DiffLayout) => void] {
  const preferred = useContext(AppSettingsContext)?.settings.diffLayout ?? DEFAULT_SETTINGS.diffLayout
  const [override, setOverride] = useState<{ preferred: DiffLayout; layout: DiffLayout } | null>(null)
  // Se o padrão mudar nas configurações, a escolha temporária deixa de valer.
  const layout = override && override.preferred === preferred ? override.layout : preferred
  return [layout, (next) => setOverride({ preferred, layout: next })]
}

/**
 * Mostrar o arquivo inteiro (todo o contexto) em vez de só os trechos alterados. O padrão vem das
 * configurações (Editor e diff); o botão do cabeçalho do diff troca para todos os diffs e a escolha fica
 * guardada até o padrão das configurações mudar. Quem busca o diff a inclui no pedido (`fullFile`).
 */
export function useFullFile(): [boolean, (full: boolean) => void] {
  const preferred = useContext(AppSettingsContext)?.settings.diffFullFile ?? DEFAULT_SETTINGS.diffFullFile
  const [override, setOverride] = useLayout<{ preferred: boolean; full: boolean } | undefined>('diff.fullFile', parseFullFileOverride)
  // Se o padrão mudar nas configurações, a escolha temporária deixa de valer.
  const full = override && override.preferred === preferred ? override.full : preferred
  return [full, (next) => setOverride(next === preferred ? undefined : { preferred, full: next })]
}

function parseFullFileOverride(value: unknown): { preferred: boolean; full: boolean } | undefined {
  const raw = value as { preferred?: unknown; full?: unknown } | null
  return raw && typeof raw === 'object' && typeof raw.preferred === 'boolean' && typeof raw.full === 'boolean' ? { preferred: raw.preferred, full: raw.full } : undefined
}

interface Props {
  file: FileDiff
  /** Quando informado, as linhas alteradas podem ser selecionadas. */
  selection?: Set<LineKey>
  onSelectionChange?(selection: Set<LineKey>): void
  /** Quando há uma lista de arquivos ao lado: posição do arquivo e como ir para o anterior/próximo. */
  fileNav?: { index: number; count: number; go(delta: 1 | -1): void }
}

/** Teclas atuais de uma ação (as personalizadas das configurações, se houver). */
function useShortcutOf(): (action: string) => string {
  const overrides = useContext(AppSettingsContext)?.settings.shortcuts
  return (action) => displayCombo(resolveBindings(overrides ?? {})[action])
}

/**
 * Quantos dígitos cabem no maior número de linha do arquivo. Olha só os cabeçalhos dos hunks, para a largura
 * das colunas de número ser fixa (layout fixo da tabela) sem percorrer as linhas.
 */
function lineNumberDigits(hunks: FileDiff['hunks']): number {
  let max = 0
  for (const h of hunks) max = Math.max(max, h.oldStart + h.oldCount, h.newStart + h.newCount)
  return String(max).length
}

const TYPE_LABEL: Record<FileDiff['changeType'], MessageKey> = {
  added: 'status.untracked',
  deleted: 'status.deleted',
  modified: 'status.modified',
  renamed: 'status.renamed',
  copied: 'status.copied'
}

/** Altura estimada de um bloco. As linhas têm 18 px, mas o código quebra linha: por isso todo bloco é medido. */
const BLOCK_HEIGHT = BLOCK_ROWS * 18
/** Margem montada acima e abaixo da tela: rolar não mostra espaço em branco. */
const OVERSCAN = 800
/** Limite de linhas que a navegação realça (cada uma é uma consulta ao DOM). */
const NAV_FLASH_MAX = 200
/** Todo bloco é de altura variável (ver BLOCK_HEIGHT). Constante de módulo: a identidade não muda. */
const alwaysVariable = () => true

/** Cada arquivo e cada modo ganham chaves de bloco novas, para as alturas medidas não valerem para outro diff. */
let diffEpoch = 0

/**
 * Estado que o bloco lê no momento do desenho e dos eventos. Os manipuladores e a seleção ficam numa ref,
 * atualizada a cada desenho do diff: um bloco memorizado não precisa ser refeito para ver a seleção nova.
 */
interface Live {
  selection: Set<LineKey> | undefined
  selectable: boolean
  /** Por hunk: quantas linhas alteradas estão marcadas, e quantas linhas alteradas ele tem. */
  hunkSelected: number[]
  hunkChanged: number[]
  lineDown(e: React.MouseEvent, key: LineKey): void
  lineEnter(key: LineKey): void
  codeDown(e: React.MouseEvent): void
  codeClick(e: React.MouseEvent, key: LineKey): void
  toggleHunk(hunk: number, checked: boolean): void
}

interface BlockProps {
  file: FileDiff
  rows: readonly DiffRow[]
  start: number
  end: number
  layout: DiffLayout
  /**
   * Estado de seleção que este bloco desenha (ver blockSig). Quando não muda, o bloco não é refeito, mesmo que
   * a seleção inteira tenha mudado. Não é lido no corpo: a comparação do memo é que importa.
   */
  sig: string
  live: RefObject<Live | null>
}

/**
 * Assinatura do que o bloco mostra da seleção: uma letra por cabeçalho (nenhuma, parte ou todas as linhas do hunk)
 * e um dígito por lado alterado de cada linha (1 marcado, 0 não). Quase não custa: 40 linhas por bloco.
 */
function blockSig(
  file: FileDiff,
  rows: readonly DiffRow[],
  start: number,
  end: number,
  selection: Set<LineKey> | undefined,
  selectable: boolean,
  hunkSelected: readonly number[],
  hunkChanged: readonly number[]
): string {
  if (!selectable) return 'N'
  let sig = 'S'
  for (let i = start; i < end; i++) {
    const row = rows[i]
    if (row.kind === 'hunk') {
      const picked = hunkSelected[row.hunk]
      sig += picked === 0 ? 'n' : picked === hunkChanged[row.hunk] ? 'a' : 'p'
    } else {
      for (const key of rowKeys(file, row)) sig += selection?.has(key) ? '1' : '0'
    }
  }
  return sig
}

/** Um bloco de linhas do diff: uma tabela própria, com o mesmo layout de colunas das demais (ver --ln-digits). */
const DiffBlock = memo(function DiffBlock({ file, rows, start, end, layout, live }: BlockProps) {
  const cur = live.current
  if (!cur) return null
  const { selection, selectable } = cur
  const split = layout === 'split'

  /** Um lado da linha lado a lado (índice nulo = célula vazia). */
  const side = (h: number, index: number | null, which: 'old' | 'new') => {
    const hunk = file.hunks[h]
    const half = which === 'new' ? 'half' : ''
    if (index === null) return <td colSpan={3} className={`cell-empty ${half}`} />
    const line: DiffLine = hunk.lines[index]
    const key = lineKey(h, index)
    const change = line.kind !== 'context'
    const isSelected = change && selection?.has(key)
    const cls = `cell-${line.kind} ${isSelected ? 'line-selected' : ''}`
    // Os manipuladores são lidos da ref no momento do evento: o bloco pode ter sido desenhado com uma seleção antiga.
    const gutter = change ? { onMouseDown: (e: React.MouseEvent) => live.current?.lineDown(e, key), onMouseEnter: () => live.current?.lineEnter(key) } : {}
    const code = change
      ? { onMouseDown: (e: React.MouseEvent) => live.current?.codeDown(e), onClick: (e: React.MouseEvent) => live.current?.codeClick(e, key), onMouseEnter: () => live.current?.lineEnter(key) }
      : { onMouseDown: (e: React.MouseEvent) => live.current?.codeDown(e) }
    return (
      <>
        <td className={`sel ${half} ${cls}`} {...gutter}>
          {selectable && change && <span className={`tick ${isSelected ? 'on' : ''}`} />}
        </td>
        <td className={`ln ${cls}`} {...gutter}>
          {(which === 'old' ? line.oldLine : line.newLine) ?? ''}
        </td>
        <td className={`code ${cls}`} tabIndex={-1} data-copy={line.content || undefined} data-copy-what="line" {...code}>
          {line.content}
          {line.noNewline && <span className="no-newline" title={t('diff.noNewline')}>⏎̸</span>}
        </td>
      </>
    )
  }

  /** Cabeçalho do hunk, com a caixa que marca o hunk inteiro. `cols` é o colSpan do texto. */
  const hunkHeader = (r: number, h: number, cols: number) => {
    const hunk = file.hunks[h]
    const picked = cur.hunkSelected[h]
    const hunkAll = selectable && picked === cur.hunkChanged[h]
    return (
      <tr key={r} className="hunk-header" data-row={r}>
        <td className="sel">
          {selectable && (
            <input
              type="checkbox"
              checked={hunkAll}
              ref={(el) => {
                if (el) el.indeterminate = !hunkAll && picked > 0
              }}
              onChange={(e) => live.current?.toggleHunk(h, e.target.checked)}
              title={t('diff.selectHunk')}
            />
          )}
        </td>
        <td colSpan={cols}>
          @@ −{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@ <span className="muted">{hunk.section}</span>
        </td>
      </tr>
    )
  }

  const body: React.ReactNode[] = []
  for (let r = start; r < end; r++) {
    const row = rows[r]
    if (row.kind === 'hunk') {
      body.push(hunkHeader(r, row.hunk, split ? 5 : 4))
    } else if (row.kind === 'split') {
      const kind = rowKind(file, row)
      body.push(
        <tr key={r} data-row={r} className="line" data-change={kind !== null || undefined} data-kind={kind ?? undefined}>
          {side(row.hunk, row.left, 'old')}
          {side(row.hunk, row.right, 'new')}
        </tr>
      )
    } else {
      const line = file.hunks[row.hunk].lines[row.line]
      const key = lineKey(row.hunk, row.line)
      const change = line.kind !== 'context'
      const isSelected = change && selection?.has(key)
      body.push(
        <tr
          key={r}
          data-row={r}
          className={`line line-${line.kind} ${isSelected ? 'line-selected' : ''}`}
          data-change={change || undefined}
          data-kind={change ? line.kind : undefined}
          onMouseEnter={change ? () => live.current?.lineEnter(key) : undefined}
        >
          <td className="sel" onMouseDown={change ? (e) => live.current?.lineDown(e, key) : undefined}>
            {selectable && change && <span className={`tick ${isSelected ? 'on' : ''}`} />}
          </td>
          <td className="ln" onMouseDown={change ? (e) => live.current?.lineDown(e, key) : undefined}>
            {line.oldLine ?? ''}
          </td>
          <td className="ln" onMouseDown={change ? (e) => live.current?.lineDown(e, key) : undefined}>
            {line.newLine ?? ''}
          </td>
          <td className="sign" onMouseDown={change ? (e) => live.current?.lineDown(e, key) : undefined}>
            {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ''}
          </td>
          <td className="code" tabIndex={-1} data-copy={line.content || undefined} data-copy-what="line" onMouseDown={(e) => live.current?.codeDown(e)} onClick={change ? (e) => live.current?.codeClick(e, key) : undefined}>
            {line.content}
            {line.noNewline && <span className="no-newline" title={t('diff.noNewline')}>⏎̸</span>}
          </td>
        </tr>
      )
    }
  }

  // Layout fixo, com as mesmas larguras em todos os blocos: as colunas ficam alinhadas entre as tabelas.
  return (
    <table className={`diff-table ${split ? 'diff-split' : ''} ${selectable ? 'selectable' : ''}`}>
      {split ? (
        <colgroup>
          <col className="sel" />
          <col className="ln" />
          <col />
          <col className="sel" />
          <col className="ln" />
          <col />
        </colgroup>
      ) : (
        <colgroup>
          <col className="sel" />
          <col className="ln" />
          <col className="ln" />
          <col className="sign" />
          <col />
        </colgroup>
      )}
      <tbody>{body}</tbody>
    </table>
  )
})

/**
 * Exibe o diff de um arquivo. Com seleção ativa: clique numa linha para marcar/desmarcar,
 * arraste o mouse para marcar várias, Shift+clique para marcar um intervalo, ou use a
 * caixa do bloco (hunk) para marcá-lo inteiro.
 *
 * O corpo é uma lista em janela de blocos (BLOCK_ROWS linhas). Só os blocos perto da tela são montados; a
 * seleção só redesenha os blocos cuja assinatura mudou.
 */
export function DiffView({ file, selection, onSelectionChange, fileNav }: Props) {
  const selectable = !!selection && !!onSelectionChange && !file.binary
  const [layout, setLayout] = useDiffLayout()
  const [fullFile, setFullFile] = useFullFile()
  const dragMode = useRef<'add' | 'remove' | null>(null)
  const lastClicked = useRef<LineKey | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const listRef = useRef<VirtualListHandle>(null)
  const live = useRef<Live | null>(null)
  const shortcutOf = useShortcutOf()
  /** Alteração atual da navegação (índice entre os blocos de alteração). */
  const [cursor, setCursor] = useState(-1)

  // Tudo o que vem do arquivo e do modo é calculado uma vez por troca, e não a cada desenho.
  const rows = useMemo(() => buildRows(file, layout), [file, layout])
  const blocks = useMemo(() => chunkRows(rows.length), [rows])
  const changes = useMemo(() => changeBlocks(file, rows), [file, rows])
  const all = useMemo(() => changeKeys(file), [file])
  /** Posição de cada chave alterada em `all`: o Shift+clique acha as pontas sem procurar na lista. */
  const pos = useMemo(() => new Map(all.map((k, i) => [k, i] as const)), [all])
  const hunkChanged = useMemo(() => file.hunks.map((h) => h.lines.reduce((n, l) => (l.kind !== 'context' ? n + 1 : n), 0)), [file])
  const digits = useMemo(() => lineNumberDigits(file.hunks), [file])
  /**
   * Régua: uma marca por linha alterada, em frações do diff inteiro, supondo linhas de mesma altura (18 px).
   * Com código que quebra linha (pre-wrap), a posição da marca fica aproximada: a régua não mede o DOM, de propósito.
   */
  const marks = useMemo(() => {
    const indexed: RulerIndexRow[] = []
    rows.forEach((row, i) => {
      const kind = rowKind(file, row)
      if (kind !== null) indexed.push({ index: i, kind })
    })
    return marksFromRows(indexed, rows.length, 0)
  }, [file, rows])
  const epoch = useMemo(() => ++diffEpoch, [file, layout])
  const keyOf = useCallback((i: number) => `${epoch}:${i}`, [epoch])

  // Contagens da seleção: O(tamanho da seleção), não O(alterações). Um hunk é o número antes do ":" da chave.
  const hunkSelected = new Array<number>(file.hunks.length).fill(0)
  let selectedCount = 0
  if (selection && selectable) {
    for (const key of selection) {
      if (!pos.has(key)) continue
      selectedCount++
      hunkSelected[Number(key.slice(0, key.indexOf(':')))]++
    }
  }
  const allSelected = selectable && all.length > 0 && selectedCount === all.length

  /** Realça as linhas de uma alteração que estão montadas. Uma leitura do DOM por linha, no máximo NAV_FLASH_MAX. */
  const flash = (start: number, end: number) => {
    const body = root.current
    if (!body) return
    const els: HTMLElement[] = []
    for (let i = start; i < end && i < start + NAV_FLASH_MAX; i++) {
      const el = body.querySelector<HTMLElement>(`tr[data-row="${i}"]`)
      if (el) els.push(el)
    }
    for (const el of els) el.classList.remove('nav-flash')
    // Um reflexo só: reinicia a animação se a mesma alteração for escolhida de novo.
    void body.offsetWidth
    for (const el of els) el.classList.add('nav-flash')
    setTimeout(() => {
      for (const el of els) el.classList.remove('nav-flash')
    }, 1400)
  }

  /** Centraliza a primeira linha da alteração. O bloco dela precisa estar montado: se ainda não está, tenta no quadro seguinte. */
  const reveal = (start: number, end: number, retry: boolean) => {
    const body = root.current
    if (!body) return
    const first = body.querySelector<HTMLElement>(`tr[data-row="${start}"]`)
    if (!first) {
      if (retry) requestAnimationFrame(() => reveal(start, end, false))
      return
    }
    first.scrollIntoView({ block: 'center', behavior: 'smooth' })
    flash(start, end)
  }

  const goChange = (delta: 1 | -1) => {
    const next = stepIndex(cursor, delta, changes.length)
    if (next < 0) return
    setCursor(next)
    const { start, end } = changes[next]
    listRef.current?.scrollToIndex(Math.floor(start / BLOCK_ROWS))
    // O bloco é montado no desenho que a rolagem causa: a procura da linha espera um quadro.
    requestAnimationFrame(() => reveal(start, end, true))
  }

  // Outro arquivo ou outro modo de exibição: a contagem recomeça.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setCursor(-1), [file, layout, fullFile])

  useDiffNav({
    el: () => root.current,
    go: (kind, delta) => (kind === 'change' ? goChange(delta) : fileNav?.go(delta))
  })

  useEffect(() => {
    const stop = () => (dragMode.current = null)
    window.addEventListener('mouseup', stop)
    return () => window.removeEventListener('mouseup', stop)
  }, [])

  const update = (keys: LineKey[], add: boolean) => {
    if (!selection || !onSelectionChange) return
    const next = new Set(selection)
    for (const k of keys) {
      if (add) next.add(k)
      else next.delete(k)
    }
    onSelectionChange(next)
  }

  /** Todas as linhas alteradas entre duas chaves (inclusive), na ordem do arquivo. */
  const between = (from: LineKey, to: LineKey) => {
    const a = pos.get(from) ?? -1
    const b = pos.get(to) ?? -1
    const [lo, hi] = [a, b].sort((m, n) => m - n)
    return all.slice(lo, hi + 1)
  }

  const onLineDown = (e: React.MouseEvent, key: LineKey) => {
    if (!selectable) return
    e.preventDefault()
    if (e.shiftKey && lastClicked.current) {
      update(between(lastClicked.current, key), true)
      return
    }
    const add = !selection!.has(key)
    dragMode.current = add ? 'add' : 'remove'
    lastClicked.current = key
    update([key], add)
  }

  const onLineEnter = (key: LineKey) => {
    if (dragMode.current) update([key], dragMode.current === 'add')
  }

  // Só as ações (menu e aviso de cópia): o diff não redesenha com a operação em andamento nem com os dados.
  const actions = useContext(AppActionsContext)

  // O código é texto selecionável: o mouse sobre ele só seleciona. Marcar a linha é clicar nela (sem texto
  // selecionado) ou usar as colunas à esquerda (caixa, números e sinal), onde o arrastar marca várias.
  const onCodeDown = (e: React.MouseEvent) => {
    // Shift+clique marca um intervalo; sem isso o navegador estenderia o texto selecionado.
    if (selectable && e.shiftKey) e.preventDefault()
  }

  const onCodeClick = (e: React.MouseEvent, key: LineKey) => {
    if (!selectable) return
    if (e.shiftKey && lastClicked.current) {
      update(between(lastClicked.current, key), true)
      return
    }
    // Com um trecho selecionado, o clique é para copiar, não para marcar a linha.
    if (selectionText()) return
    lastClicked.current = key
    update([key], !selection!.has(key))
  }

  /** Botão direito no diff: copiar as linhas marcadas e o que estiver na linha ou selecionado. */
  const onMenu = (e: React.MouseEvent) => {
    if (!actions?.showMenu) return
    const marked = selection && selection.size ? markedDiffLines(file, selection) : []
    const items: MenuItem[] = []
    if (marked.length) items.push({ label: t('copy.markedLines', { count: marked.length }), onClick: () => void copyAndNotify(diffLinesText(marked), actions.toast) })
    items.push(...copyItemsAt(e.target, actions.toast))
    if (items.length) actions.showMenu(e, items)
  }

  // Os blocos leem a seleção e os manipuladores daqui. Atualizada a cada desenho, antes de qualquer evento.
  live.current = {
    selection,
    selectable,
    hunkSelected,
    hunkChanged,
    lineDown: onLineDown,
    lineEnter: onLineEnter,
    codeDown: onCodeDown,
    codeClick: onCodeClick,
    toggleHunk: (h, checked) => update(hunkKeys(file, h), checked)
  }

  const renderItem = (i: number) => {
    const { start, end } = blocks[i]
    const sig = blockSig(file, rows, start, end, selection, selectable, hunkSelected, hunkChanged)
    return <DiffBlock file={file} rows={rows} start={start} end={end} layout={layout} sig={sig} live={live} />
  }

  return (
    <div className="diff-file" ref={root}>
      <div className="diff-file-header">
        {selectable && (
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = !allSelected && selectedCount > 0
            }}
            onChange={(e) => update(all, e.target.checked)}
            title={t('diff.selectFile')}
          />
        )}
        <span className="diff-path">
          {file.changeType === 'renamed' && file.oldPath ? `${file.oldPath} → ` : ''}
          {file.path}
        </span>
        <span className={`tag tag-${file.changeType}`}>{t(TYPE_LABEL[file.changeType])}</span>
        <span className="diff-stats">
          <span className="add">+{file.additions}</span> <span className="del">−{file.deletions}</span>
        </span>
        {selectable && <span className="muted small">{selectedCount ? t('diff.selectedOf', { selected: selectedCount, count: all.length }) : t('diff.selectHint')}</span>}
        <span className="toolbar-spacer" />
        {changes.length > 0 && (
          <div className="diff-nav" dir="ltr" role="group" aria-label={t('diffNav.group')}>
            <button onClick={() => goChange(-1)} title={`${t('diffNav.prevChange')} (${shortcutOf('diff.prevChange')})`}>
              ▲
            </button>
            <span className="diff-nav-count" title={t('diffNav.count')}>
              {cursor < 0 ? '–' : cursor + 1}/{changes.length}
            </span>
            <button onClick={() => goChange(1)} title={`${t('diffNav.nextChange')} (${shortcutOf('diff.nextChange')})`}>
              ▼
            </button>
          </div>
        )}
        {fileNav && fileNav.count > 1 && (
          <div className="diff-nav" dir="ltr" role="group" aria-label={t('diffNav.fileGroup')}>
            <button onClick={() => fileNav.go(-1)} title={`${t('diffNav.prevFile')} (${shortcutOf('diff.prevFile')})`}>
              ◀
            </button>
            <span className="diff-nav-count" title={t('diffNav.fileCount')}>
              {fileNav.index + 1}/{fileNav.count}
            </span>
            <button onClick={() => fileNav.go(1)} title={`${t('diffNav.nextFile')} (${shortcutOf('diff.nextFile')})`}>
              ▶
            </button>
          </div>
        )}
        {!file.binary && file.hunks.length > 0 && (
          <ViewOptionsButton groups={diffViewGroups({ layout, setLayout, fullFile, setFullFile })} />
        )}
      </div>
      <div className="diff-body-wrap">
        {file.truncated && (
          <div className="diff-truncated" role="status">
            <span>{t('diff.truncated.message', { size: `${DIFF_MAX_BYTES / (1024 * 1024)} MB` })}</span>
            <button onClick={() => allowFullDiff(file.path)}>{t('diff.truncated.showAll')}</button>
          </div>
        )}
        {file.binary ? (
          <div className="diff-body" onContextMenu={onMenu}>
            <p className="empty">{t('diff.binary')}</p>
          </div>
        ) : file.hunks.length === 0 ? (
          <div className="diff-body" onContextMenu={onMenu}>
            <p className="empty">{t('diff.noContent')}</p>
          </div>
        ) : (
          // data-rows: o roteiro de medição espera o diff inteiro montado como lista; o número é o de linhas da tabela.
          <VirtualList
            ref={listRef}
            className="diff-body"
            data-rows={rows.length}
            style={{ '--ln-digits': digits } as React.CSSProperties}
            onContextMenu={onMenu}
            count={blocks.length}
            rowHeight={BLOCK_HEIGHT}
            keyOf={keyOf}
            isVariable={alwaysVariable}
            overscan={OVERSCAN}
            renderItem={renderItem}
          />
        )}
        <ChangeRuler marks={marks} scroller=".diff-body" />
      </div>
    </div>
  )
}
