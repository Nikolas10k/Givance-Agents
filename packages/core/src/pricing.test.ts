import { describe, expect, it } from 'vitest';
import { addUsage, EMPTY_USAGE, estimateCostUsd, totalTokens } from './pricing';

describe('preços', () => {
  it('estima o custo por tipo de token', () => {
    const uso = {
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    expect(estimateCostUsd('claude-opus-5-5', uso)).toBeCloseTo(4 + 2, 6);
    expect(estimateCostUsd('modelo-desconhecido', uso)).toBeCloseTo(6, 6);
  });

  it('soma consumo', () => {
    const a = { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 };
    expect(addUsage(a, a)).toEqual({
      inputTokens: 2,
      outputTokens: 4,
      cacheReadTokens: 6,
      cacheWriteTokens: 8,
    });
    expect(totalTokens(addUsage(EMPTY_USAGE, a))).toBe(10);
  });
});
