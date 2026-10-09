import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import { ScrollArea } from '@/components/ui/scroll-area'

/**
 * The drive listing grew a second, page-level scrollbar because Tailwind's
 * `.sr-only` is `position: absolute` and reka-ui's ScrollArea viewport ships
 * `position: static`. With no containing block at the element that actually
 * clips the overflow, those spans anchored further up and stretched the
 * nearest scrollable ancestor — the page. `main.css` pins the viewport as a
 * containing block; these tests guard both halves of that arrangement so the
 * bug cannot silently return.
 */
describe('ScrollArea', () => {
  it('renders a viewport that owns the scrolling', () => {
    const wrapper = mount(ScrollArea, { slots: { default: '<p>content</p>' } })

    const viewport = wrapper.find('[data-reka-scroll-area-viewport]')
    expect(viewport.exists()).toBe(true)
    expect(viewport.text()).toContain('content')
  })

  it('renders the root as a positioned element so absolute children stay inside', () => {
    const wrapper = mount(ScrollArea)
    const root = wrapper.find('[data-slot="scroll-area"]')
    expect(root.exists()).toBe(true)
    // `relative` is what makes the root a containing block for `.sr-only`
    // descendants, which is the whole point of wrapping these regions.
    expect(root.classes()).toContain('relative')
    // reka-ui applies `position: relative` inline too; either one suffices, so
    // assert the computed guarantee rather than only the class.
    expect(root.attributes('style')).toContain('position: relative')
  })

  it('applies a caller class to the root without dropping the positioning', () => {
    const wrapper = mount(ScrollArea, { props: { class: 'flex-1 min-h-0' } })
    const root = wrapper.find('[data-slot="scroll-area"]')
    expect(root.classes()).toContain('relative')
    expect(root.classes()).toContain('flex-1')
    expect(root.classes()).toContain('min-h-0')
  })

  it('keeps the global stylesheet positioning the viewport as a containing block', () => {
    // The ScrollArea root is `overflow: visible`; the viewport is what clips.
    // The global rule is therefore load-bearing, not decorative.
    const css = readFileSync(resolve(process.cwd(), 'src/assets/main.css'), 'utf8')
    expect(css).toMatch(
      /\[data-reka-scroll-area-viewport\]\s*\{[^}]*position:\s*relative/,
    )
  })
})
