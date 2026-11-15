# Givance Workforce

Plataforma de "funcionários de IA" para pequenas e médias empresas: cada funcionário é um time de agentes (Claude Agent SDK) coordenado por um orquestrador, que trabalha com aprovação do dono para tudo que mexe com o mundo real. O plano completo está em [PLANO.md](PLANO.md).

**Etapa atual: Fase 1b (canal WhatsApp).** Sobre a fundação da 1a (banco multiempresa com RLS, filas, aprovações, runtime de agentes, worker e painel), a 1b liga o WhatsApp do dono: pedidos por texto e foto, prévias com botões, avisos com janela de 24h e horário de silêncio. Instagram, Gmail e Agenda entram nas etapas 1c e 1d.

## Estrutura

```
apps/
  web/        Painel (Next.js 16, App Router, Tailwind 4). Deploy na Vercel.
  worker/     Consome as filas, roda os agentes e executa ações aprovadas. Deploy no Fly.io.
packages/
  core/       Tipos de domínio, schema dos cargos, cron, mascaramento de dados pessoais.
  tools/      Ferramentas dos agentes, registro de ações, motor de autonomia e aprovações.
  agents/     Carregador de cargos e prompts, runtime do Claude Agent SDK.
  db/         Clientes e repositórios do Supabase (sempre filtrando por empresa).
  integrations/  Clientes de APIs externas (WhatsApp Cloud API).
agents/       Prompts de sistema de cada agente (agents/<nome>/system.md). Editáveis.
roles/        Cargos em YAML (roles/<cargo>.yaml). Editáveis.
supabase/     Migrations, seeds e configuração local.
docs/         Checklists por fase e relatórios de spikes.
```

## Rodar localmente

Pré-requisitos: Node 22, pnpm 10 (`corepack enable`) e Docker.

```bash
pnpm install
pnpm db:start          # sobe o Supabase local (na primeira vez baixa as imagens)
pnpm db:reset          # aplica migrations e seeds (empresas e usuários fictícios)
pnpm exec supabase status   # mostra as chaves locais
```

Crie os arquivos de ambiente a partir dos exemplos:

- `apps/web/.env.local` (de [apps/web/.env.example](apps/web/.env.example)): URL e *publishable key* do `supabase status`.
- `apps/worker/.env` (de [apps/worker/.env.example](apps/worker/.env.example)): URL, *secret key* e, para os agentes trabalharem, `ANTHROPIC_API_KEY`.

```bash
pnpm --filter @givance/web dev       # painel em http://localhost:3000
pnpm --filter @givance/worker dev    # worker (filas, agentes, rotinas)
```

Para entrar no painel, use um dos e-mails fictícios abaixo. O link de acesso chega no Mailpit local: http://127.0.0.1:54324.

| E-mail | Empresa | Papel |
|--------|---------|-------|
| `dono@givance.test` | Givance Tech | dono (e admin da Givance) |
| `dona@clinicaexemplo.test` | Clínica Exemplo | dona |
| `recepcao@clinicaexemplo.test` | Clínica Exemplo | membro (não aprova ações) |
| `dono@padariamodelo.test` | Padaria Modelo | dono |

Para criar uma tarefa sem o painel de tarefas (que chega na etapa 1e), use o SQL do Supabase Studio ou o `psql` local:

```sql
insert into tasks (org_id, employee_id, title, input, source)
select org_id, id, 'Teste', '{"mensagem": "Qual é o preço da limpeza?"}', 'painel'
from employees where display_name = 'Lia';
```

## Testes

```bash
pnpm lint && pnpm typecheck && pnpm test          # unitários
pnpm test:db                                      # RLS, permissões e fluxos no banco (precisa do db:start)
pnpm --filter @givance/worker test:integration    # tarefa -> aprovação -> execução -> retomada
```

O teste de ponta a ponta usa um "modelo roteirizado" no lugar da API da Anthropic: as ferramentas, os hooks de permissão e o banco são os reais. Para testar com o modelo de verdade, veja [docs/spikes/agent-sdk.md](docs/spikes/agent-sdk.md).

## Ajustar cargos e prompts

- **Prompts:** edite `agents/<nome>/system.md`. Valem no próximo deploy do worker, sem mudar código. O hash do prompt usado em cada execução fica registrado em `agent_runs.prompt_hashes`.
- **Cargos:** edite `roles/<cargo>.yaml` (agentes, ferramentas, níveis de autonomia, limites, rotinas). Toda mudança de estrutura exige aumentar `version`: funcionários já contratados continuam na versão em que foram contratados.
- Depois de mudar um cargo: `pnpm roles:build` (valida e atualiza o seed local) e, em produção, `pnpm roles:publish`.

Regras de composição (cargo que inclui outros, como o Braço Direito): permissões, vence a mais restritiva; limites, os do próprio cargo valem e os ausentes usam o menor valor entre os incluídos.

## Segurança, em resumo

- **Isolamento entre empresas:** RLS em todas as tabelas, chaves estrangeiras que incluem `org_id` (o banco impede ligar registros de empresas diferentes) e testes que conferem tabela por tabela.
- **O agente propõe, o sistema executa:** ações viram aprovações; a execução usa exatamente o payload aprovado, uma única vez (garantido por índice no banco).
- **Pisos fixos de autonomia:** gasto sempre com aprovação no painel, exclusão proibida e nada automático depois de ler conteúdo de terceiros.
- **Agentes isolados:** sem ferramentas nativas do Claude Code, sem acesso a arquivos ou à internet; cada agente só usa as ferramentas do seu cargo, conferidas em código a cada chamada.
- **Auditoria imutável** e dados pessoais mascarados nos logs.
- **Segredos** só em variáveis de ambiente e no Supabase Vault.

## Deploy

Passo a passo em [docs/checklists/fase-1a.md](docs/checklists/fase-1a.md) e, para o WhatsApp, [docs/checklists/fase-1b.md](docs/checklists/fase-1b.md).
