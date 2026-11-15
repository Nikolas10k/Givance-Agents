/** Horário de silêncio do dono, ex.: {"inicio": "22:00", "fim": "07:00"} no fuso da empresa. */
export interface QuietHours {
  inicio: string;
  fim: string;
}

function minutos(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** Minutos desde a meia-noite no fuso informado. */
function agoraLocal(timezone: string, now: Date): number {
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const h = Number(partes.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(partes.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

/**
 * Segundos até o fim do horário de silêncio, ou 0 se agora não é silêncio.
 * Aceita intervalos que passam da meia-noite (22:00 -> 07:00).
 */
export function quietDelaySeconds(
  quiet: unknown,
  timezone: string,
  now: Date = new Date(),
): number {
  if (!quiet || typeof quiet !== 'object') return 0;
  const { inicio, fim } = quiet as Partial<QuietHours>;
  if (typeof inicio !== 'string' || typeof fim !== 'string') return 0;
  const ini = minutos(inicio);
  const end = minutos(fim);
  if (ini === null || end === null || ini === end) return 0;
  const agora = agoraLocal(timezone, now);
  const dentro = ini < end ? agora >= ini && agora < end : agora >= ini || agora < end;
  if (!dentro) return 0;
  const faltam = (end - agora + 24 * 60) % (24 * 60);
  return faltam * 60 - now.getUTCSeconds();
}

/** Janela de 24h do WhatsApp aberta (com 5 min de margem). */
export function windowOpen(lastInboundAt: string | null, now: Date = new Date()): boolean {
  if (!lastInboundAt) return false;
  return now.getTime() - new Date(lastInboundAt).getTime() < (24 * 60 - 5) * 60 * 1000;
}

/** O dono falou com o funcionário nos últimos 30 minutos (conversa ativa: responde na hora). */
export function activeConversation(lastInboundAt: string | null, now: Date = new Date()): boolean {
  if (!lastInboundAt) return false;
  return now.getTime() - new Date(lastInboundAt).getTime() < 30 * 60 * 1000;
}
