-- Trigger name sorts after on_auth_user_created, so the profile exists before promotion.
create trigger on_auth_user_zz_promote_admin
  after insert or update of email_confirmed_at on auth.users
  for each row execute function public.promote_confirmed_admin();
