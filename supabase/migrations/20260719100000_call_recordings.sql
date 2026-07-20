create table public.call_recordings (
  id text primary key,
  call_id text not null references public.calls(id) on delete cascade,
  ticket_id text not null,
  comment_id text not null,
  recording_type text not null default 'call',
  recording_url text not null check (recording_url ~ '^https://'),
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  created_at timestamptz not null,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  unique (call_id, comment_id, recording_type)
);

create index call_recordings_call_idx on public.call_recordings (call_id);
create index call_recordings_created_idx on public.call_recordings (created_at desc);
create index call_recordings_ticket_idx on public.call_recordings (ticket_id);

alter table public.call_recordings enable row level security;

create policy "authenticated read call recordings" on public.call_recordings
for select to authenticated using (true);

select cron.schedule(
  'zendesk-recordings-every-five-minutes',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'project_url'
    ) || '/functions/v1/sync-recordings',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'sync_function_secret'
      )
    ),
    body := '{}'::jsonb
  )
  where exists (
    select 1
    from public.integration_settings
    where provider = 'zendesk_talk' and enabled = true
  );
  $$
);
