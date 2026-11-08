-- ACA Lead Bot – initial schema (agents, leads, security rules, lead intake, photo storage)

-- ============ AGENTS ============
create table public.agents (
  id           uuid primary key references auth.users(id) on delete cascade,
  slug         text unique not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  full_name    text not null check (char_length(full_name) between 1 and 120),
  email        text not null,
  phone        text check (phone is null or phone ~ '^\d{10}$'),
  license_no   text check (license_no is null or char_length(license_no) <= 40),
  booking_url  text check (booking_url is null or booking_url = '' or booking_url ~ '^https://'),
  photo_path   text check (photo_path is null or char_length(photo_path) <= 300),
  role         text not null default 'agent' check (role in ('agent','admin')),
  active       boolean not null default false,
  alerts_email boolean not null default true,
  created_at   timestamptz not null default now()
);
alter table public.agents enable row level security;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.agents where id = (select auth.uid()) and role = 'admin');
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create policy agents_select on public.agents for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));
create policy agents_update on public.agents for update to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()))
  with check (id = (select auth.uid()) or (select public.is_admin()));

revoke all on public.agents from anon, authenticated;
grant select on public.agents to authenticated;
grant update (full_name, phone, license_no, booking_url, photo_path, alerts_email, role, active)
  on public.agents to authenticated;

-- Only admins may change role/active; nobody can be active without a license #
create or replace function public.agents_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null and not public.is_admin() then
    if new.role is distinct from old.role or new.active is distinct from old.active then
      raise exception 'Only an admin can change role or active status';
    end if;
  end if;
  if new.active and coalesce(trim(new.license_no), '') = '' then
    raise exception 'A Florida license number is required before an agent can be active';
  end if;
  return new;
end $$;
create trigger agents_guard before update on public.agents
  for each row execute function public.agents_guard();

-- New sign-up -> inactive agent profile with a unique link slug
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare nm text; base text; s text; n int := 1;
begin
  nm := coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1));
  base := trim(both '-' from regexp_replace(
            translate(lower(nm), 'áàäâéèëêíìïîóòöôúùüûñç', 'aaaaeeeeiiiioooouuuunc'), '[^a-z0-9]+', '-', 'g'));
  if base = '' then base := 'agent'; end if;
  s := base;
  while exists (select 1 from public.agents where slug = s) loop
    n := n + 1; s := base || '-' || n;
  end loop;
  insert into public.agents (id, slug, full_name, email) values (new.id, s, left(nm, 120), new.email);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ LEADS ============
create table public.leads (
  id           uuid primary key default gen_random_uuid(),
  agent_id     uuid not null references public.agents(id) on delete cascade,
  created_at   timestamptz not null default now(),
  first_name   text not null check (char_length(first_name) between 1 and 60),
  phone        text not null check (phone ~ '^\d{10}$'),
  best_time    text check (best_time in ('morning','afternoon','evening')),
  zip          text not null check (zip ~ '^3[234]\d{3}$'),
  household    int  not null check (household between 1 and 8),
  income       numeric not null check (income >= 0 and income < 10000000),
  fpl_pct      int  not null,
  coverage     text not null check (coverage in ('none','marketplace','employer','medicaid','medicare')),
  priority     text not null check (priority in ('lowpay','lowded','checkups','balance')),
  grp          text not null check (grp in ('G1','G2','G3','G4','GAP','REVIEW')),
  lang         text not null check (lang in ('en','es')),
  status       text not null default 'new' check (status in ('new','called','enrolled','lost')),
  consent      boolean not null check (consent),
  consent_at   timestamptz not null,
  consent_text text not null check (char_length(consent_text) between 20 and 2000),
  page_url     text check (char_length(page_url) <= 500),
  user_agent   text check (char_length(user_agent) <= 500)
);
create index leads_agent_created_idx on public.leads (agent_id, created_at desc);
create index leads_phone_created_idx on public.leads (phone, created_at desc);
alter table public.leads enable row level security;

create policy leads_select on public.leads for select to authenticated
  using (agent_id = (select auth.uid()) or (select public.is_admin()));
create policy leads_update on public.leads for update to authenticated
  using (agent_id = (select auth.uid()) or (select public.is_admin()))
  with check (agent_id = (select auth.uid()) or (select public.is_admin()));

