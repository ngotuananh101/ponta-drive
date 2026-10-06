import { ref, watch, type Ref } from 'vue'

/**
 * A ref whose value is mirrored into localStorage.
 *
 * Persisted UI preferences (view mode, panel visibility) belong to the viewer,
 * not the account, so they live in the browser rather than the backend. Every
 * read and write is guarded: storage can be unavailable or throw (private
 * windows, disabled cookies), and a preference is never worth breaking the
 * view over, so a failure silently degrades to the in-memory value.
 *
 * `isValid` rejects anything that is not a value this key may hold, so a
 * hand-edited or corrupted entry falls back to `fallback` instead of reaching
 * the UI.
 */
export function usePersistedRef<T>(
  key: string,
  fallback: T,
  isValid: (value: unknown) => value is T,
): Ref<T> {
  const value = ref(fallback) as Ref<T>

  try {
    const raw = localStorage.getItem(key)
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw)
      if (isValid(parsed)) {
        value.value = parsed
      }
    }
  } catch {
    // Unavailable or unparseable storage: keep the fallback.
  }

  watch(value, (next) => {
    try {
      localStorage.setItem(key, JSON.stringify(next))
    } catch {
      // Storage unavailable: the value still works for this session.
    }
  })

  return value
}
