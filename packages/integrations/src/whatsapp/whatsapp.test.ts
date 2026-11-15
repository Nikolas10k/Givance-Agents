import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { WhatsAppError } from './client';
import { createWhatsAppClient } from './client';
import {
  approvalButtonId,
  parseApprovalButtonId,
  parseWebhook,
  verifyChallenge,
  verifySignature,
} from './webhook';

function fakeFetch(responses: Array<{ status?: number; body: unknown; binary?: Uint8Array }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = responses.shift() ?? { body: {} };
    return {
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      json: async () => r.body,
      arrayBuffer: async () => (r.binary ?? new Uint8Array()).buffer,
    } as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const cfg = { phoneNumberId: '123', accessToken: 'token-de-teste', graphVersion: 'v23.0' };

describe('cliente WhatsApp', () => {
  it('envia botões no formato da Cloud API, cortando títulos longos', async () => {
    const { fn, calls } = fakeFetch([{ body: { messages: [{ id: 'wamid.1' }] } }]);
    const client = createWhatsAppClient({ ...cfg, fetch: fn });
    const r = await client.sendButtons('+5519900000002', {
      body: 'Publicar este post?',
      buttons: [
        { id: 'ap:x:aprovar', title: 'Publicar' },
        { id: 'ap:x:editar', title: 'Editar o texto da legenda agora' },
      ],
    });
    expect(r.messageId).toBe('wamid.1');
    expect(calls[0]!.url).toBe('https://graph.facebook.com/v23.0/123/messages');
    const body = JSON.parse(String(calls[0]!.init!.body));
    expect(body).toMatchObject({
      messaging_product: 'whatsapp',
      to: '5519900000002',
      type: 'interactive',
      interactive: { type: 'button', body: { text: 'Publicar este post?' } },
    });
    expect(body.interactive.action.buttons[1].reply.title).toHaveLength(20);
    expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe(
      'Bearer token-de-teste',
    );
  });

  it('template com parâmetros sem quebras de linha', async () => {
    const { fn, calls } = fakeFetch([{ body: { messages: [{ id: 'wamid.2' }] } }]);
    await createWhatsAppClient({ ...cfg, fetch: fn }).sendTemplate('+5511999990000', {
      name: 'givance_aviso',
      bodyParams: ['linha 1\nlinha 2'],
    });
    const body = JSON.parse(String(calls[0]!.init!.body));
    expect(body.template).toEqual({
      name: 'givance_aviso',
      language: { code: 'pt_BR' },
      components: [{ type: 'body', parameters: [{ type: 'text', text: 'linha 1 linha 2' }] }],
    });
  });

  it('classifica erros: janela fechada, limite (tenta de novo) e erro definitivo', async () => {
    const { fn } = fakeFetch([
      { status: 400, body: { error: { message: 'Re-engagement message', code: 131047 } } },
      { status: 429, body: { error: { message: 'Rate limit', code: 130429 } } },
      { status: 400, body: { error: { message: 'Invalid parameter', code: 100 } } },
    ]);
    const client = createWhatsAppClient({ ...cfg, fetch: fn });
    const erros: WhatsAppError[] = [];
    for (let i = 0; i < 3; i++) {
      await client.sendText('+5511999990000', 'oi').catch((e: WhatsAppError) => erros.push(e));
    }
    expect(erros.map((e) => [e.windowClosed, e.retryable])).toEqual([
      [true, false],
      [false, true],
      [false, false],
    ]);
  });

  it('baixa mídia em dois passos com o token', async () => {
    const { fn, calls } = fakeFetch([
      { body: { url: 'https://lookaside.example/m', mime_type: 'image/jpeg', file_size: 3 } },
      { body: {}, binary: new Uint8Array([1, 2, 3]) },
    ]);
    const media = await createWhatsAppClient({ ...cfg, fetch: fn }).downloadMedia('media-1');
    expect(media).toMatchObject({ mimeType: 'image/jpeg', size: 3 });
    expect(calls.map((c) => c.url)).toEqual([
      'https://graph.facebook.com/v23.0/media-1',
      'https://lookaside.example/m',
    ]);
  });
});

describe('webhook', () => {
  it('confere a assinatura com o App Secret', () => {
    const corpo = '{"object":"whatsapp_business_account"}';
    const assinatura = `sha256=${createHmac('sha256', 'segredo').update(corpo).digest('hex')}`;
    expect(verifySignature(corpo, assinatura, 'segredo')).toBe(true);
    expect(verifySignature(corpo + ' ', assinatura, 'segredo')).toBe(false);
    expect(verifySignature(corpo, assinatura, 'outro')).toBe(false);
    expect(verifySignature(corpo, null, 'segredo')).toBe(false);
  });

  it('responde ao desafio só com o token certo', () => {
    const ok = new URLSearchParams({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'tk',
      'hub.challenge': '42',
    });
    expect(verifyChallenge(ok, 'tk')).toBe('42');
    expect(verifyChallenge(ok, 'outro')).toBeNull();
  });

  it('interpreta texto, foto, botão, resposta citando mensagem e status', () => {
    const evento = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                messages: [
                  {
                    id: 'w1',
                    from: '5519900000002',
                    timestamp: '1763200000',
                    type: 'text',
                    text: { body: 'posta amanhã' },
                    context: { id: 'wOut' },
                  },
                  {
                    id: 'w2',
                    from: '5519900000002',
                    type: 'image',
                    image: { id: 'm1', mime_type: 'image/jpeg', caption: 'essa' },
                  },
                  {
                    id: 'w3',
                    from: '5519900000002',
                    type: 'interactive',
                    interactive: {
                      type: 'button_reply',
                      button_reply: { id: 'ap:1:aprovar', title: 'Aprovar' },
                    },
                  },
                  { id: 'w4', from: '5519900000002', type: 'sticker', sticker: {} },
                ],
                statuses: [
                  {
                    id: 'wOut',
                    status: 'failed',
                    recipient_id: '5519900000002',
                    errors: [{ message: 'falhou' }],
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const { messages, statuses } = parseWebhook(evento);
    expect(messages.map((m) => m.kind)).toEqual(['texto', 'imagem', 'botao', 'outro']);
    expect(messages[0]).toMatchObject({
      from: '+5519900000002',
      text: 'posta amanhã',
      replyTo: 'wOut',
    });
    expect(messages[0]!.at.toISOString()).toBe('2025-11-15T09:46:40.000Z');
    expect(messages[1]).toMatchObject({ mediaId: 'm1', caption: 'essa' });
    expect(statuses).toEqual([
      { messageId: 'wOut', status: 'failed', recipient: '+5519900000002', error: 'falhou' },
    ]);
    expect(parseWebhook({ lixo: true })).toEqual({ messages: [], statuses: [] });
  });

  it('ids dos botões de aprovação', () => {
    const id = '7f1d2c3b-1111-4222-8333-944455556666';
    expect(parseApprovalButtonId(approvalButtonId(id, 'editar'))).toEqual({
      approvalId: id,
      action: 'editar',
    });
    expect(parseApprovalButtonId('ap:qualquer:aprovar')).toBeNull();
  });
});
