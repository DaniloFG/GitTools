// As duas visões da tela Alterações (sem React nem DOM, para poder ser testado à parte).

export type SectionId = 'conflicts' | 'unstaged' | 'staged' | 'files' | 'commit' | 'diff'

/** As duas visões: listas separadas (staged / não staged) ou uma lista com caixas de seleção. */
export type ChangesMode = 'stage' | 'check'

export const parseChangesMode = (value: unknown): ChangesMode => (value === 'check' ? 'check' : 'stage')
