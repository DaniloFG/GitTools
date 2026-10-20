import { useEffect, useState } from 'react'
import type { AppInfo } from '../../../../shared/api'

let cached: Promise<AppInfo> | null = null

/** Informações do aplicativo e do sistema (lidas uma vez do processo principal). */
export function useAppInfo(): AppInfo | null {
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => {
    cached ??= window.gittools.appInfo()
    cached.then(setInfo, () => setInfo(null))
  }, [])
  return info
}
