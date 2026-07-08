-- Grants de acesso para os roles do Supabase (PostgREST).
--
-- Tabelas criadas pelo drizzle-kit nao herdam os default privileges do
-- Supabase, entao o PostgREST responde 42501 (permission denied) mesmo com
-- policies corretas. Este arquivo concede:
--   - authenticated: CRUD (limitado pelas policies de RLS da migration 0001)
--   - service_role: CRUD (bypassa RLS por definicao — usado por bot e cron)
--   - anon: NADA (app fechado; anonimo nao le nem escreve nenhuma tabela)

grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete on all tables in schema public
  to authenticated, service_role;

-- Tabelas futuras criadas pelo role postgres (drizzle-kit migrate) herdam
-- os mesmos grants automaticamente.
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;

alter default privileges for role postgres in schema public
  grant usage, select on sequences to authenticated, service_role;
