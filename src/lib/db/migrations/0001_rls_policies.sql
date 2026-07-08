-- Politicas de RLS (Row Level Security) — isolamento por household_id.
--
-- Estas policies cobrem o caminho do PWA, autenticado via Supabase Auth
-- (role "authenticated", auth.uid() presente no JWT).
--
-- O bot do Telegram e os crons (app/api/telegram, app/api/cron) nao possuem
-- sessao de Supabase Auth: eles usam a service role key no servidor (nunca
-- exposta ao client), que ignora RLS por definicao. Por isso essas rotas sao
-- responsaveis por validar o household/usuario na aplicacao antes de
-- ler/escrever dados (ver CLAUDE.md secao 10).
--
-- Funcoes auxiliares (SECURITY DEFINER) evitam recursao de policy ao
-- consultar household_members a partir de dentro da propria tabela.

create or replace function public.is_household_member(target_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from household_members hm
    where hm.household_id = target_household_id
      and hm.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_household_owner(target_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from household_members hm
    where hm.household_id = target_household_id
      and hm.user_id = (select auth.uid())
      and hm.role = 'owner'
  );
$$;

grant execute on function public.is_household_member(uuid) to authenticated;
grant execute on function public.is_household_owner(uuid) to authenticated;

--> statement-breakpoint

-- households ------------------------------------------------------------
create policy "households_select_member" on households
  for select to authenticated
  using (is_household_member(id));

create policy "households_insert_self" on households
  for insert to authenticated
  with check (true);

create policy "households_update_owner" on households
  for update to authenticated
  using (is_household_owner(id))
  with check (is_household_owner(id));

--> statement-breakpoint

-- users -------------------------------------------------------------------
-- Sem household_id proprio: visivel para o proprio usuario e para quem
-- compartilha algum household com ele.
create policy "users_select_self_or_household" on users
  for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1
      from household_members my
      join household_members their on their.household_id = my.household_id
      where my.user_id = (select auth.uid())
        and their.user_id = users.id
    )
  );

create policy "users_insert_self" on users
  for insert to authenticated
  with check (id = (select auth.uid()));

create policy "users_update_self" on users
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

--> statement-breakpoint

-- household_members ---------------------------------------------------------
create policy "household_members_select_member" on household_members
  for select to authenticated
  using (is_household_member(household_id));

-- Um usuario so pode se auto-inserir (aceitar convite); o dono pode
-- adicionar/gerenciar membros diretamente.
create policy "household_members_insert_self_or_owner" on household_members
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    or is_household_owner(household_id)
  );

create policy "household_members_update_owner" on household_members
  for update to authenticated
  using (is_household_owner(household_id))
  with check (is_household_owner(household_id));

create policy "household_members_delete_owner_or_self" on household_members
  for delete to authenticated
  using (
    is_household_owner(household_id)
    or user_id = (select auth.uid())
  );

--> statement-breakpoint

-- Tabelas de dados do household: mesma regra de CRUD para owner e member
-- (ver CLAUDE.md secao 6.6 — permissoes).
do $$
declare
  t text;
begin
  foreach t in array array[
    'accounts',
    'categories',
    'transactions',
    'installment_purchases',
    'recurring_rules',
    'bills',
    'bill_instances',
    'budgets'
  ]
  loop
    execute format(
      'create policy "%s_select_member" on %I for select to authenticated using (is_household_member(household_id));',
      t, t
    );
    execute format(
      'create policy "%s_insert_member" on %I for insert to authenticated with check (is_household_member(household_id));',
      t, t
    );
    execute format(
      'create policy "%s_update_member" on %I for update to authenticated using (is_household_member(household_id)) with check (is_household_member(household_id));',
      t, t
    );
    execute format(
      'create policy "%s_delete_member" on %I for delete to authenticated using (is_household_member(household_id));',
      t, t
    );
  end loop;
end $$;

--> statement-breakpoint

-- invites -------------------------------------------------------------------
-- Apenas o dono cria/gerencia convites. A aceitacao do convite por um usuario
-- que ainda NAO e membro (busca por codigo + marcar used_by/used_at) roda no
-- servidor com a service role key, contornando RLS (ver CLAUDE.md secao 3.2).
create policy "invites_select_member" on invites
  for select to authenticated
  using (is_household_member(household_id));

create policy "invites_insert_owner" on invites
  for insert to authenticated
  with check (is_household_owner(household_id));

create policy "invites_update_owner" on invites
  for update to authenticated
  using (is_household_owner(household_id))
  with check (is_household_owner(household_id));

create policy "invites_delete_owner" on invites
  for delete to authenticated
  using (is_household_owner(household_id));
