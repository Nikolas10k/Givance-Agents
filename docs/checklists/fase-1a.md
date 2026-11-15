# Checklist da Fase 1a: o que você precisa configurar

Para usar a fundação fora da sua máquina. Nada aqui é necessário para rodar localmente (veja o README).

## 1. Supabase (produção)

- [ ] Criar o projeto no Supabase (região São Paulo, `sa-east-1`). Guarde a senha do banco num gerenciador de senhas.
- [ ] Em **Integrations**, ativar **Queues** (pgmq) e **Cron** (pg_cron). A extensão `vector` é criada pela própria migration.
- [ ] Ligar o repositório ao projeto e aplicar as migrations:
  ```bash
  pnpm exec supabase login
  pnpm exec supabase link --project-ref <ref-do-projeto>
  pnpm exec supabase db push        # só migrations; não use --include-seed (o seed é fictício)
  ```
- [ ] Publicar os cargos:
  ```bash
  SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=<secret key> pnpm roles:publish
  ```
- [ ] Em **Authentication > Sign In / Providers**: e-mail ligado, **cadastro desligado** ("Allow new users to sign up" desmarcado).
- [ ] Em **Authentication > URL Configuration**: *Site URL* com o endereço do painel (ex.: `https://painel.givance.com.br`) e, em *Redirect URLs*, `https://painel.givance.com.br/auth/callback`.
- [ ] Em **Authentication > Emails > Magic Link**: assunto "Seu link de acesso ao Givance Workforce" e o corpo de [supabase/templates/magic_link.html](../../supabase/templates/magic_link.html).
- [ ] Em **Authentication > Emails > SMTP**: configurar um provedor (Resend ou Postmark). O envio padrão do Supabase tem limite baixo e não serve para produção.
- [ ] Criar a sua empresa e o seu acesso:
  1. **Authentication > Users > Add user > Create new user** com o seu e-mail e "Auto Confirm User" marcado (a senha não é usada: o acesso é pelo link de acesso do painel).
  2. No **SQL Editor**, troque os valores e rode:
     ```sql
     with org as (
       insert into organizations (name, slug) values ('Givance Tech', 'givance') returning id
     )
     insert into memberships (org_id, user_id, role)
     select org.id, u.id, 'owner' from org, auth.users u where u.email = 'SEU-EMAIL';

     select public.hire_employee(
       (select id from organizations where slug = 'givance'), 'braco-direito', 1, 'Braço Direito'
     );
     ```
  3. Para ver todas as empresas como admin da Givance: em **Authentication > Users**, no seu usuário, adicione `"givance_admin": true` ao *app metadata* (via SQL: `update auth.users set raw_app_meta_data = raw_app_meta_data || '{"givance_admin": true}' where email = 'SEU-EMAIL';`).

## 2. Anthropic

- [ ] Criar uma chave em [console.anthropic.com](https://console.anthropic.com) (API Keys), só para o worker.
- [ ] Definir um limite mensal de gasto no Console (Billing > Limits). O worker também respeita o teto por tarefa de cada cargo e o teto mensal por empresa (`organizations.monthly_cost_cap_usd`).
- [ ] Opcional, recomendado: rodar o spike com a chave e mandar o resultado para eu ajustar prompts e concorrência ([docs/spikes/agent-sdk.md](../spikes/agent-sdk.md)).

## 3. Worker (Fly.io)

- [ ] Criar conta no Fly.io e instalar o `flyctl`.
- [ ] Na raiz do repositório:
  ```bash
  fly apps create <nome-do-app>          # e ajuste "app" em apps/worker/fly.toml
  fly secrets set --config apps/worker/fly.toml \
    SUPABASE_URL=https://<ref>.supabase.co \
    SUPABASE_SECRET_KEY=<secret key> \
    ANTHROPIC_API_KEY=<chave da Anthropic>
  fly deploy --config apps/worker/fly.toml
  ```
- [ ] Conferir `fly logs`: deve aparecer "Worker no ar" e "Rotinas agendadas".
- [ ] Manter **uma** máquina ligada no começo (`fly scale count 1`). Mais máquinas são seguras (a fila e o banco evitam trabalho duplicado), mas não são necessárias agora.

Prefere Railway? O mesmo Dockerfile funciona: contexto de build na raiz, `apps/worker/Dockerfile`, as mesmas três variáveis e health check em `/health`.

## 4. Painel (Vercel)

- [ ] Importar o repositório na Vercel com **Root Directory** `apps/web` (framework Next.js; a Vercel detecta o pnpm).
- [ ] Variáveis de ambiente (Production e Preview):
  - `NEXT_PUBLIC_SUPABASE_URL` = `https://<ref>.supabase.co`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = *publishable key* do projeto
  - `NEXT_PUBLIC_SITE_URL` = endereço do painel
- [ ] Apontar o domínio do painel e repetir esse endereço no Supabase (passo 1).
- [ ] A chave secreta do Supabase **não** vai para a Vercel nesta etapa: o painel só usa a sessão do usuário.

## 5. GitHub

- [ ] Em **Settings > Actions**, deixar os workflows habilitados. O CI roda lint, tipos, testes, build, os testes de banco com o Supabase local e a busca de segredos.
- [ ] Proteger a branch `main` exigindo o CI verde antes do merge.

## 6. Começar já (prazos longos)

Estes processos levam semanas e são necessários para as próximas etapas:

- [ ] Verificação da empresa Givance no Business Manager da Meta.
- [ ] App na Meta for Developers (tipo Business). Para uso próprio, o modo de desenvolvimento basta.
- [ ] Projeto no Google Cloud com Gmail API e Google Calendar API ativadas e tela de consentimento em modo de teste, com o seu e-mail como usuário de teste.
- [ ] Um número de telefone dedicado ao assistente no WhatsApp (que não esteja em uso no app comum).
