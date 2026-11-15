-- Usuários fictícios para desenvolvimento local. Domínio .test (reservado, nunca entrega e-mail
-- real). Sem senha: o acesso é por link mágico, que chega no Mailpit (http://127.0.0.1:54324).

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values
  (
    '00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'dono@givance.test', '', now(),
    '{"provider": "email", "providers": ["email"], "givance_admin": true}',
    '{"nome": "Dono da Givance"}', now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'dona@clinicaexemplo.test', '', now(),
    '{"provider": "email", "providers": ["email"]}',
    '{"nome": "Helena Prado"}', now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000003',
    'authenticated', 'authenticated', 'recepcao@clinicaexemplo.test', '', now(),
    '{"provider": "email", "providers": ["email"]}',
    '{"nome": "Recepção da Clínica"}', now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000004',
    'authenticated', 'authenticated', 'dono@padariamodelo.test', '', now(),
    '{"provider": "email", "providers": ["email"]}',
    '{"nome": "Dono da Padaria"}', now(), now(), '', '', '', ''
  );

insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select
  u.id::text,
  u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email',
  now(),
  now(),
  now()
from auth.users u
where u.email like '%.test';
