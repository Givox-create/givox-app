-- Givox: tablas para espectadores/streamers, regalos .webm e historial de donaciones.

create extension if not exists "pgcrypto";

do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('espectador', 'streamer');
  end if;
end $$;

create table public.users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  display_name text,
  role public.user_role not null default 'espectador',
  created_at timestamptz not null default now()
);

create table public.gifts (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  video_url text not null,
  created_at timestamptz not null default now(),
  constraint gifts_video_url_webm check (video_url ~* '\.webm(\?.*)?$')
);

create table public.donations (
  id uuid primary key default gen_random_uuid(),
  donor_id uuid not null references public.users (id) on delete restrict,
  streamer_id uuid not null references public.users (id) on delete restrict,
  gift_id uuid not null references public.gifts (id) on delete restrict,
  sent_at timestamptz not null default now(),
  constraint donations_distinct_users check (donor_id <> streamer_id)
);

create index donations_donor_id_idx on public.donations (donor_id);
create index donations_streamer_id_idx on public.donations (streamer_id);
create index donations_gift_id_idx on public.donations (gift_id);
create index donations_sent_at_idx on public.donations (sent_at desc);
