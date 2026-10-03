import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref, type Ref } from 'vue'
import { mount } from '@vue/test-utils'

import { useInfiniteScroll } from '@/composables/useInfiniteScroll'

let observe: ReturnType<typeof vi.fn>
let unobserve: ReturnType<typeof vi.fn>
let disconnect: ReturnType<typeof vi.fn>
// Assigned by the stub's constructor, which only runs once the composable
// creates the observer. Initialised to a no-op so a test that fires before
// mounting fails on its own assertion rather than on "not a function".
let emitIntersect: (isIntersecting: boolean) => void = () => {}

beforeEach(() => {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
  emitIntersect = () => {}

  // happy-dom has no IntersectionObserver, and even if it did the test would
  // need to decide when an intersection happens. A stub gives the test that
  // control and records the calls that matter.
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      root = null
      rootMargin = ''
      thresholds: number[] = []
      observe = observe
      unobserve = unobserve
      disconnect = disconnect
      takeRecords = () => []
      constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
        emitIntersect = (isIntersecting) => cb([{ isIntersecting }])
      }
    },
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Mounts a component whose template ref is the sentinel, like DriveView's. */
function mountSentinel() {
  const onReach = vi.fn()
  let sentinel!: Ref<HTMLElement | null>

  const Harness = defineComponent({
    setup() {
      sentinel = ref<HTMLElement | null>(null)
      useInfiniteScroll(sentinel, onReach)
      // Returning a render function from setup lets the ref object be passed
      // directly to `ref:`, which is what binds it to the setup ref. A string
      // `ref: 'sentinel'` would land in `$refs` instead.
      return () => h('div', { ref: sentinel })
    },
  })

  const wrapper = mount(Harness)
  return { wrapper, onReach, sentinel }
}

describe('useInfiniteScroll', () => {
  it('observes the sentinel that is already mounted when the hook runs', () => {
    const { wrapper } = mountSentinel()

    // This is the whole point of the test. The ref is assigned during patch,
    // before `mounted` fires, so a watcher created in `onMounted` without
    // `immediate` would never see an assignment and this call would not
    // happen - silently breaking infinite scroll.
    expect(observe).toHaveBeenCalledTimes(1)
    expect(observe).toHaveBeenCalledWith(wrapper.element)

    wrapper.unmount()
  })

  it('calls onReach when the sentinel becomes visible', async () => {
    const { wrapper, onReach } = mountSentinel()

    emitIntersect(true)
    await nextTick()

    expect(onReach).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })

  it('does not call onReach for a non-intersecting entry', async () => {
    const { wrapper, onReach } = mountSentinel()

    emitIntersect(false)
    await nextTick()

    expect(onReach).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('stops observing when the component unmounts', () => {
    const { wrapper } = mountSentinel()

    wrapper.unmount()

    // A live observer holding a detached node keeps the component's closure
    // reachable and can keep firing after the view is gone.
    expect(disconnect).toHaveBeenCalled()
  })
})
