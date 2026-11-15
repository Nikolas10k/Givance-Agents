import { verifyChallenge, verifySignature } from '@givance/integrations';
import { NextResponse, type NextRequest } from 'next/server';
import { serviceClient } from '@/server/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Verificação do webhook pela Meta (feita uma vez, ao configurar o app). */
export function GET(request: NextRequest) {
  const challenge = verifyChallenge(
    request.nextUrl.searchParams,
    process.env.WHATSAPP_VERIFY_TOKEN ?? '',
  );
  return challenge === null
    ? new NextResponse('Token inválido', { status: 403 })
    : new NextResponse(challenge, { status: 200, headers: { 'content-type': 'text/plain' } });
}

/**
 * Eventos do WhatsApp. Só confere a assinatura e coloca o evento na fila "whatsapp_entrada";
 * o worker faz o resto. Responder rápido evita reenvios da Meta.
 */
export async function POST(request: NextRequest) {
  const corpo = await request.text();
  const assinatura = request.headers.get('x-hub-signature-256');
  if (!verifySignature(corpo, assinatura, process.env.WHATSAPP_APP_SECRET ?? '')) {
    return new NextResponse('Assinatura inválida', { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(corpo);
  } catch {
    return new NextResponse('JSON inválido', { status: 400 });
  }

  const { error } = await serviceClient().rpc('queue_send', {
    p_queue: 'whatsapp_entrada',
    p_message: { type: 'webhook', payload } as never,
    p_delay_seconds: 0,
  });
  if (error) {
    // 500 faz a Meta tentar de novo mais tarde.
    return new NextResponse('Falha ao enfileirar', { status: 500 });
  }
  return new NextResponse('ok', { status: 200 });
}
