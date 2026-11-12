// Quando a tela Conflitos abre sozinha na partida e quando fecha depois de resolver. Lógica pura, sem React, para
// ser testada direto (tests/conflict-screen-policy.test.ts). Os tipos das opções moram em `shared/settings.ts` (o
// código compartilhado não importa o renderer); aqui só são reexportados, e a regra.

import type { ConflictStartupSetting, ConflictSummarySetting } from '../../shared/settings'
import type { OperationKind } from '../../shared/types'

export type { ConflictStartupSetting, ConflictSummarySetting }

export interface StartupInput {
  hasConflicts: boolean
  setting: ConflictStartupSetting
  /**
   * A tela já abriu sozinha para o repositório atual nesta sessão. Quem chama controla isso e o zera ao trocar de
   * repositório; sem essa marca, cada leitura do status fecharia e reabriria a tela.
   */
  alreadyOpenedFor: boolean
}

/** Abre na partida só com conflito, com a opção "abrir" e sem ter aberto ainda nesta sessão. */
export function shouldOpenOnStartup({ hasConflicts, setting, alreadyOpenedFor }: StartupInput): boolean {
  return hasConflicts && setting === 'open' && !alreadyOpenedFor
}

export interface CloseInput {
  setting: ConflictSummarySetting
  /** Operação em andamento agora (`none` = terminou ou nunca houve). */
  operationKind: OperationKind
  /** A tela estava acompanhando uma operação antes. Sem isso, `none` não é "terminou". */
  hadOperation: boolean
}

/**
 * Fecha só com a opção "fechar", e só quando a operação que a tela acompanhava terminou (estava em andamento e
 * agora está `none`). Tela que nunca viu operação não fecha sozinha.
 */
export function shouldCloseAfterResolve({ setting, operationKind, hadOperation }: CloseInput): boolean {
  return setting === 'close' && hadOperation && operationKind === 'none'
}
