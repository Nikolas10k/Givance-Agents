# Checklist da Fase 1c: Instagram

O código da 1c está pronto e testado com uma API do Instagram simulada. Para publicar de verdade, falta ligar o app da Meta ao Instagram e conectar a conta da empresa no painel.

## O que a 1c entrega

- **Conexão do Instagram no painel** (menu Instagram): login do próprio Instagram, sem precisar de página do Facebook. O token fica no Supabase Vault e é renovado sozinho pelo worker antes de vencer (60 dias).
- **Banco de mídia:** fotos e vídeos que você manda no WhatsApp entram sozinhos, com as dimensões; no painel dá para enviar arquivos maiores (foto até 15 MB, vídeo até 50 MB).
- **Agentes:**
  - `social` lista as mídias, lê os posts e as métricas recentes e prepara o post;
  - `copywriter` confere a legenda com `politica_checar_texto`;
  - `criativo` escolhe as mídias e o recorte.
- **Prévia no WhatsApp com a foto** e os botões Publicar (ou Agendar), Editar e Recusar.
- **Publicação:**
  - feed, carrossel, reels e story;
  - recorte automático em JPEG (4:5, 1:1, 9:16 ou original), mantendo o assunto principal;
  - **agendamento** (a API não agenda: o worker segura a ação aprovada até o horário);
  - link do post para você no fim.
- **Proteções:**
  - termos que a empresa não usa e promessas vetadas do setor (ex.: saúde) bloqueiam o post;
  - limites do Instagram (2.200 caracteres, 30 hashtags, formato x mídia) são conferidos antes de você ver a prévia;
  - só o cargo com `instagram.publicar` pode pedir;
  - uma queda no meio da publicação não gera post duplicado;
  - token revogado marca a conexão para reconectar.

## 1. App da Meta: produto Instagram

- [ ] Em [developers.facebook.com](https://developers.facebook.com/apps), no app da Givance (tipo **Business**), adicionar o produto **Instagram** e escolher **API setup with Instagram login**.
- [ ] Em **Instagram > API setup with Instagram login > Business login settings**, cadastrar a URL de retorno:
  `https://<seu-painel>/api/instagram/callback` (exatamente igual ao `NEXT_PUBLIC_SITE_URL` + `/api/instagram/callback`).
- [ ] Anotar o **Instagram App ID** e o **Instagram App Secret** que aparecem nessa mesma tela. **Atenção:** são diferentes do App ID/App Secret do app do Facebook.
- [ ] Permissões usadas: `instagram_business_basic` e `instagram_business_content_publish`.

## 2. Modo de desenvolvimento (antes do App Review)

Enquanto o app não passa pela revisão da Meta (Fase 3), só contas cadastradas como testadoras conseguem conectar:

- [ ] Em **App roles > Roles > Instagram testers**, adicionar o @ da conta do Instagram da empresa.
- [ ] No app do Instagram dessa conta: **Configurações > Apps e sites > Convites de testador** e aceitar.
- [ ] A conta precisa ser **profissional** (empresa ou criador). Conta pessoal não publica pela API: no app do Instagram, **Configurações > Tipo de conta e ferramentas > Mudar para conta profissional**.

## 3. Variáveis de ambiente

- [ ] Vercel (painel):
  - `INSTAGRAM_APP_ID` (Instagram App ID do passo 1)
  - `INSTAGRAM_APP_SECRET` (Instagram App Secret do passo 1; só no servidor)
  - `SUPABASE_SECRET_KEY` (já configurada na 1b; o painel usa para gravar a conexão e o token)
- [ ] Worker: nada novo é obrigatório. O token vem da conexão. Opcional: `INSTAGRAM_GRAPH_VERSION` (padrão `v23.0`).

## 4. Banco

- [ ] Aplicar a migration `20261117000100_instagram.sql` no projeto de produção (tabela `social_posts`, dimensões das mídias).

## 5. Teste de aceite

- [ ] No painel, menu **Instagram > Conectar Instagram**, autorizar e voltar com "Instagram conectado".
- [ ] No WhatsApp: mandar uma foto com a legenda *"posta essa foto amanhã às 18h falando da promoção"*.
- [ ] Receber a prévia com a foto, o texto e o botão **Agendar**; tocar em Agendar.
- [ ] Receber a confirmação do agendamento. No painel, o post aparece como **Agendado**.
- [ ] No dia seguinte, às 18h, o post é publicado e o link chega no WhatsApp; no painel, **Publicado** com "Ver no Instagram".
- [ ] Repetir com *"posta agora"* e um carrossel de 3 fotos.

## Limites conhecidos

- O Instagram permite até 100 publicações pela API a cada 24h por conta; acima disso, o post espera e é tentado de novo.
- Vídeos não são convertidos: reels precisa de MP4/MOV (H.264, até 15 min, 9:16 recomendado). Vídeos enviados pelo WhatsApp chegam comprimidos; para reels, prefira o envio pelo painel.
- Texto sobre a imagem não é aplicado pelo sistema: o criativo sugere, e você coloca antes de enviar a foto.
- Os agentes não veem a imagem; escolhem pela sua descrição, pela legenda que você mandou e pelas dimensões. Descreva a foto em uma frase quando importar.
