import { describe, expect, it } from 'vitest';
import { activeConversation, quietDelaySeconds, windowOpen } from './horario';

const SP = 'America/Sao_Paulo';

describe('horário de silêncio', () => {
  const quiet = { inicio: '22:00', fim: '07:00' };
  it('fora do silêncio não adia', () => {
    expect(quietDelaySeconds(quiet, SP, new Date('2026-11-16T15:00:00Z'))).toBe(0); // 12h em SP
  });
  it('dentro do silêncio adia até o fim, passando da meia-noite', () => {
    // 23:30 em SP -> faltam 7h30 até 07:00
    expect(quietDelaySeconds(quiet, SP, new Date('2026-11-17T02:30:00Z'))).toBe(7.5 * 3600);
    // 06:00 em SP -> falta 1h
    expect(quietDelaySeconds(quiet, SP, new Date('2026-11-16T09:00:00Z'))).toBe(3600);
  });
  it('configuração ausente ou inválida não adia', () => {
    expect(quietDelaySeconds(null, SP)).toBe(0);
    expect(quietDelaySeconds({ inicio: '25:00', fim: '07:00' }, SP)).toBe(0);
  });
});

describe('janelas', () => {
  const agora = new Date('2026-11-16T12:00:00Z');
  it('24h do WhatsApp e conversa ativa', () => {
    expect(windowOpen(null, agora)).toBe(false);
    expect(windowOpen('2026-11-15T13:00:00Z', agora)).toBe(true);
    expect(windowOpen('2026-11-15T11:00:00Z', agora)).toBe(false);
    expect(activeConversation('2026-11-16T11:45:00Z', agora)).toBe(true);
    expect(activeConversation('2026-11-16T11:00:00Z', agora)).toBe(false);
  });
});
