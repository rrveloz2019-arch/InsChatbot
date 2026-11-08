-- New-lead alert emails: after a lead is saved, the database calls the lead-alert Edge Function.
-- An email problem can never block or lose a lead.
create extension if not exists pg_net;

alter table public.leads add column alert_status text, add column alert_sent_at timestamptz;

-- Shared secret, generated and kept inside the database (Vault). Never leaves the database.
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'lead_alert_secret', 'Authorizes database -> lead-alert function calls');

-- The function asks the database "is this the right secret?" (service role only).
create or replace function public.check_lead_alert_secret(s text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'lead_alert_secret' and decrypted_secret = s);
$$;
revoke all on function public.check_lead_alert_secret(text) from public, anon, authenticated;
grant execute on function public.check_lead_alert_secret(text) to service_role;

create or replace function public.notify_new_lead() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s text;
begin
  select decrypted_secret into s from vault.decrypted_secrets where name = 'lead_alert_secret';
  perform net.http_post(
    url := 'https://vmauuwxeojbwlwcpvtxb.supabase.co/functions/v1/lead-alert',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-lead-alert-secret', s),
    body := jsonb_build_object('lead_id', new.id),
    timeout_milliseconds := 10000);
  return new;
exception when others then
  return new;   -- never block saving a lead
end $$;
revoke execute on function public.notify_new_lead() from public, anon, authenticated;

create trigger leads_notify_new after insert on public.leads
  for each row execute function public.notify_new_lead();
