import { describe, expect, it } from 'vitest'
import {
  shouldCloseAfterResolve,
  shouldOpenOnStartup,
  type ConflictStartupSetting,
  type ConflictSummarySetting
} from '../src/renderer/src/conflictScreenPolicy'
import type { OperationKind } from '../src/shared/types'

describe('shouldOpenOnStartup', () => {
  // [tem conflito, opção, já abriu nesta sessão, esperado]
  const cases: [boolean, ConflictStartupSetting, boolean, boolean][] = [
    [true, 'open', false, true],
    [true, 'open', true, false],
    [true, 'bannerOnly', false, false],
    [true, 'bannerOnly', true, false],
    [false, 'open', false, false],
    [false, 'open', true, false],
    [false, 'bannerOnly', false, false],
    [false, 'bannerOnly', true, false]
  ]

  it.each(cases)('conflito=%s, opção=%s, já abriu=%s → %s', (hasConflicts, setting, alreadyOpenedFor, expected) => {
    expect(shouldOpenOnStartup({ hasConflicts, setting, alreadyOpenedFor })).toBe(expected)
  })
})

describe('shouldCloseAfterResolve', () => {
  // Fecha só com a opção "fechar", com a operação que acompanhava terminada (operação agora = none).
  // [opção, operação agora, havia operação, esperado]
  const cases: [ConflictSummarySetting, OperationKind, boolean, boolean][] = [
    ['keep', 'none', true, false],
    ['keep', 'none', false, false],
    ['keep', 'merge', true, false],
    ['keep', 'merge', false, false],
    ['keep', 'cherry-pick', true, false],
    ['keep', 'cherry-pick', false, false],
    ['keep', 'revert', true, false],
    ['keep', 'revert', false, false],
    ['keep', 'rebase', true, false],
    ['keep', 'rebase', false, false],
    ['close', 'none', true, true],
    ['close', 'none', false, false],
    ['close', 'merge', true, false],
    ['close', 'merge', false, false],
    ['close', 'cherry-pick', true, false],
    ['close', 'cherry-pick', false, false],
    ['close', 'revert', true, false],
    ['close', 'revert', false, false],
    ['close', 'rebase', true, false],
    ['close', 'rebase', false, false]
  ]

  it.each(cases)('opção=%s, operação agora=%s, havia operação=%s → %s', (setting, operationKind, hadOperation, expected) => {
    expect(shouldCloseAfterResolve({ setting, operationKind, hadOperation })).toBe(expected)
  })
})
