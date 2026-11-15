import { randomUUID } from 'node:crypto';
import { errorMessage } from '@givance/core';
import {
  assertOk,
  unwrap,
  unwrapMaybe,
  whatsappConversation,
  type QueueMessage,
} from '@givance/db';
import { parseApprovalButtonId, parseWebhook, type InboundMessage } from '@givance/integrations';
import { PermanentError } from '../consumer';
import type { WhatsAppDeps, WorkerDeps } from '../deps';
import { parseMessage, whatsappInboundMessage } from '../messages';
import { imageInfo } from '../instagram/imagem';

const CODIGO = /^\s*(?:givance\s*)?(\d{6})\s*$/i;

const EXTENSOES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
};

interface CanalVerificado {
  id: string;
  org_id: string;
  user_id: string;
  pending_edit_approval_id: string | null;
}

/** Mensagem curta do erro do banco, sem o prefixo técnico da operação. */
function motivo(error: unknown): string {
  const texto = errorMessage(error);
  const i = texto.indexOf(': ');
  return i >= 0 ? texto.slice(i + 2) : texto;
}

/**
 * Processa o que chega no número da Givance:
 * - código de 6 dígitos: confirma o número do dono;
 * - botão de uma prévia: aprova, recusa ou pede edição;
 * - texto depois de "Editar": vira a observação da edição;
 * - texto ou foto: vira uma tarefa para o funcionário.
 * Números não verificados só recebem a orientação de como ligar o WhatsApp.
 */
