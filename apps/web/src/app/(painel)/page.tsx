import {
  APPROVAL_STATUS_LABELS,
  AUTONOMY_LEVEL_LABELS,
  EMPLOYEE_STATUS_LABELS,
  TASK_STATUS_LABELS,
  type AutonomyLevel,
  type EmployeeStatus,
  type TaskStatus,
} from '@givance/core';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { formatDateTime, formatInteger, formatUsd } from '@/lib/format';
import { requirePanelSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Início' };

type Tone = 'neutro' | 'acento' | 'alerta' | 'sucesso' | 'erro';

const TONES: Record<Tone, string> = {
  neutro: 'bg-fundo text-suave',
  acento: 'bg-acento-claro text-acento',
  alerta: 'bg-alerta-claro text-alerta',
  sucesso: 'bg-sucesso-claro text-sucesso',
  erro: 'bg-erro-claro text-erro',
};

const EMPLOYEE_TONE: Record<EmployeeStatus, Tone> = {
  trabalhando: 'acento',
  aguardando_aprovacao: 'alerta',
  ocioso: 'neutro',
  pausado: 'neutro',
};

const TASK_TONE: Record<TaskStatus, Tone> = {
  a_fazer: 'neutro',
  em_andamento: 'acento',
  aguardando_aprovacao: 'alerta',
  concluida: 'sucesso',
  falhou: 'erro',
  cancelada: 'neutro',
};

function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-linha bg-superficie p-4">
      <p className="text-sm text-suave">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-suave">{hint}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-linha bg-superficie">
      <h2 className="border-b border-linha px-4 py-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-6 text-sm text-suave">{children}</p>;
}

function inicioDoMes(timeZone: string): { iso: string; periodo: string } {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' })
    .formatToParts(new Date())
    .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  const periodo = `${partes.year}-${partes.month}-01`;
  return { iso: `${periodo}T00:00:00`, periodo };
}

export default async function InicioPage() {
  const session = await requirePanelSession();
  const supabase = await createClient();
  const orgId = session.org.id;
  const tz = session.org.timezone;
  const mes = inicioDoMes(tz);

  const [funcionarios, pendentes, contagemPendentes, emAndamento, concluidas, consumo, recentes] =
    await Promise.all([
      supabase
        .from('employees')
        .select('id, display_name, status, role_versions(role_key, version, roles(display_name))')
        .eq('org_id', orgId)
        .order('hired_at'),
      supabase
        .from('approvals')
        .select('id, action_type, preview, autonomy_level, status, expires_at, created_at')
        .eq('org_id', orgId)
        .eq('status', 'pendente')
        .order('created_at', { ascending: false })
        .limit(5),
      supabase
        .from('approvals')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('status', 'pendente'),
      supabase
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .in('status', ['a_fazer', 'em_andamento']),
      supabase
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('status', 'concluida')
        .gte('finished_at', mes.iso),
      supabase
        .from('usage_ledger')
        .select('cost_usd')
        .eq('org_id', orgId)
        .eq('period', mes.periodo),
      supabase
        .from('tasks')
        .select('id, title, status, source, updated_at')
        .eq('org_id', orgId)
        .order('updated_at', { ascending: false })
        .limit(8),
    ]);

  const custoMes = (consumo.data ?? []).reduce((soma, linha) => soma + Number(linha.cost_usd), 0);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Início</h1>
        <p className="mt-1 text-sm text-suave">
          O que seus funcionários estão fazendo e o que espera a sua decisão em {session.org.name}.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Aguardando sua decisão" value={formatInteger(contagemPendentes.count ?? 0)} />
        <Kpi label="Tarefas em andamento" value={formatInteger(emAndamento.count ?? 0)} />
        <Kpi label="Concluídas no mês" value={formatInteger(concluidas.count ?? 0)} />
        <Kpi
          label="Custo de IA no mês"
          value={formatUsd(custoMes)}
          hint="Estimativa do consumo dos modelos"
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Section title="Aguardando sua decisão">
            {(pendentes.data ?? []).length === 0 ? (
              <Empty>
                Nada pendente. Quando um funcionário pedir sua confirmação, ela aparece aqui.
              </Empty>
            ) : (
              <ul className="divide-y divide-linha">
                {(pendentes.data ?? []).map((aprovacao) => {
                  const preview = (aprovacao.preview ?? {}) as { titulo?: string; resumo?: string };
                  return (
                    <li
                      key={aprovacao.id}
                      className="flex items-start justify-between gap-4 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {preview.titulo ?? aprovacao.action_type}
                        </p>
                        {preview.resumo && (
                          <p className="mt-0.5 line-clamp-2 text-sm text-suave">{preview.resumo}</p>
                        )}
                        <p className="mt-1 text-xs text-suave">
                          {AUTONOMY_LEVEL_LABELS[aprovacao.autonomy_level as AutonomyLevel]} ·
                          expira em {formatDateTime(aprovacao.expires_at, tz)}
                        </p>
                      </div>
                      <Pill tone="alerta">{APPROVAL_STATUS_LABELS.pendente}</Pill>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section title="Tarefas recentes">
            {(recentes.data ?? []).length === 0 ? (
              <Empty>
                Nenhuma tarefa ainda. Os pedidos que você fizer aos funcionários aparecem aqui.
              </Empty>
            ) : (
              <ul className="divide-y divide-linha">
                {(recentes.data ?? []).map((tarefa) => (
                  <li key={tarefa.id} className="flex items-center justify-between gap-4 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{tarefa.title}</p>
                      <p className="mt-0.5 text-xs text-suave">
                        Atualizada em {formatDateTime(tarefa.updated_at, tz)}
                      </p>
                    </div>
                    <Pill tone={TASK_TONE[tarefa.status as TaskStatus]}>
                      {TASK_STATUS_LABELS[tarefa.status as TaskStatus]}
                    </Pill>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="lg:col-span-2">
          <Section title="Funcionários">
            {(funcionarios.data ?? []).length === 0 ? (
              <Empty>Nenhum funcionário contratado nesta empresa.</Empty>
            ) : (
              <ul className="divide-y divide-linha">
                {(funcionarios.data ?? []).map((funcionario) => (
                  <li
                    key={funcionario.id}
                    className="flex items-center justify-between gap-4 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{funcionario.display_name}</p>
                      <p className="mt-0.5 text-xs text-suave">
                        {funcionario.role_versions?.roles?.display_name ??
                          funcionario.role_versions?.role_key}{' '}
                        · v{funcionario.role_versions?.version}
                      </p>
                    </div>
                    <Pill tone={EMPLOYEE_TONE[funcionario.status as EmployeeStatus]}>
                      {EMPLOYEE_STATUS_LABELS[funcionario.status as EmployeeStatus]}
                    </Pill>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </main>
  );
}
