import { isValidSlug, normalizeEmail, slugify } from '../src/routes/auth'

describe('auth utils', () => {
  it('slugify normalizes mixed input to canonical slug', () => {
    expect(slugify(' Platform NX / Team ')).toBe('platform-nx-team')
  })

  it('normalizeEmail lowercases and trims', () => {
    expect(normalizeEmail('  Ashish.1999vns@GMAIL.com  ')).toBe('ashish.1999vns@gmail.com')
  })

  it('isValidSlug accepts only lowercase letters, numbers, and single hyphen separators', () => {
    expect(isValidSlug('platform-nx')).toBe(true)
    expect(isValidSlug('platform-nx-2')).toBe(true)
    expect(isValidSlug('platform nx')).toBe(false)
    expect(isValidSlug('Platform-Nx')).toBe(false)
    expect(isValidSlug('platform_nx')).toBe(false)
    expect(isValidSlug('-platform')).toBe(false)
    expect(isValidSlug('platform-')).toBe(false)
  })
})

