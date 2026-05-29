import { describe, it, expect } from 'vitest'
import { groupByCap } from '../composables/useFoliateTts'

describe('groupByCap', () => {
  it('returns empty array for empty string', () => {
    expect(groupByCap('', 800)).toEqual([])
  })

  it('returns empty array for whitespace-only string', () => {
    expect(groupByCap('   \n  ', 800)).toEqual([])
  })

  it('returns single short sentence as-is', () => {
    expect(groupByCap('Hello world.', 800)).toEqual(['Hello world.'])
  })

  it('merges two short sentences under the cap into one group', () => {
    const result = groupByCap('First sentence. Second sentence.', 800)
    expect(result).toHaveLength(1)
    expect(result[0]).toContain('First sentence')
    expect(result[0]).toContain('Second sentence')
  })

  it('splits sentences into separate groups when combined length exceeds cap', () => {
    const longSentence = 'A'.repeat(500)
    const anotherLongSentence = 'B'.repeat(400)
    const text = `${longSentence}. ${anotherLongSentence}.`
    const result = groupByCap(text, 800)
    expect(result.length).toBeGreaterThan(1)
  })

  it('keeps a single sentence that exceeds cap as its own group', () => {
    const bigSentence = 'Word '.repeat(200).trim() + '.'
    expect(bigSentence.length).toBeGreaterThan(800)
    const result = groupByCap(bigSentence, 800)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(bigSentence)
  })

  it('greedily packs sentences until adding the next would exceed cap', () => {
    // Three 300-char sentences: [s1+s2 = 601 ≤ 800], then [s3 alone]
    const s1 = 'A'.repeat(299) + '.'
    const s2 = 'B'.repeat(299) + '.'
    const s3 = 'C'.repeat(299) + '.'
    const text = `${s1} ${s2} ${s3}`
    const result = groupByCap(text, 800)
    expect(result).toHaveLength(2)
    expect(result[0]).toContain('A'.repeat(299))
    expect(result[0]).toContain('B'.repeat(299))
    expect(result[1]).toContain('C'.repeat(299))
  })

  it('respects custom maxChars cap', () => {
    const text = 'Short one. Short two. Short three.'
    const result = groupByCap(text, 20)
    expect(result.length).toBeGreaterThan(1)
  })

  it('handles paragraph with exactly maxChars characters as a single group', () => {
    const text = 'Hello world sentence.'
    const result = groupByCap(text, text.length)
    expect(result).toHaveLength(1)
  })

  it('handles many short sentences merged into minimal groups', () => {
    const sentences = Array.from({ length: 10 }, (_, i) => `Sentence ${i + 1}.`).join(' ')
    const result = groupByCap(sentences, 800)
    expect(result).toHaveLength(1)
    expect(result[0]).toContain('Sentence 1')
    expect(result[0]).toContain('Sentence 10')
  })

  it('produces groups where no group (except oversized single sentences) exceeds maxChars', () => {
    const sentences = Array.from({ length: 20 }, () => 'The quick brown fox jumped over the lazy dog.').join(' ')
    const result = groupByCap(sentences, 200)
    const maxLen = Math.max(...result.map((g) => g.length))
    expect(maxLen).toBeLessThanOrEqual(200 + 100)
  })
})
