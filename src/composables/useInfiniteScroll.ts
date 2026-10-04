import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue'

/**
 * Calls `onReach` whenever the `sentinel` element scrolls into view.
 *
 * The `immediate` flag on the watcher is load-bearing, not a style choice.
 * Vue assigns template refs while patching, which happens before the
 * `mounted` hook is flushed, so by the time this function's `onMounted`
 * callback runs the ref already holds the element. A watcher created here
 * without `immediate` would only fire on a *later* assignment - which never
 * comes - and the observer would never be attached. The failure is silent:
 * no error is thrown, the first page renders, and the list simply stops.
 *
 * `immediate` handles that first assignment; the watcher handles later ones,
 * such as the sentinel being re-created when a `v-if` branch swaps the whole
 * list element out.
 */
export function useInfiniteScroll(
  sentinel: Ref<HTMLElement | null>,
  onReach: () => void,
): void {
  let observer: IntersectionObserver | null = null

  onMounted(() => {
    observer = new IntersectionObserver((entries) => {
      // `some`, not `entries[0]`: a batch can carry more than one entry, and
      // the sentinel becoming visible is what matters regardless of position.
      if (entries.some((entry) => entry.isIntersecting)) {
        onReach()
      }
    })

    watch(
      sentinel,
      (el, previous) => {
        if (previous) observer?.unobserve(previous)
        if (el) observer?.observe(el)
      },
      { immediate: true, flush: 'post' },
    )
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
    observer = null
  })
}
