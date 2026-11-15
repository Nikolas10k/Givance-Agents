# Checklist da Fase 1b: canal WhatsApp

O código da 1b está pronto e testado com um WhatsApp simulado. Para funcionar de verdade, falta ligar o número da Givance na Meta.

## 1. Número da Givance na WhatsApp Cloud API

- [ ] No Business Manager da Givance, criar uma **conta do WhatsApp Business (WABA)** e adicionar um número dedicado ao assistente (que não esteja em uso no app comum do WhatsApp).
- [ ] No app da Meta for Developers (o mesmo da Fase 1a), adicionar o produto **WhatsApp**.
- [ ] Criar um **usuário do sistema** no Business Manager com acesso ao app e à WABA, e gerar um **token permanente** com as permissões `whatsapp_business_messaging` e `whatsapp_business_management`.
- [ ] Anotar o **Phone Number ID** (não é o número de telefone; aparece em WhatsApp > API Setup).
- [ ] Cadastrar uma forma de pagamento na WABA (mensagens iniciadas pela empresa são cobradas).

## 2. Webhook

- [ ] Gerar um token de verificação qualquer (ex.: `openssl rand -hex 16`).
- [ ] Em **WhatsApp > Configuration > Webhook**: URL `https://<seu-painel>/api/whatsapp/webhook`, o token acima, e assinar o campo **messages**.
- [ ] Na Vercel (painel), adicionar as variáveis:
  - `SUPABASE_SECRET_KEY` (secret key do Supabase; só no servidor)
  - `WHATSAPP_APP_SECRET` (App Secret em App settings > Basic)
  - `WHATSAPP_VERIFY_TOKEN` (o token acima)
  - `NEXT_PUBLIC_WHATSAPP_NUMERO_GIVANCE` (o número no formato +55 11 9xxxx-xxxx)
- [ ] No Fly (worker): `fly secrets set WHATSAPP_PHONE_NUMBER_ID=... WHATSAPP_ACCESS_TOKEN=...`

## 3. Templates (mensagens fora da janela de 24h)

Em **WhatsApp Manager > Message templates**, criar estes dois, categoria **Utility**, idioma **Portuguese (BR)**. Os nomes precisam ser exatamente estes (ou mude as variáveis `WHATSAPP_TEMPLATE_*` do worker).

**`givance_aviso`**
```
Aviso do seu funcionário de IA: {{1}}

Responda esta mensagem para continuar a conversa.
```

**`givance_confirmacao`**
```
Uma ação está esperando sua confirmação: {{1}}.

Responda qualquer mensagem para receber a prévia com os botões.
```

A aprovação costuma levar de minutos a um dia.

## 4. Ligar o seu número

- [ ] No painel, menu **WhatsApp**: informe seu número, gere o código e envie `GIVANCE <código>` para o número da Givance.
- [ ] A resposta "Pronto!" confirma. A partir daí, mande pedidos por lá (para posts, a foto com o pedido na legenda).
- [ ] Opcional: horário de silêncio. Por enquanto, via SQL:
  `update channels set quiet_hours = '{"inicio":"22:00","fim":"07:00"}' where address_e164 = '+55...';`
  (a edição pelo painel entra na etapa 1g).

## Como o canal se comporta

- **Pedido em texto ou foto:** vira uma tarefa para o funcionário; a resposta volta pelo WhatsApp.
- **Prévia de ação:** chega com os botões Aprovar, Editar e Recusar. Em Editar, a sua próxima mensagem vira o pedido de ajuste. Ações que gastam dinheiro só são aprovadas no painel.
- **Janela de 24h:** dentro dela, mensagens livres; fora dela, os templates acima. Uma prévia que não pôde ser enviada fora da janela chega assim que você responder.
- **Horário de silêncio:** avisos nesse horário esperam o fim dele, exceto quando você está conversando com o funcionário naquele momento.
- **Fotos:** ficam no Storage da empresa (bucket privado `midia`) e são apagadas junto com a empresa.

## Limitações conhecidas

- **Álbum de fotos:** cada foto vira uma tarefa separada. Mande uma foto por pedido, com o pedido na legenda.
- **Áudio:** ainda não é entendido; o funcionário pede o pedido por escrito.
- **Mesmo número em duas empresas:** vale a empresa em que o número foi usado por último.
