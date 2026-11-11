import { useRef } from 'react'
import { useAppActions } from '../context'
import { t } from '../i18n'
import { useFileViewMode } from './FileList'
import type { MenuItem } from './ContextMenu'
import { withActionsSubmenu } from '../viewMenu'

/** Uma opção de visualização (mostrada com ✓ quando é a escolhida). */
export interface ViewOption {
  label: string
  checked: boolean
  onSelect(): void
  hint?: string
}

/** Grupo de opções; o título (opcional) aparece como item desabilitado acima das opções. */
export interface ViewOptionGroup {
  title?: string
  options: ViewOption[]
}

/**
 * Botão discreto do cabeçalho que reúne as opções de visualização (lista/árvore, layout do diff…)
 * num menu, para o cabeçalho ficar só com as ações. O menu abre logo abaixo do botão.
 */
export function ViewOptionsButton({ groups, label, submenu }: { groups: ViewOptionGroup[]; label?: string; submenu?: { label: string; items: MenuItem[] } }) {
  const { showMenu } = useAppActions()
  const ref = useRef<HTMLButtonElement>(null)
  const title = label ?? t('fileList.viewOptions')

  const open = () => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    // showMenu só usa as coordenadas do evento: um MouseEvent avulso posiciona o menu sob o botão.
    const at = new MouseEvent('contextmenu', { clientX: rect.left, clientY: rect.bottom + 4 }) as unknown as React.MouseEvent
    showMenu(at, withActionsSubmenu(groupsToMenu(groups), submenu))
  }

  return (
    <button ref={ref} className="view-options-btn" title={title} aria-label={title} aria-haspopup="menu" onClick={open}>
      ⋯
    </button>
  )
}

/** Monta os itens do menu: títulos de grupo desabilitados, separador entre grupos. */
export function groupsToMenu(groups: ViewOptionGroup[]): MenuItem[] {
  const items: MenuItem[] = []
  groups.forEach((group, g) => {
    if (g > 0) items.push('separator')
    if (group.title) items.push({ label: group.title, disabled: true, checked: false })
    for (const option of group.options) {
      items.push({ label: option.label, checked: option.checked, hint: option.hint, onClick: option.onSelect })
    }
  })
  return items
}

/** Grupo "Modo do arquivo" (lista ou árvore), o mesmo para todas as listas de arquivos do app. */
export function useFileViewGroup(title = t('fileList.viewMode')): ViewOptionGroup {
  const [mode, setMode] = useFileViewMode()
  return {
    title,
    options: [
      { label: t('fileList.list'), checked: mode === 'list', onSelect: () => setMode(undefined) },
      { label: t('fileList.tree'), checked: mode === 'tree', onSelect: () => setMode('tree') }
    ]
  }
}

/** Botão de opções só com o modo de arquivos (lista/árvore); `title` troca o nome do grupo (ex.: branches). */
export function FileViewOptions({ title }: { title?: string }) {
  const files = useFileViewGroup(title)
  return <ViewOptionsButton groups={[files]} />
}

/**
 * Opções do diff: layout (cima e baixo / lado a lado) e arquivo inteiro. O estado vem do DiffView
 * (que já tem os hooks `useDiffLayout` e `useFullFile`), por isso aqui é só a montagem dos grupos.
 */
export function diffViewGroups(state: {
  layout: 'inline' | 'split'
  setLayout(layout: 'inline' | 'split'): void
  fullFile: boolean
  setFullFile(full: boolean): void
}): ViewOptionGroup[] {
  return [
    {
      title: t('diff.layout'),
      options: [
        { label: t('diff.inline'), checked: state.layout === 'inline', onSelect: () => state.setLayout('inline') },
        { label: t('diff.split'), checked: state.layout === 'split', onSelect: () => state.setLayout('split') }
      ]
    },
    {
      options: [{ label: t('diffExtra.fullFile'), checked: state.fullFile, onSelect: () => state.setFullFile(!state.fullFile) }]
    }
  ]
}
