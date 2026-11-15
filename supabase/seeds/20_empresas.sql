-- Empresas fictícias para desenvolvimento local.
-- * Givance: você, como primeiro usuário (D8 do PLANO.md).
-- * Clínica Exemplo: empresa de teste da Fase 1 (saúde, setor regulado).
-- * Padaria Modelo: segunda empresa, para verificar o isolamento entre empresas.

insert into public.organizations (id, name, slug, timezone, daily_budget_cap_cents)
values
  ('20000000-0000-4000-8000-000000000001', 'Givance Tech', 'givance', 'America/Sao_Paulo', 0),
  ('20000000-0000-4000-8000-000000000002', 'Clínica Exemplo', 'clinica-exemplo', 'America/Sao_Paulo', 5000),
  ('20000000-0000-4000-8000-000000000003', 'Padaria Modelo', 'padaria-modelo', 'America/Sao_Paulo', 0);

insert into public.memberships (org_id, user_id, role)
values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'owner'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003', 'member'),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004', 'owner');

insert into public.company_profiles (
  org_id, description, segment, tone_of_voice, regions, do_not_say, regulated_sector,
  website_url, instagram_handle, business_hours
)
values
  (
    '20000000-0000-4000-8000-000000000001',
    'Consultoria e tecnologia para pequenas e médias empresas: automação, marketing e funcionários de IA.',
    'Tecnologia B2B',
    'Direto, próximo e sem jargão. Fala de resultado concreto, nunca de "revolução".',
    array['Brasil'],
    array['revolucionário', 'garantimos resultado'],
    null,
    'https://givance.example',
    'givancetech',
    'Segunda a sexta, das 9h às 18h'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    'Clínica odontológica de bairro em Campinas, com foco em prevenção, limpeza e clareamento. Atende particular e alguns convênios.',
    'Odontologia',
    'Acolhedor e claro. Explica sem assustar, trata o paciente por você e evita termos técnicos.',
    array['Campinas - SP', 'Valinhos - SP'],
    array['resultado garantido', 'sem dor', 'antes e depois', 'o melhor dentista da cidade'],
    'saude',
    'https://clinicaexemplo.example',
    'clinicaexemplo',
    'Segunda a sexta, das 8h às 19h; sábado, das 8h às 12h'
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    'Padaria artesanal com fornadas ao longo do dia e encomendas para festas.',
    'Alimentação',
    'Caloroso e simples, como conversa de balcão.',
    array['Jundiaí - SP'],
    array[]::text[],
    null,
    null,
    'padariamodelo',
    'Todos os dias, das 6h às 20h'
  );

insert into public.products (org_id, name, description, price_cents, price_is_public)
values
  ('20000000-0000-4000-8000-000000000002', 'Avaliação inicial', 'Consulta de avaliação com plano de tratamento.', 0, true),
  ('20000000-0000-4000-8000-000000000002', 'Limpeza (profilaxia)', 'Limpeza com remoção de tártaro e orientação de higiene.', 18000, true),
  ('20000000-0000-4000-8000-000000000002', 'Clareamento dental', 'Clareamento em consultório, com avaliação prévia obrigatória.', 90000, false),
  ('20000000-0000-4000-8000-000000000003', 'Pão de fermentação natural', 'Fornada das 7h e das 16h.', 2200, true);

-- Números fictícios (+55 19 90000-00xx), não pertencem a ninguém.
insert into public.channels (org_id, user_id, kind, address_e164, verified_at, quiet_hours)
values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'whatsapp', '+5519900000001', now(), '{"inicio": "22:00", "fim": "07:00"}'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'whatsapp', '+5519900000002', now(), '{"inicio": "21:00", "fim": "07:30"}');

-- Política de autonomia da Clínica: memória da empresa sempre com confirmação (o padrão),
-- deixado explícito como exemplo do que o dono ajusta no painel.
insert into public.autonomy_policies (org_id, action_type, level)
values ('20000000-0000-4000-8000-000000000002', 'memoria.registrar', 'confirmar');

-- Memória inicial da Clínica (busca textual em português).
insert into public.knowledge_documents (id, org_id, title, source, status)
values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'Regras de comunicação', 'manual', 'processado'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Atendimento e agendamento', 'manual', 'processado');

insert into public.knowledge_chunks (org_id, document_id, chunk_index, content)
values
  ('20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', 0,
   'Não divulgamos o preço do clareamento em posts: o valor depende da avaliação. Podemos divulgar o preço da limpeza (R$ 180,00) e que a avaliação inicial é gratuita.'),
  ('20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', 1,
   'Nunca usar fotos de pacientes sem autorização assinada. Não publicar antes e depois. Responsável técnica: Dra. Helena Prado, CRO-SP 00000.'),
  ('20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 0,
   'Agendamentos pelo WhatsApp da recepção. Horário: segunda a sexta das 8h às 19h e sábado das 8h às 12h. Atendemos os convênios OdontoBem e SorriaMais.');

-- Contrata o Braço Direito para a Givance e para a Clínica (copia as rotinas do cargo).
select public.hire_employee('20000000-0000-4000-8000-000000000001', 'braco-direito', 1, 'Braço Direito');
select public.hire_employee('20000000-0000-4000-8000-000000000002', 'braco-direito', 1, 'Lia');
select public.hire_employee('20000000-0000-4000-8000-000000000003', 'social-media', 1, 'Social da Padaria');
