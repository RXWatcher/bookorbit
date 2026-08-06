import cronstrue from 'cronstrue'

export function parseCronToHuman(cron: string | null | undefined): string | null {
  if (!cron) return null
  try {
    return cronstrue.toString(cron, { use24HourTimeFormat: false, verbose: false })
  } catch {
    return cron
  }
}
