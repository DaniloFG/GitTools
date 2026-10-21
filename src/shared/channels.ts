// Canais de comunicação entre a interface e o lado que fala com o sistema (Electron ou VS Code).

/** Nomes dos canais, iguais aos usados entre a interface e o processo principal. */
export const BRIDGE_CHANNELS = [
  'app:openRepository',
  'app:currentRepository',
  'app:initRepository',
  'app:recentRepositories',
  'app:openFile',
  'app:detectEditors',
  'app:chooseEditor',
  'app:openInEditor',
  'app:testEditor',
  'app:getSettings',
  'app:saveSettings',
  'app:info',
  'app:gitLog',
  'app:openDiffWindow',
  'app:chooseFolder',
  'app:defaultCloneFolder',
  'app:cloneRepository',
  'app:gitIdentity',
  'app:setGitIdentity',
  'repo:invoke'
] as const
export type BridgeChannel = (typeof BRIDGE_CHANNELS)[number]

/** O canal existe? (A interface só pode pedir canais conhecidos.) */
export const isBridgeChannel = (value: unknown): value is BridgeChannel => (BRIDGE_CHANNELS as readonly unknown[]).includes(value)

// ---- Extensão do VS Code: mensagens trocadas entre o webview e a extensão

/** Webview → extensão: um pedido. */
export interface WebviewRequest {
  type: 'request'
  id: number
  channel: BridgeChannel
  args: unknown[]
}

/** Extensão → webview: a resposta de um pedido. */
export type WebviewResponse = { type: 'response'; id: number; ok: true; result: unknown } | { type: 'response'; id: number; ok: false; error: string }

/** Extensão → webview: algo aconteceu (comando git, mudança no repositório). */
export interface WebviewEvent {
  type: 'event'
  channel: 'git:command' | 'repo:changed'
  payload?: unknown
}

/** Webview → extensão: fechar este painel (janela de diff). */
export interface WebviewClose {
  type: 'close'
}

export type WebviewToHost = WebviewRequest | WebviewClose
export type HostToWebview = WebviewResponse | WebviewEvent
