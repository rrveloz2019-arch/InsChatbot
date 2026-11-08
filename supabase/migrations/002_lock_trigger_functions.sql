-- Trigger functions run automatically; nobody should call them through the API.
revoke execute on function public.agents_guard() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
