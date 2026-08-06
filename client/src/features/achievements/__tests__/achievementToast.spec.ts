import { describe, it, expect, vi } from 'vitest'
import { showAchievementToast } from '../utils/achievementToast'

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn<() => void>() },
}))

vi.mock('canvas-confetti', () => ({
  default: vi.fn<() => void>(),
}))

import { toast } from 'vue-sonner'

describe('showAchievementToast', () => {
  it('shows a success toast for common rarity', () => {
    showAchievementToast('First Steps', 'common')
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining('First Steps'),
      expect.objectContaining({ description: 'Achievement Unlocked!', duration: 4000 }),
    )
  })

  it('shows a longer toast for epic rarity', () => {
    showAchievementToast('Story Stalwart', 'epic')
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining('Story Stalwart'),
      expect.objectContaining({ description: 'Achievement Unlocked!', duration: 6000 }),
    )
  })

  it('shows a longer toast for legendary rarity', () => {
    showAchievementToast('Grand Archivist', 'legendary')
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Grand Archivist'), expect.objectContaining({ duration: 6000 }))
  })
})
