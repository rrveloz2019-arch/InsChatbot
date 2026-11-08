-- Admin role is granted only to listed emails, and only after the email is confirmed.
create table public.admin_emails (email text primary key check (email = lower(email)));
alter table public.admin_emails enable row level security;
revoke all on public.admin_emails from anon, authenticated;
insert into public.admin_emails (email) values ('info@agentsys-dev.com');

create or replace function public.promote_confirmed_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email_confirmed_at is not null
     and exists (select 1 from public.admin_emails where email = lower(new.email)) then
    update public.agents set role = 'admin' where id = new.id;
  end if;
  return new;
end $$;
revoke execute on function public.promote_confirmed_admin() from public, anon, authenticated;
