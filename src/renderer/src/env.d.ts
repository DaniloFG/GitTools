import type { GitToolsBridge } from '../../shared/api'

declare global {
  interface Window {
    gittools: GitToolsBridge
  }
}

export {}
