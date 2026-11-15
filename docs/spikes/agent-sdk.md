# Spike: Claude Agent SDK no runtime da Givance

Versão testada: `@anthropic-ai/claude-agent-sdk` 0.3.325 (Claude Code 2.1.325), Node 22.

## Resumo

O SDK atende ao que o PLANO.md pede (orquestrador com subagentes, ferramentas próprias em processo, hooks, limites de custo). Nenhum bloqueio encontrado. Três decisões de projeto saíram do spike e já estão no código:

1. **Retomada pelo banco, não pela sessão do SDK.** As sessões do SDK ficam em arquivos locais da máquina. Num worker com várias instâncias e containers descartáveis, isso não é confiável para aprovações que podem levar dias. Cada execução começa limpa (`persistSession: false`) e recebe o histórico da tarefa (execuções, aprovações, resultados) montado a partir do banco. O teste `apps/worker/tests/fluxo.test.ts` cobre essa retomada.
2. **Subagentes sempre em primeiro plano.** Nesta versão, a ferramenta de delegação (`Agent`) roda o subagente em segundo plano por padrão. Um hook `PreToolUse` reescreve cada chamada com `run_in_background: false` e descarta os campos `model`, `isolation` e `name`: modelo e isolamento são decididos pelo cargo, não pelo modelo.
3. **Permissões nos hooks, não no `canUseTool`.** Com `allowedTools` preenchido, o SDK não consulta o `canUseTool` para essas ferramentas (ele avisa isso no console). O controle por agente fica no `PreToolUse`, com `onFailure: 'block'`: se o hook falhar, a chamada não acontece.

## O que já foi verificado

| Item | Como | Resultado |
|------|------|-----------|
| API do SDK (opções, subagentes, hooks, ferramentas MCP, mensagens de resultado) | Leitura dos tipos instalados (`sdk.d.ts`) | Tudo que o runtime usa existe nesta versão |
| Binário do Claude Code aceita as opções do runtime (ferramentas desligadas, hooks, MCP em processo, `dontAsk`) | Execução real com chave inválida | O processo subiu e só parou na autenticação (`Invalid API key`) |
| Ferramentas da Givance pelo protocolo MCP, hooks reais, gravação no banco | Teste de ponta a ponta com "modelo roteirizado" (`fluxo.test.ts`) | Passa: artefato do especialista, negação de ferramenta alheia, aprovação, execução, retomada |
| Isolamento: só `Agent` e `mcp__givance__*`; sem settings, CLAUDE.md, skills; ambiente sem segredos do worker | `options.test.ts` | Passa |
| Custo por agente | `usage.test.ts` | Respostas de subagente identificadas por `parent_tool_use_id`; total ajustado ao `total_cost_usd` oficial |
| Imagem Docker com o binário | Build e execução do container | Sobe e responde `/health`; 960 MB (o binário do Claude Code tem ~340 MB) |

## O que falta medir com uma chave real

Rode o spike (custo de alguns centavos):

```bash
ANTHROPIC_API_KEY=... pnpm --filter @givance/worker spike:agent-sdk
# opcional: SPIKE_MODEL=claude-sonnet-5-5 para comparar custo; SPIKE_DEBUG=1 para o log do Claude Code
```

O relatório em JSON responde:

- **Delegação:** aparece `subagente_inicio` / `subagente_fim` para `copywriter` e chamadas de ferramenta com `agente: "copywriter"`?
- **Ação:** existe uma aprovação `memoria.registrar` com `status: "pendente"` e `nivel: "confirmar"`, pedida pelo `orquestrador`?
- **Custo por agente:** `por_agente` traz o orquestrador e o copywriter com tokens e custo, somando o `custo_total_usd`?
- **Tempo:** quanto leva uma tarefa simples (`duracao_s`) — isso define a concorrência do worker.

Se algum desses itens falhar, o ajuste esperado é de prompt (orquestrador) ou de hook, não de arquitetura.

## Pontos de atenção

- **Um processo por tarefa.** Cada execução sobe um processo do Claude Code. O worker limita a concorrência (`WORKER_CONCURRENCY`, padrão 2). Medir memória por execução no Fly antes de aumentar.
- **Tamanho da imagem.** O Dockerfile remove a variante musl do binário, que o pnpm instala junto. Usar sempre imagem base glibc (Debian).
- **Atribuição de ferramenta ao agente.** O handler MCP não recebe o tipo do agente. O runtime registra o agente no `PreToolUse` e o handler o recupera pela ordem de chegada (ou pelo id da chamada, se o SDK o repassar em `_meta`). Com chamadas paralelas da mesma ferramenta por agentes diferentes, a atribuição pode trocar a autoria registrada, mas não as permissões, que são checadas no hook.
- **Recusas do modelo.** O Claude Opus 5.5 pode encerrar com `stop_reason: "refusal"` em categorias de segurança. O SDK tem a opção `fallbackModel`; avaliar quando houver tráfego real.
