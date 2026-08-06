import type { RouteLocationNormalized, Router } from 'vue-router'
import { useAuth } from '@/features/auth/composables/useAuth'
import { useChangePasswordDialog } from '@/composables/useChangePasswordDialog'
import { useSetupStatus } from '@/features/auth/composables/useSetupStatus'
import { canonicalizeUserFacingLibraryUrl } from '@/features/library/lib/library-route'
import { usePermissions } from '@/features/auth/composables/usePermissions'

function canonicalPublicRedirectQuery(to: RouteLocationNormalized) {
  const redirect = to.query.redirect
  if (typeof redirect !== 'string') return undefined
  const canonical = canonicalizeUserFacingLibraryUrl(redirect)
  if (canonical === redirect) return undefined
  return { path: to.path, query: { ...to.query, redirect: canonical } }
}

export function registerAuthGuard(router: Router): void {
  router.beforeEach(async (to) => {
    const { fetchSetupStatus } = useSetupStatus()
    let requiresSetup = false
    try {
      requiresSetup = await fetchSetupStatus()
    } catch {
      // If setup-status cannot be loaded, fall back to normal auth checks.
    }
    if (requiresSetup && to.path !== '/setup') {
      return { path: '/setup' }
    }

    if (!requiresSetup && to.path === '/setup') {
      const { user } = useAuth()
      return user.value ? { path: '/' } : { path: '/login' }
    }

    if (to.meta.public) return canonicalPublicRedirectQuery(to) ?? true

    const { user } = useAuth()

    if (!user.value) {
      return { path: '/login', query: { redirect: canonicalizeUserFacingLibraryUrl(to.fullPath) } }
    }

    if (user.value.isDefaultPassword && user.value.provisioningMethod !== 'shared') {
      useChangePasswordDialog().open(true)
      // Allow navigation to '/' but block everything else
      if (to.path !== '/') return { path: '/' }
    }

    const requiredPermission = typeof to.meta.permission === 'string' ? to.meta.permission : null
    if (requiredPermission && !usePermissions().hasPermission(requiredPermission)) {
      return { path: '/' }
    }

    if (to.name === 'achievements' && user.value.settings.achievementPreferences?.enabled === false) {
      return { name: 'settings-account', query: { tab: 'profile' } }
    }

    return true
  })
}
