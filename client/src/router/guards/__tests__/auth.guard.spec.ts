import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Router } from 'vue-router'
import type { AuthUser } from '@bookorbit/types'
import { registerAuthGuard } from '../auth.guard'

const user: { value: AuthUser | null } = { value: null }

function makeUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 1,
    username: 'reader',
    name: 'Reader',
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    settings: {},
    provisioningMethod: 'local',
    permissions: [],
    ...overrides,
  }
}

vi.mock('@/features/auth/composables/useAuth', () => ({
  useAuth: () => ({ user }),
}))

vi.mock('@/features/auth/composables/useSetupStatus', () => ({
  useSetupStatus: () => ({
    fetchSetupStatus: vi.fn<() => Promise<boolean>>().mockResolvedValue(false),
  }),
}))

vi.mock('@/composables/useChangePasswordDialog', () => ({
  useChangePasswordDialog: () => ({ open: vi.fn<(forced?: boolean) => void>() }),
}))

describe('registerAuthGuard', () => {
  beforeEach(() => {
    user.value = null
  })

  function registerGuard() {
    const callbacks: Array<Parameters<Router['beforeEach']>[0]> = []
    const router: Pick<Router, 'beforeEach'> = {
      beforeEach(callback) {
        callbacks.push(callback)
        return () => {}
      },
    }

    registerAuthGuard(router as Router)
    return callbacks[0]!
  }

  it('canonicalizes legacy source-backed library redirect queries on public routes', async () => {
    const guard = registerGuard()

    await expect(
      guard.call(
        undefined,
        {
          path: '/login',
          fullPath: '/login?redirect=/library/-1',
          query: { redirect: '/library/-1' },
          meta: { public: true },
        } as never,
        {} as never,
        () => {},
      ),
    ).resolves.toEqual({
      path: '/login',
      query: { redirect: '/library/ebooks' },
    })
  })

  it('redirects normal users away from the Book Dock import surface', async () => {
    user.value = makeUser()
    const guard = registerGuard()

    await expect(
      guard.call(
        undefined,
        {
          path: '/book-dock',
          fullPath: '/book-dock',
          query: {},
          meta: { permission: 'book_dock_access' },
        } as never,
        {} as never,
        () => {},
      ),
    ).resolves.toEqual({ path: '/' })
  })

  it('allows users with Book Dock access onto the import surface', async () => {
    user.value = makeUser({ permissions: ['book_dock_access'] })
    const guard = registerGuard()

    await expect(
      guard.call(
        undefined,
        {
          path: '/book-dock',
          fullPath: '/book-dock',
          query: {},
          meta: { permission: 'book_dock_access' },
        } as never,
        {} as never,
        () => {},
      ),
    ).resolves.toBe(true)
  })
})
