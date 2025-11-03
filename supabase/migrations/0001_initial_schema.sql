-- =============================================================
-- 0001_initial_schema.sql
-- Core relational schema for the pluggable social app.
-- This mirrors the web backend model; the mobile app consumes it.
-- Key concept: user_feed_preferences (jsonb) stores per-user algorithm knobs.
-- =============================================================

-- Extensions commonly available in Supabase projects
create extension if not exists "pgcrypto" with schema public; -- for gen_random_uuid()
create extension if not exists "citext" with schema public;   -- case-insensitive text for usernames

-- -------------------------------------------------------------
-- Utility trigger to keep updated_at in sync
-- -------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -------------------------------------------------------------
-- Domain / Types
-- -------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'media_type') then
    create type public.media_type as enum ('photo', 'video');
  end if;
end $$;

-- -------------------------------------------------------------
-- profiles extends auth.users (1:1). "id" must match auth.users.id
-- -------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username citext unique,
  avatar_url text,
  bio text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- -------------------------------------------------------------
-- user_feed_preferences: jsonb bag of weights/filters and algorithm choice
-- -------------------------------------------------------------
create table if not exists public.user_feed_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_user_feed_prefs_set_updated_at
before update on public.user_feed_preferences
for each row execute function public.set_updated_at();

-- -------------------------------------------------------------
-- posts: authored content (text-first; media attached via media table)
-- -------------------------------------------------------------
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  text_content text,
  created_at timestamptz not null default now()
);

create index if not exists idx_posts_created_at on public.posts (created_at desc);
create index if not exists idx_posts_author_id on public.posts (author_id);

-- -------------------------------------------------------------
-- media: photos/videos attached to posts
-- For photo: storage_path must be set
-- For video: mux_playback_id (and optionally mux_asset_id) must be set
-- -------------------------------------------------------------
create table if not exists public.media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  type public.media_type not null,
  storage_path text,          -- for photos in Supabase Storage
  mux_asset_id text,          -- internal Mux asset id (optional for reference)
  mux_playback_id text,       -- required to form HLS playback URL
  width int,
  height int,
  duration_seconds numeric,
  created_at timestamptz not null default now(),
  constraint media_photo_requires_storage check (
    (type <> 'photo') or (type = 'photo' and storage_path is not null)
  ),
  constraint media_video_requires_playback check (
    (type <> 'video') or (type = 'video' and mux_playback_id is not null)
  )
);

create index if not exists idx_media_post_id on public.media (post_id);

-- -------------------------------------------------------------
-- follows: follower graph
-- -------------------------------------------------------------
create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followed_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint follows_self_follow check (follower_id <> followed_id),
  primary key (follower_id, followed_id)
);

create index if not exists idx_follows_follower on public.follows (follower_id);
create index if not exists idx_follows_followed on public.follows (followed_id);

-- -------------------------------------------------------------
-- likes: many-to-many user<->post
-- -------------------------------------------------------------
create table if not exists public.likes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create index if not exists idx_likes_post on public.likes (post_id);
create index if not exists idx_likes_user on public.likes (user_id);

-- -------------------------------------------------------------
-- comments: threaded in future; flat for now
-- -------------------------------------------------------------
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_comments_post on public.comments (post_id);
create index if not exists idx_comments_user on public.comments (user_id);

-- =============================================================
-- Row Level Security (RLS) and policies
-- =============================================================
alter table public.profiles enable row level security;
alter table public.user_feed_preferences enable row level security;
alter table public.posts enable row level security;
alter table public.media enable row level security;
alter table public.follows enable row level security;
alter table public.likes enable row level security;
alter table public.comments enable row level security;

-- profiles policies
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (true);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

-- user_feed_preferences policies
drop policy if exists ufp_select_own on public.user_feed_preferences;
create policy ufp_select_own on public.user_feed_preferences
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists ufp_upsert_own on public.user_feed_preferences;
create policy ufp_upsert_own on public.user_feed_preferences
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- posts policies
drop policy if exists posts_select_all on public.posts;
create policy posts_select_all on public.posts
  for select to authenticated
  using (true);

drop policy if exists posts_insert_own on public.posts;
create policy posts_insert_own on public.posts
  for insert to authenticated
  with check (author_id = auth.uid());

drop policy if exists posts_update_own on public.posts;
create policy posts_update_own on public.posts
  for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

drop policy if exists posts_delete_own on public.posts;
create policy posts_delete_own on public.posts
  for delete to authenticated
  using (author_id = auth.uid());

-- media policies
drop policy if exists media_select_all on public.media;
create policy media_select_all on public.media
  for select to authenticated
  using (true);

drop policy if exists media_insert_if_owns_post on public.media;
create policy media_insert_if_owns_post on public.media
  for insert to authenticated
  with check (
    exists (
      select 1 from public.posts p
      where p.id = post_id and p.author_id = auth.uid()
    )
  );

drop policy if exists media_update_if_owns_post on public.media;
create policy media_update_if_owns_post on public.media
  for update to authenticated
  using (
    exists (
      select 1 from public.posts p
      where p.id = post_id and p.author_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.posts p
      where p.id = post_id and p.author_id = auth.uid()
    )
  );

-- follows policies
drop policy if exists follows_select_all on public.follows;
create policy follows_select_all on public.follows
  for select to authenticated
  using (true);

drop policy if exists follows_insert_self on public.follows;
create policy follows_insert_self on public.follows
  for insert to authenticated
  with check (follower_id = auth.uid());

drop policy if exists follows_delete_self on public.follows;
create policy follows_delete_self on public.follows
  for delete to authenticated
  using (follower_id = auth.uid());

-- likes policies
drop policy if exists likes_select_all on public.likes;
create policy likes_select_all on public.likes
  for select to authenticated
  using (true);

drop policy if exists likes_insert_self on public.likes;
create policy likes_insert_self on public.likes
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists likes_delete_self on public.likes;
create policy likes_delete_self on public.likes
  for delete to authenticated
  using (user_id = auth.uid());

-- comments policies
drop policy if exists comments_select_all on public.comments;
create policy comments_select_all on public.comments
  for select to authenticated
  using (true);

drop policy if exists comments_insert_self on public.comments;
create policy comments_insert_self on public.comments
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists comments_update_self on public.comments;
create policy comments_update_self on public.comments
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists comments_delete_self on public.comments;
create policy comments_delete_self on public.comments
  for delete to authenticated
  using (user_id = auth.uid());

-- Helpful views or grants could be added later as needed.


