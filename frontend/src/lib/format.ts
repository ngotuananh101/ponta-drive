/**
 * Formats a byte count into a compact human-readable string using binary
 * (1024-based) units, e.g. 1536 -> "2 KB".
 *
 * Shared by the home dashboard and the sidebar storage widget so the two
 * surfaces never disagree on how the same figure reads.
 */
export function humanizeBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const TB = 1099511627776
  const GB = 1073741824
  const MB = 1048576
  if (bytes >= TB) return `${(bytes / TB).toFixed(1)} TB`
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`
  if (bytes >= MB) return `${(bytes / MB).toFixed(0)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}
