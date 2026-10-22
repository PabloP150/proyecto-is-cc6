import { useEffect, useRef } from 'react';

/**
 * Calls `callback` every `delayMs` while `enabled` and the browser tab is visible (a hidden tab
 * does not spend the group's shared GitHub API budget). The latest callback is always used.
 */
export default function useVisibleInterval(callback, delayMs, enabled) {
  const saved = useRef(callback);
  useEffect(() => {
    saved.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled || !delayMs) return undefined;
    const id = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') saved.current();
    }, delayMs);
    return () => clearInterval(id);
  }, [delayMs, enabled]);
}