revoke all on public.leads from anon, authenticated;
grant select on public.leads to authenticated;
grant update (status) on public.leads to authenticated;   -- agents can only change the status

-- ============ PUBLIC CHATBOT FUNCTIONS ============
-- Chatbot reads only the public details of an ACTIVE agent (never email or leads)
create or replace function public.get_public_agent(p_slug text)
returns table (full_name text, license_no text, phone text, booking_url text, photo_path text)
language sql stable security definer set search_path = '' as $$
  select a.full_name, a.license_no, a.phone, a.booking_url, a.photo_path
  from public.agents a where a.slug = p_slug and a.active;
$$;
revoke all on function public.get_public_agent(text) from public;
grant execute on function public.get_public_agent(text) to anon, authenticated;

-- Chatbot submits a lead. Server validates everything and computes the group itself.
create or replace function public.submit_lead(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_agent uuid; v_hh int; v_income numeric; v_fpl int; v_grp text;
  v_cov text := p->>'coverage'; v_pri text := p->>'priority';
  v_phone text := regexp_replace(coalesce(p->>'phone',''), '\D', '', 'g');
begin
  select id into v_agent from public.agents where slug = p->>'agent' and active;
  if v_agent is null then return jsonb_build_object('status','agent_unavailable'); end if;
  if coalesce((p->>'consent')::boolean, false) is not true then return jsonb_build_object('status','no_consent'); end if;
  if length(v_phone) = 11 and left(v_phone,1) = '1' then v_phone := substr(v_phone, 2); end if;

  v_hh := (p->>'household')::int;
  v_income := (p->>'income')::numeric;
  if v_hh is null or v_hh < 1 or v_hh > 8 or v_income is null or v_income < 0 then
    return jsonb_build_object('status','invalid');
  end if;
  -- 2026 HHS poverty guidelines (48 states + DC), used for 2027 Marketplace coverage
  v_fpl := round(v_income / (15960 + 5680 * (v_hh - 1)) * 100);

  -- Florida (no Medicaid expansion) segmentation
  v_grp := case
    when v_cov in ('employer','medicare','medicaid') then 'REVIEW'
    when v_fpl < 100 then 'GAP'
    when v_pri = 'checkups' then 'G3'
    when v_pri = 'lowded' and v_fpl <= 250 then 'G2'
    when v_pri = 'lowpay' and v_fpl <= 150 then 'G1'
    when v_fpl > 250 then 'G4'
    when v_fpl <= 150 then 'G1'
    else 'G2' end;

  -- ignore the same phone for the same agent within 24 hours
  if exists (select 1 from public.leads where agent_id = v_agent and phone = v_phone
             and created_at > now() - interval '24 hours') then
    return jsonb_build_object('status','duplicate','group',v_grp);
  end if;
  -- basic flood protection: max 30 leads per agent per minute
  if (select count(*) from public.leads where agent_id = v_agent and created_at > now() - interval '1 minute') >= 30 then
    return jsonb_build_object('status','busy');
  end if;

  insert into public.leads (agent_id, first_name, phone, best_time, zip, household, income, fpl_pct,
                            coverage, priority, grp, lang, consent, consent_at, consent_text, page_url, user_agent)
  values (v_agent, trim(p->>'firstName'), v_phone, p->>'bestTime', p->>'zip', v_hh, v_income, v_fpl,
          v_cov, v_pri, v_grp, coalesce(p->>'lang','en'), true, now(), p->>'consentText',
          left(p->>'pageUrl', 500), left(p->>'userAgent', 500));
  return jsonb_build_object('status','ok','group',v_grp);
exception
  when check_violation or invalid_text_representation or numeric_value_out_of_range or not_null_violation then
    return jsonb_build_object('status','invalid');
end $$;
revoke all on function public.submit_lead(jsonb) from public;
grant execute on function public.submit_lead(jsonb) to anon, authenticated;

-- ============ AGENT PHOTOS (Storage) ============
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('agent-photos', 'agent-photos', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy agent_photos_select_own on storage.objects for select to authenticated
  using (bucket_id = 'agent-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy agent_photos_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'agent-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy agent_photos_update_own on storage.objects for update to authenticated
  using (bucket_id = 'agent-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy agent_photos_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'agent-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
