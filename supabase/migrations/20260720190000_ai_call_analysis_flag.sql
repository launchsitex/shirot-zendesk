insert into public.app_feature_flags (key, enabled, updated_at)
values ('ai_call_analysis', false, now())
on conflict (key) do nothing;
