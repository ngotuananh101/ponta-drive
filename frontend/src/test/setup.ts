// vitest global setup.
//
// The API client reads the token from localStorage and the locale from a
// localStorage key, so every test that touches the client needs a clean
// storage. Clearing between tests keeps one test's token from leaking into
// the next.
import { beforeEach } from 'vitest'

beforeEach(() => {
  localStorage.clear()
})