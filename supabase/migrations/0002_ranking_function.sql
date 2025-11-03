-- =============================================================
-- 0002_ranking_function.sql
-- Custom heuristic ranking in Postgres.
-- Returns posts with a computed final_score based on user preferences.
-- =============================================================

create or replace function public.get_custom_ranked_feed(
  requesting_user_id uuid,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  post_id uuid,
  author_id uuid,
  text_content text,
  created_at timestamptz,
  like_count integer,
  comment_count integer,
  is_from_followed boolean,
  recency_score numeric,
  final_score numeric,
  media_type text,
  mux_playback_id text,
  storage_path text
)
language plpgsql
as $$
declare
  prefs jsonb;
  like_weight numeric := 1.0;
  comment_weight numeric := 0.5;
  follower_weight numeric := 1.0;
  recency_weight numeric := 1.0;
begin
  -- Load user preferences (jsonb). If none, defaults are used.
  select preferences into prefs
  from public.user_feed_preferences
  where user_id = requesting_user_id;

  if prefs is not null then
    begin
      like_weight := coalesce((prefs ->> 'like_weight')::numeric, like_weight);
    exception when others then null; end;
    begin
      comment_weight := coalesce((prefs ->> 'comment_weight')::numeric, comment_weight);
    exception when others then null; end;
    begin
      follower_weight := coalesce((prefs ->> 'follower_weight')::numeric, follower_weight);
    exception when others then null; end;
    begin
      recency_weight := coalesce((prefs ->> 'recency_weight')::numeric, recency_weight);
    exception when others then null; end;
  end if;

  -- Compute feed with basic engagement + follow + recency features
  return query
  with post_base as (
    select p.id as post_id,
           p.author_id,
           p.text_content,
           p.created_at
    from public.posts p
  ),
  like_agg as (
    select l.post_id, count(*)::int as like_count
    from public.likes l
    group by l.post_id
  ),
  comment_agg as (
    select c.post_id, count(*)::int as comment_count
    from public.comments c
    group by c.post_id
  ),
  follow_flags as (
    select b.post_id,
           exists (
             select 1 from public.follows f
             where f.follower_id = requesting_user_id
               and f.followed_id = b.author_id
           ) as is_from_followed
    from post_base b
  ),
  media_one as (
    -- For each post, pick one media row (if any). If multiple, prefer the most recent.
    select m.post_id,
           m.type::text as media_type,
           m.mux_playback_id,
           m.storage_path,
           row_number() over (partition by m.post_id order by m.created_at desc) as rn
    from public.media m
  ),
  joined as (
    select b.post_id,
           b.author_id,
           b.text_content,
           b.created_at,
           coalesce(la.like_count, 0) as like_count,
           coalesce(ca.comment_count, 0) as comment_count,
           coalesce(ff.is_from_followed, false) as is_from_followed,
           -- Recency feature decays with hours since posted; tuned for simplicity
           (1.0 / (1.0 + extract(epoch from (now() - b.created_at)) / 3600.0))::numeric as recency_score,
           mo.media_type,
           mo.mux_playback_id,
           mo.storage_path
    from post_base b
    left join like_agg la on la.post_id = b.post_id
    left join comment_agg ca on ca.post_id = b.post_id
    left join follow_flags ff on ff.post_id = b.post_id
    left join media_one mo on mo.post_id = b.post_id and mo.rn = 1
  )
  select j.post_id,
         j.author_id,
         j.text_content,
         j.created_at,
         j.like_count,
         j.comment_count,
         j.is_from_followed,
         j.recency_score,
         (like_weight * j.like_count
          + comment_weight * j.comment_count
          + follower_weight * (case when j.is_from_followed then 1 else 0 end)
          + recency_weight * j.recency_score)::numeric as final_score,
         j.media_type,
         j.mux_playback_id,
         j.storage_path
  from joined j
  order by final_score desc nulls last, j.created_at desc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
end;
$$;

comment on function public.get_custom_ranked_feed(uuid, integer, integer)
is 'Returns posts ranked by user-specific weights (likes, comments, follows, recency).';


