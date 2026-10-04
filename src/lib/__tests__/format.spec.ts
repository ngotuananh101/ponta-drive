import { describe, expect, it } from 'vitest'

import { humanizeBytes } from '@/lib/format'

describe('humanizeBytes', () => {
  it('formats zero and negatives as 0 B', () => {
    expect(humanizeBytes(0)).toBe('0 B')
    expect(humanizeBytes(-5)).toBe('0 B')
  })

  it('formats bytes below 1 KB verbatim', () => {
    expect(humanizeBytes(512)).toBe('512 B')
  })

  it('uses binary (1024-based) units', () => {
    expect(humanizeBytes(1024)).toBe('1 KB')
    expect(humanizeBytes(1048576)).toBe('1 MB')
    expect(humanizeBytes(1073741824)).toBe('1.0 GB')
    expect(humanizeBytes(1099511627776)).toBe('1.0 TB')
  })

  it('rounds KB and MB to whole numbers and GB/TB to one decimal', () => {
    expect(humanizeBytes(1536)).toBe('2 KB')
    expect(humanizeBytes(1572864)).toBe('2 MB')
    expect(humanizeBytes(118700499)).toBe('113 MB')
    // A 5 TB drive total must read as "5.0 TB", not "5120.0 GB".
    expect(humanizeBytes(5 * 1099511627776)).toBe('5.0 TB')
  })
})
