// Fullscreen + landscape lock helpers for phones (the game table only fits sideways).

/** Orientation lock is only in the Screen Orientation API (Android Chrome etc.); iOS Safari lacks it. */
type LockableOrientation = ScreenOrientation & { lock?: (o: 'landscape') => Promise<void> }

export function canLockLandscape(): boolean {
  if (typeof document === 'undefined' || typeof screen === 'undefined') return false
  const o = screen.orientation as LockableOrientation | undefined
  return Boolean(document.fullscreenEnabled && o && typeof o.lock === 'function')
}

/** Enter fullscreen and lock to landscape where the browser allows it. Silently does nothing otherwise. */
export async function enterLandscapeFullscreen(): Promise<boolean> {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
    const o = screen.orientation as LockableOrientation | undefined
    await o?.lock?.('landscape')
    return true
  } catch {
    return false
  }
}