export function createWhatsAppInboundHandler(deps: WorkerDeps) {
  const { db } = deps;

  async function responder(wa: WhatsAppDeps, para: string, texto: string, citar?: string) {
    await wa.client
      .sendText(para, texto, citar ? { replyTo: citar } : {})
      .catch((error) =>
        deps.logger.warn('Falha ao responder no WhatsApp', { erro: errorMessage(error) }),
      );
  }

  async function canalVerificado(numero: string): Promise<CanalVerificado | null> {
    const canais = unwrapMaybe(
      'canal: por número',
      await db
        .from('channels')
        .select('id, org_id, user_id, pending_edit_approval_id')
        .eq('kind', 'whatsapp')
        .eq('address_e164', numero)
        .not('verified_at', 'is', null)
        .order('last_inbound_at', { ascending: false, nullsFirst: false })
        .limit(1),
    );
    return canais?.[0] ?? null;
  }

  /** Reenvia as prévias que ficaram sem botões porque a janela de 24h estava fechada. */
  async function reenviarPrevias(orgId: string) {
    const pendentes = unwrapMaybe(
      'aprovações: sem prévia',
      await db
        .from('approvals')
        .select('id')
        .eq('org_id', orgId)
        .eq('status', 'pendente')
        .eq('autonomy_level', 'confirmar')
        .is('preview_message_id', null)
        .gt('expires_at', new Date().toISOString()),
    );
    for (const ap of pendentes ?? []) {
      assertOk(
        'aprovação: reenviar prévia',
        await db.rpc('queue_send', {
          p_queue: 'whatsapp_saida',
          p_message: { type: 'approval.notify', approval_id: ap.id, org_id: orgId },
          p_delay_seconds: 0,
        }),
      );
    }
  }

  async function decidir(
    wa: WhatsAppDeps,
    msg: InboundMessage,
    canal: CanalVerificado,
    buttonId: string,
  ) {
    const botao = parseApprovalButtonId(buttonId);
    if (!botao) {
      await responder(
        wa,
        msg.from,
        'Não reconheci esse botão. Se precisar, veja as pendências no painel.',
      );
      return;
    }
    const ap = unwrapMaybe(
      'aprovação: ler',
      await db
        .from('approvals')
        .select('id, preview')
        .eq('org_id', canal.org_id)
        .eq('id', botao.approvalId)
        .maybeSingle(),
    );
    if (!ap) {
      await responder(wa, msg.from, 'Não encontrei essa aprovação.');
      return;
    }
    if (botao.action === 'editar') {
      assertOk(
        'canal: edição pendente',
        await db.from('channels').update({ pending_edit_approval_id: ap.id }).eq('id', canal.id),
      );
      await responder(wa, msg.from, 'O que você quer mudar? Responda aqui e eu ajusto.', msg.id);
      return;
    }
    try {
      unwrap(
        'aprovação: decidir',
        await db.rpc('decide_approval_as', {
          p_user_id: canal.user_id,
          p_approval_id: ap.id,
          p_decision: botao.action,
          p_note: botao.action === 'recusar' ? 'Recusado pelo WhatsApp.' : undefined,
        }),
      );
      await responder(
        wa,
        msg.from,
        botao.action === 'aprovar'
          ? 'Aprovado. Já vou executar e te aviso.'
          : 'Certo, não vou fazer.',
        msg.id,
      );
    } catch (error) {
      await responder(wa, msg.from, `Não deu para registrar: ${motivo(error)}.`, msg.id);
    }
  }

  async function edicao(
    wa: WhatsAppDeps,
    msg: InboundMessage & { kind: 'texto' },
    canal: CanalVerificado,
  ) {
    const approvalId = canal.pending_edit_approval_id!;
    assertOk(
      'canal: limpar edição',
      await db.from('channels').update({ pending_edit_approval_id: null }).eq('id', canal.id),
    );
    try {
      unwrap(
        'aprovação: pedir edição',
        await db.rpc('decide_approval_as', {
          p_user_id: canal.user_id,
          p_approval_id: approvalId,
          p_decision: 'recusar',
          p_note: `Pedido de edição do dono: ${msg.text}`.slice(0, 2000),
        }),
      );
      await responder(wa, msg.from, 'Combinado, vou ajustar e te mando de novo.', msg.id);
    } catch (error) {
      await responder(wa, msg.from, `Não deu para registrar a edição: ${motivo(error)}.`, msg.id);
    }
  }

  async function salvarMidia(
    wa: WhatsAppDeps,
    orgId: string,
    userId: string,
    mediaId: string,
    caption?: string,
  ) {
    const media = await wa.client.downloadMedia(mediaId);
    const caminho = `${orgId}/${randomUUID()}.${EXTENSOES[media.mimeType] ?? 'bin'}`;
    const upload = await db.storage
      .from('midia')
      .upload(caminho, media.data, { contentType: media.mimeType });
    if (upload.error) throw new Error(`Storage: ${upload.error.message}`);
    const dimensoes = media.mimeType.startsWith('image/') ? await imageInfo(media.data) : null;
    const linha = unwrap(
      'mídia: registrar',
      await db
        .from('media_assets')
        .insert({
          org_id: orgId,
          storage_path: caminho,
          mime_type: media.mimeType,
          size_bytes: media.size,
          source: 'whatsapp',
          external_id: mediaId,
          caption: caption ?? null,
          created_by: userId,
          ...(dimensoes ? { width: dimensoes.width, height: dimensoes.height } : {}),
        })
        .select('id')
        .single(),
    );
    return linha.id;
  }

  async function novaTarefa(wa: WhatsAppDeps, msg: InboundMessage, canal: CanalVerificado) {
    const funcionario = unwrapMaybe(
      'funcionário: do canal',
      await db
        .from('employees')
        .select('id')
        .eq('org_id', canal.org_id)
        .neq('status', 'pausado')
        .order('hired_at')
        .limit(1)
        .maybeSingle(),
    );
    if (!funcionario) {
      await responder(
        wa,
        msg.from,
        'Nenhum funcionário ativo nesta empresa para receber o pedido.',
      );
      return;
    }

    let texto = '';
    const midias: string[] = [];
    if (msg.kind === 'texto') texto = msg.text.trim();
    if (msg.kind === 'imagem') {
      texto = msg.caption?.trim() ?? '';
      midias.push(await salvarMidia(wa, canal.org_id, canal.user_id, msg.mediaId, msg.caption));
    }

    const conversa = await whatsappConversation(db, canal.org_id, funcionario.id, canal.id);

    // Resposta citando uma mensagem do funcionário: leva o contexto junto.
    let emRespostaA: string | undefined;
    if (msg.replyTo) {
      const citada = unwrapMaybe(
        'mensagem: citada',
        await db
          .from('messages')
          .select('content')
          .eq('org_id', canal.org_id)
          .eq('external_id', msg.replyTo)
          .limit(1)
          .maybeSingle(),
      );
      emRespostaA = citada?.content;
    }

    const titulo = (
      texto.split('\n')[0] || (midias.length ? 'Pedido com foto' : 'Pedido pelo WhatsApp')
    ).slice(0, 80);
    const tarefa = unwrap(
      'tarefa: criar pelo WhatsApp',
      await db
        .from('tasks')
        .insert({
          org_id: canal.org_id,
          employee_id: funcionario.id,
          conversation_id: conversa,
          title: titulo,
          input: {
            mensagem:
              texto || 'O dono mandou uma foto sem texto. Pergunte o que ele quer fazer com ela.',
            ...(midias.length ? { midias } : {}),
            ...(emRespostaA ? { em_resposta_a: emRespostaA } : {}),
          },
          source: 'whatsapp',
          created_by: canal.user_id,
        })
        .select('id')
        .single(),
    );
    assertOk(
      'mensagem: do dono',
      await db.from('messages').insert({
        org_id: canal.org_id,
        conversation_id: conversa,
        task_id: tarefa.id,
        author: 'dono',
        user_id: canal.user_id,
        content: texto || '[foto]',
        attachments: midias.map((id) => ({ media_id: id })),
        external_id: msg.id,
      }),
    );
  }

  async function processar(wa: WhatsAppDeps, msg: InboundMessage) {
    const novo = unwrap(
      'entrada: deduplicar',
      await db.rpc('whatsapp_inbound_claim', { p_wa_message_id: msg.id }),
    );
    if (!novo) return;

    if (msg.kind === 'texto') {
      const codigo = CODIGO.exec(msg.text)?.[1];
      if (codigo) {
        const confirmado = unwrapMaybe(
          'canal: confirmar código',
          await db.rpc('confirm_channel_verification', { p_address: msg.from, p_code: codigo }),
        );
        const canal = confirmado?.[0];
        if (canal) {
          const org = unwrapMaybe(
            'empresa: nome',
            await db.from('organizations').select('name').eq('id', canal.org_id).maybeSingle(),
          );
          await responder(
            wa,
            msg.from,
            `Pronto! Este WhatsApp agora fala com o funcionário de IA da ${org?.name ?? 'sua empresa'}. ` +
              'Mande seus pedidos por aqui, com foto quando for o caso.',
          );
          return;
        }
      }
    }

    const canal = await canalVerificado(msg.from);
    if (!canal) {
      await responder(
        wa,
        msg.from,
        'Este número ainda não está ligado a nenhuma empresa. Peça o código de verificação no painel ' +
          'do Givance Workforce e envie o código aqui.',
      );
      return;
    }

    assertOk(
      'canal: última mensagem',
      await db
        .from('channels')
        .update({ last_inbound_at: msg.at.toISOString() })
        .eq('id', canal.id),
    );
    await wa.client.markRead(msg.id).catch(() => undefined);

    if (msg.kind === 'botao') {
      await decidir(wa, msg, canal, msg.buttonId);
    } else if (msg.kind === 'texto' && canal.pending_edit_approval_id) {
      await edicao(wa, msg, canal);
    } else if (msg.kind === 'texto' || msg.kind === 'imagem') {
      await novaTarefa(wa, msg, canal);
    } else {
      await responder(
        wa,
        msg.from,
        'Por enquanto eu entendo texto e fotos. Pode me mandar por escrito?',
      );
    }
    await reenviarPrevias(canal.org_id);
  }

  return async function handleWhatsAppInbound(message: QueueMessage): Promise<void> {
    const wa = deps.whatsapp;
    if (!wa) throw new PermanentError('Canal WhatsApp não configurado no worker.');
    const body = parseMessage(whatsappInboundMessage, message.message);
    const { messages, statuses } = parseWebhook(body.payload);

    for (const msg of messages) {
      await processar(wa, msg);
    }
    // Falha de entrega informada pelo WhatsApp: marca a mensagem para aparecer no painel.
    for (const status of statuses.filter((s) => s.status === 'failed')) {
      assertOk(
        'mensagem: falha de entrega',
        await db
          .from('messages')
          .update({ delivery_status: 'falhou', delivery_error: status.error ?? 'Falha de entrega' })
          .eq('external_id', status.messageId),
      );
    }
  };
}
