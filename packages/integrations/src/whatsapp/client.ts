/**
 * Cliente mínimo da WhatsApp Cloud API (Graph API da Meta), só com o que o canal do dono usa:
 * texto, botões de resposta, template, imagem, mídia recebida e confirmação de leitura.
 */

export interface WhatsAppConfig {
  phoneNumberId: string;
  accessToken: string;
  /** Versão da Graph API, ex.: v23.0. */
  graphVersion?: string;
  fetch?: typeof fetch;
  baseUrl?: string;
}

/** Códigos de erro da Cloud API que tratamos de forma específica. */
export const WHATSAPP_ERRORS = {
  /** Fora da janela de 24h: só template. */
  JANELA_FECHADA: 131047,
  /** Limite de envio. */
  LIMITE: 130429,
  LIMITE_PAR: 131056,
} as const;

export class WhatsAppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: number | undefined,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'WhatsAppError';
  }

  get windowClosed(): boolean {
    return this.code === WHATSAPP_ERRORS.JANELA_FECHADA;
  }
}

export interface ReplyButton {
  id: string;
  title: string;
}

export interface SendResult {
  messageId: string;
}

const LIMITES = {
  texto: 4096,
  corpoBotoes: 1024,
  tituloBotao: 20,
  idBotao: 256,
  rodape: 60,
  legenda: 1024,
};

function cortar(texto: string, max: number): string {
  return texto.length <= max ? texto : `${texto.slice(0, max - 1)}…`;
}

/** +5519999990000 -> 5519999990000 (formato que a API espera em "to"). */
export function toWaId(e164: string): string {
  return e164.replace(/[^0-9]/g, '');
}

/** 5519999990000 -> +5519999990000. */
export function fromWaId(waId: string): string {
  return `+${waId.replace(/[^0-9]/g, '')}`;
}

export function createWhatsAppClient(config: WhatsAppConfig) {
  const doFetch = config.fetch ?? fetch;
  const base = `${config.baseUrl ?? 'https://graph.facebook.com'}/${config.graphVersion ?? 'v23.0'}`;
  const auth = { Authorization: `Bearer ${config.accessToken}` };

  async function request(url: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await doFetch(url, { ...init, headers: { ...auth, ...(init.headers ?? {}) } });
    } catch (error) {
      throw new WhatsAppError(
        `Falha de rede ao falar com o WhatsApp: ${String(error)}`,
        0,
        undefined,
        true,
      );
    }
    const body = (await response.json().catch(() => ({}))) as {
      error?: { message?: string; code?: number };
    };
    if (!response.ok || body.error) {
      const code = body.error?.code;
      const retryable =
        response.status === 429 ||
        response.status >= 500 ||
        code === WHATSAPP_ERRORS.LIMITE ||
        code === WHATSAPP_ERRORS.LIMITE_PAR;
      throw new WhatsAppError(
        `WhatsApp recusou o pedido (${response.status}${code ? `, código ${code}` : ''}): ${body.error?.message ?? 'sem detalhes'}`,
        response.status,
        code,
        retryable,
      );
    }
    return body;
  }

  async function send(
    to: string,
    message: Record<string, unknown>,
    replyTo?: string,
  ): Promise<SendResult> {
    const body = (await request(`${base}/${config.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: toWaId(to),
        ...(replyTo ? { context: { message_id: replyTo } } : {}),
        ...message,
      }),
    })) as { messages?: Array<{ id?: string }> };
    const id = body.messages?.[0]?.id;
    if (!id) {
      throw new WhatsAppError('Resposta do WhatsApp sem id da mensagem.', 200, undefined, false);
    }
    return { messageId: id };
  }

  return {
    sendText(to: string, text: string, options: { replyTo?: string } = {}) {
      return send(
        to,
        { type: 'text', text: { body: cortar(text, LIMITES.texto), preview_url: false } },
        options.replyTo,
      );
    },

    /** Mensagem com até 3 botões de resposta (o dono toca e a resposta volta pelo webhook). */
    sendButtons(
      to: string,
      input: {
        body: string;
        buttons: ReplyButton[];
        footer?: string;
        headerImageUrl?: string;
        headerText?: string;
      },
      options: { replyTo?: string } = {},
    ) {
      if (input.buttons.length < 1 || input.buttons.length > 3) {
        throw new Error('Mensagens com botões aceitam de 1 a 3 botões.');
      }
      const header = input.headerImageUrl
        ? { type: 'image', image: { link: input.headerImageUrl } }
        : input.headerText
          ? { type: 'text', text: cortar(input.headerText, 60) }
          : undefined;
      return send(
        to,
        {
          type: 'interactive',
          interactive: {
            type: 'button',
            ...(header ? { header } : {}),
            body: { text: cortar(input.body, LIMITES.corpoBotoes) },
            ...(input.footer ? { footer: { text: cortar(input.footer, LIMITES.rodape) } } : {}),
            action: {
              buttons: input.buttons.map((b) => ({
                type: 'reply',
                reply: {
                  id: b.id.slice(0, LIMITES.idBotao),
                  title: cortar(b.title, LIMITES.tituloBotao),
                },
              })),
            },
          },
        },
        options.replyTo,
      );
    },

    /** Template aprovado na Meta (necessário fora da janela de 24h). */
    sendTemplate(to: string, input: { name: string; language?: string; bodyParams?: string[] }) {
      const params = input.bodyParams ?? [];
      return send(to, {
        type: 'template',
        template: {
          name: input.name,
          language: { code: input.language ?? 'pt_BR' },
          ...(params.length > 0
            ? {
                components: [
                  {
                    type: 'body',
                    // Parâmetros de template não aceitam quebra de linha nem tabulação.
                    parameters: params.map((p) => ({
                      type: 'text',
                      text: cortar(p.replace(/\s+/g, ' ').trim(), 1000),
                    })),
                  },
                ],
              }
            : {}),
        },
      });
    },

    sendImage(to: string, input: { link: string; caption?: string }) {
      return send(to, {
        type: 'image',
        image: {
          link: input.link,
          ...(input.caption ? { caption: cortar(input.caption, LIMITES.legenda) } : {}),
        },
      });
    },

    async markRead(messageId: string): Promise<void> {
      await request(`${base}/${config.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId,
        }),
      });
    },

    /** Baixa uma mídia recebida (foto, vídeo) pelo id do webhook. */
    async downloadMedia(
      mediaId: string,
    ): Promise<{ data: Uint8Array; mimeType: string; size: number }> {
      const info = (await request(`${base}/${mediaId}`, { method: 'GET' })) as {
        url?: string;
        mime_type?: string;
        file_size?: number;
      };
      if (!info.url) {
        throw new WhatsAppError('Mídia sem URL de download.', 200, undefined, false);
      }
      let response: Response;
      try {
        response = await doFetch(info.url, { headers: auth });
      } catch (error) {
        throw new WhatsAppError(
          `Falha de rede ao baixar a mídia: ${String(error)}`,
          0,
          undefined,
          true,
        );
      }
      if (!response.ok) {
        throw new WhatsAppError(
          `Falha ao baixar a mídia (${response.status}).`,
          response.status,
          undefined,
          response.status >= 500,
        );
      }
      const data = new Uint8Array(await response.arrayBuffer());
      return {
        data,
        mimeType: info.mime_type ?? 'application/octet-stream',
        size: data.byteLength,
      };
    },
  };
}

export type WhatsAppClient = ReturnType<typeof createWhatsAppClient>;
