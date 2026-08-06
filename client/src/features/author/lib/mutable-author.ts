export function isMutableAuthorId(authorId: number | null | undefined): authorId is number {
  return typeof authorId === 'number' && Number.isInteger(authorId) && authorId > 0
}
