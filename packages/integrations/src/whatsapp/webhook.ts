import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { fromWaId } from './client';

/** Confere o cabeçalho X-Hub-Signature-256 (HMAC SHA-256 do corpo bruto com o App Secret). */
export function verifySignature(
  rawBody: string | Uint8Array,
  header: string | null,
  appSecret: string,
): boolean {
  if (!header || !header.startsWith('sha256=') || !appSecret) return false;
  const esperado = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const recebido = header.slice('sha256='.length).toLowerCase();
  if (recebido.length !== esperado.length) return false;
  return timingSafeEqual(Buffer.from(recebido, 'utf8'), Buffer.from(esperado, 'utf8'));
}

/** Verificação do webhook (GET): devolve o challenge se o token bater. */
export function verifyChallenge(params: URLSearchParams, verifyToken: string): string | null {
  if (
    params.get('hub.mode') === 'subscribe' &&
    verifyToken.length > 0 &&
    params.get('hub.verify_token') === verifyToken
  ) {
    return params.get('hub.challenge');
  }
  return null;
}

export type InboundMessage =
  | { id: string; from: string; at: Date; replyTo?: string; kind: 'texto'; text: string }
  | {
      id: string;
      from: string;
      at: Date;
      replyTo?: string;
      kind: 'imagem';
      mediaId: string;
      mimeType?: string;
      caption?: string;
    }
  | {
      id: string;
      from: string;
      at: Date;
      replyTo?: string;
      kind: 'botao';
      buttonId: string;
      title: string;
    }
  | { id: string; from: string; at: Date; replyTo?: string; kind: 'outro'; type: string };

export interface StatusUpdate {
  messageId: string;
  status: string;
  recipient: string;
  error?: string;
}

const messageSchema = z.looseObject({
  id: z.string(),
  from: z.string(),
  timestamp: z.string().optional(),
  type: z.string(),
  context: z.looseObject({ id: z.string().optional() }).optional(),
  text: z.looseObject({ body: z.string() }).optional(),
  image: z
    .looseObject({
      id: z.string(),
      mime_type: z.string().optional(),
      caption: z.string().optional(),
    })
    .optional(),
  interactive: z
    .looseObject({
      type: z.string(),
      button_reply: z.looseObject({ id: z.string(), title: z.string() }).optional(),
    })
    .optional(),
  button: z.looseObject({ payload: z.string().optional(), text: z.string().optional() }).optional(),
});

const statusSchema = z.looseObject({
  id: z.string(),
  status: z.string(),
  recipient_id: z.string().optional(),
  errors: z
    .array(z.looseObject({ title: z.string().optional(), message: z.string().optional() }))
    .optional(),
});

const payloadSchema = z.looseObject({
  object: z.string().optional(),
  entry: z
    .array(
      z.looseObject({
        changes: z
          .array(
            z.looseObject({
              field: z.string().optional(),
              value: z
                .looseObject({
                  messages: z.array(z.unknown()).optional(),
                  statuses: z.array(z.unknown()).optional(),
                })
                .optional(),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
});

/** Extrai mensagens e status de um evento do webhook. Itens com formato inesperado são ignorados. */
export function parseWebhook(payload: unknown): {
  messages: InboundMessage[];
  statuses: StatusUpdate[];
} {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return { messages: [], statuses: [] };
  const messages: InboundMessage[] = [];
  const statuses: StatusUpdate[] = [];

  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      if (change.field && change.field !== 'messages') continue;
      for (const raw of change.value?.messages ?? []) {
        const m = messageSchema.safeParse(raw);
        if (!m.success) continue;
        const base = {
          id: m.data.id,
          from: fromWaId(m.data.from),
          at: m.data.timestamp ? new Date(Number(m.data.timestamp) * 1000) : new Date(),
          ...(m.data.context?.id ? { replyTo: m.data.context.id } : {}),
        };
        if (m.data.type === 'text' && m.data.text) {
          messages.push({ ...base, kind: 'texto', text: m.data.text.body });
        } else if (m.data.type === 'image' && m.data.image) {
          messages.push({
            ...base,
            kind: 'imagem',
            mediaId: m.data.image.id,
            ...(m.data.image.mime_type ? { mimeType: m.data.image.mime_type } : {}),
            ...(m.data.image.caption ? { caption: m.data.image.caption } : {}),
          });
        } else if (m.data.type === 'interactive' && m.data.interactive?.button_reply) {
          const reply = m.data.interactive.button_reply;
          messages.push({ ...base, kind: 'botao', buttonId: reply.id, title: reply.title });
        } else if (m.data.type === 'button' && m.data.button?.payload) {
          messages.push({
            ...base,
            kind: 'botao',
            buttonId: m.data.button.payload,
            title: m.data.button.text ?? '',
          });
        } else {
          messages.push({ ...base, kind: 'outro', type: m.data.type });
        }
      }
      for (const raw of change.value?.statuses ?? []) {
        const s = statusSchema.safeParse(raw);
        if (!s.success) continue;
        const erro = s.data.errors?.[0];
        statuses.push({
          messageId: s.data.id,
          status: s.data.status,
          recipient: s.data.recipient_id ? fromWaId(s.data.recipient_id) : '',
          ...(erro ? { error: erro.message ?? erro.title ?? 'erro' } : {}),
        });
      }
    }
  }
  return { messages, statuses };
}

/** Botões das prévias de aprovação: id = "ap:<uuid>:<aprovar|editar|recusar>". */
export type ApprovalButtonAction = 'aprovar' | 'editar' | 'recusar';

export function approvalButtonId(approvalId: string, action: ApprovalButtonAction): string {
  return `ap:${approvalId}:${action}`;
}

export function parseApprovalButtonId(
  id: string,
): { approvalId: string; action: ApprovalButtonAction } | null {
  const match = /^ap:([0-9a-f-]{36}):(aprovar|editar|recusar)$/.exec(id);
  return match ? { approvalId: match[1]!, action: match[2] as ApprovalButtonAction } : null;
}
