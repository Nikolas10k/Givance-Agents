import { describe, expect, it } from 'vitest';
import { computeNextRun, cronProblem, isValidTimezone } from './cron';

describe('cron', () => {
  it('aceita expressões de 5 campos e recusa o resto', () => {
    expect(cronProblem('0 7 * * *')).toBeNull();
    expect(cronProblem('*/3 * * * *')).toBeNull();
    expect(cronProblem('0 0 7 * * *')).toMatch(/5 campos/);
    expect(cronProblem('70 7 * * *')).toMatch(/inválida/);
  });

  it('calcula a próxima execução no fuso da empresa', () => {
    // 15/11/2026 10:00 UTC = 07:00 em São Paulo (UTC-3, sem horário de verão).
    const from = new Date('2026-11-15T09:59:00Z');
    const next = computeNextRun('0 7 * * *', 'America/Sao_Paulo', from);
    expect(next.toISOString()).toBe('2026-11-15T10:00:00.000Z');

    const depois = computeNextRun('0 7 * * *', 'America/Sao_Paulo', next);
    expect(depois.toISOString()).toBe('2026-11-16T10:00:00.000Z');
  });

  it('valida fusos IANA', () => {
    expect(isValidTimezone('America/Sao_Paulo')).toBe(true);
    expect(isValidTimezone('Brasil/Lugar_Nenhum')).toBe(false);
    expect(() => computeNextRun('0 7 * * *', 'Lugar/Nenhum')).toThrow(/Fuso/);
  });
});
