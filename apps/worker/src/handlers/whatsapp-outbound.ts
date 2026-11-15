import { errorMessage } from '@givance/core';
import { assertOk, ownerWhatsAppChannel, unwrapMaybe, type QueueMessage } from '@givance/db';
import { approvalButtonId, WhatsAppError, type SendResult } from '@givance/integrations';
import { DeferError, PermanentError } from '../consumer';
import type { WhatsAppDeps, WorkerDeps } from '../deps';
import { parseMessage, whatsappOutboundMessage } from '../messages';
import { activeConversation, quietDelaySeconds, windowOpen } from '../whatsapp/horario';

interface Canal {
  id: string;
  address_e164: string;
  last_inbound_at: string | null;
  quiet_hours: unknown;
}

/** Texto curto para parâmetro de template (sem quebras, até 900 caracteres). */
function resumoUmaLinha(texto: string): string {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  return limpo.length > 900 ? `${limpo.slice(0, 899)}…` : limpo;
}

function formatarExpiracao(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/**
 * Envia texto livre se a janela de 24h estiver aberta; senão (ou se o WhatsApp disser que
 * fechou), usa o template de aviso, que é o único permitido fora da janela.
 */
async function enviarComJanela(
  wa: WhatsAppDeps,
  canal: Canal,
  texto: string,
  now: Date,
): Promise<SendResult> {
  const template = () =>
    wa.client.sendTemplate(canal.address_e164, {
      name: wa.templates.aviso,
      language: wa.templates.idioma,
      bodyParams: [resumoUmaLinha(texto)],
    });
  if (!windowOpen(canal.last_inbound_at, now)) {
    return template();
  }
  try {
    return await wa.client.sendText(canal.address_e164, texto);
  } catch (error) {
    if (error instanceof WhatsAppError && error.windowClosed) return template();
    throw error;
  }
}

/** Erros do WhatsApp: temporários voltam à fila; definitivos viram PermanentError. */
function classificar(error: unknown): never {
  if (error instanceof WhatsAppError && !error.retryable) {
    throw new PermanentError(error.message);
  }
  throw error;
}

export function createWhatsAppOutboundHandler(deps: WorkerDeps) {
  const { db } = deps;

  async function timezoneDe(orgId: string): Promise<string> {
    const org = unwrapMaybe(
      'empresa: fuso',
      await db.from('organizations').select('timezone').eq('id', orgId).maybeSingle(),
    );
    return org?.timezone ?? 'America/Sao_Paulo';
  }

  async function canalPorId(orgId: string, channelId: string): Promise<Canal | null> {
    return unwrapMaybe(
      'canal: ler',
      await db
        .from('channels')
        .select('id, address_e164, last_inbound_at, quiet_hours')
        .eq('org_id', orgId)
        .eq('id', channelId)
        .not('verified_at', 'is', null)
        .maybeSingle(),
    );
  }

  /** Fora de uma conversa ativa, respeita o horário de silêncio do dono. */
  function adiarSeSilencio(canal: Canal, timezone: string, now: Date) {
    if (activeConversation(canal.last_inbound_at, now)) return;
    const atraso = quietDelaySeconds(canal.quiet_hours, timezone, now);
    if (atraso > 0) throw new DeferError(atraso);
  }

  async function entregarMensagem(orgId: string, messageId: string, wa: WhatsAppDeps, now: Date) {
    const msg = unwrapMaybe(
      'mensagem: ler',
      await db
        .from('messages')
        .select('id, content, delivery_status, conversation_id')
        .eq('org_id', orgId)
        .eq('id', messageId)
        .maybeSingle(),
    );
    if (!msg || msg.delivery_status !== 'pendente') return;

    const falhar = async (motivo: string) =>
      assertOk(
        'mensagem: falha',
        await db
          .from('messages')
          .update({ delivery_status: 'falhou', delivery_error: motivo.slice(0, 2000) })
          .eq('org_id', orgId)
          .eq('id', messageId),
      );

    const conversa = unwrapMaybe(
      'mensagem: conversa',
      await db
        .from('conversations')
        .select('channel, channel_id')
        .eq('org_id', orgId)
        .eq('id', msg.conversation_id)
        .maybeSingle(),
    );
    const canal = conversa?.channel_id ? await canalPorId(orgId, conversa.channel_id) : null;
    if (!canal) {
      await falhar('Conversa sem WhatsApp verificado.');
      return;
    }

    adiarSeSilencio(canal, await timezoneDe(orgId), now);
    let enviado: SendResult;
    try {
      enviado = await enviarComJanela(wa, canal, msg.content, now);
    } catch (error) {
      if (error instanceof WhatsAppError && !error.retryable) {
        await falhar(error.message);
        return;
      }
      throw error;
    }
    assertOk(
      'mensagem: enviada',
      await db
        .from('messages')
        .update({
          delivery_status: 'enviada',
          external_id: enviado.messageId,
          delivery_error: null,
        })
        .eq('org_id', orgId)
        .eq('id', messageId),
    );
  }

  async function avisarAprovacao(orgId: string, approvalId: string, wa: WhatsAppDeps, now: Date) {
    const ap = unwrapMaybe(
      'aprovação: ler',
      await db
        .from('approvals')
        .select(
          'id, task_id, status, autonomy_level, preview, reason, expires_at, preview_message_id',
        )
        .eq('org_id', orgId)
        .eq('id', approvalId)
        .maybeSingle(),
    );
    if (!ap || ap.status !== 'pendente' || ap.preview_message_id) return;

    // Prefere o número da conversa da tarefa; senão, o do dono usado mais recentemente.
    const tarefa = unwrapMaybe(
      'aprovação: tarefa',
      await db
        .from('tasks')
        .select('conversation_id')
        .eq('org_id', orgId)
        .eq('id', ap.task_id)
        .maybeSingle(),
    );
    let canal: Canal | null = null;
    if (tarefa?.conversation_id) {
      const conversa = unwrapMaybe(
        'aprovação: conversa',
        await db
          .from('conversations')
          .select('channel_id')
          .eq('org_id', orgId)
          .eq('id', tarefa.conversation_id)
          .maybeSingle(),
      );
      if (conversa?.channel_id) canal = await canalPorId(orgId, conversa.channel_id);
    }
    canal ??= await ownerWhatsAppChannel(db, orgId);
    if (!canal) return; // Sem WhatsApp: a aprovação fica só no painel.

    const timezone = await timezoneDe(orgId);
    adiarSeSilencio(canal, timezone, now);

    const preview = (ap.preview ?? {}) as {
      titulo?: string;
      resumo?: string;
      campos?: Array<{ rotulo: string; valor: string }>;
      botao_aprovar?: string;
    };
    const titulo = preview.titulo ?? 'Ação aguardando sua decisão';

    let enviado: SendResult;
    try {
      if (ap.autonomy_level === 'sempre_aprovar') {
        enviado = await enviarComJanela(
          wa,
          canal,
          `Uma ação precisa da sua aprovação no painel: ${titulo}.`,
          now,
        );
      } else if (!windowOpen(canal.last_inbound_at, now)) {
        // Fora da janela não dá para mandar botões: avisa por template e reenvia a prévia
        // quando o dono responder (ver o handler de entrada).
        await wa.client.sendTemplate(canal.address_e164, {
          name: wa.templates.confirmacao,
          language: wa.templates.idioma,
          bodyParams: [resumoUmaLinha(titulo)],
        });
        return;
      } else {
        const linhas = [`*${titulo}*`];
        if (preview.resumo) linhas.push('', preview.resumo);
        for (const campo of preview.campos ?? []) linhas.push(`${campo.rotulo}: ${campo.valor}`);
        if (ap.reason) linhas.push('', `Motivo: ${ap.reason}`);
        linhas.push('', `Vale até ${formatarExpiracao(ap.expires_at, timezone)}.`);
        enviado = await wa.client.sendButtons(canal.address_e164, {
          body: linhas.join('\n'),
          buttons: [
            { id: approvalButtonId(ap.id, 'aprovar'), title: preview.botao_aprovar ?? 'Aprovar' },
            { id: approvalButtonId(ap.id, 'editar'), title: 'Editar' },
            { id: approvalButtonId(ap.id, 'recusar'), title: 'Recusar' },
          ],
        });
      }
    } catch (error) {
      classificar(error);
    }
    assertOk(
      'aprovação: prévia enviada',
      await db
        .from('approvals')
        .update({ preview_message_id: enviado.messageId })
        .eq('org_id', orgId)
        .eq('id', approvalId),
    );
  }

  return async function handleWhatsAppOutbound(message: QueueMessage): Promise<void> {
    const wa = deps.whatsapp;
    if (!wa) throw new PermanentError('Canal WhatsApp não configurado no worker.');
    const body = parseMessage(whatsappOutboundMessage, message.message);
    const now = deps.now?.() ?? new Date();
    try {
      if (body.type === 'message.deliver') {
        await entregarMensagem(body.org_id, body.message_id, wa, now);
      } else {
        await avisarAprovacao(body.org_id, body.approval_id, wa, now);
      }
    } catch (error) {
      if (!(error instanceof DeferError)) {
        deps.logger.warn('Falha no envio pelo WhatsApp', { erro: errorMessage(error) });
      }
      throw error;
    }
  };
}
