-- =============================================================================
-- M30 · Ludo Royale & Ludo Dash — playable solo against bots
-- =============================================================================
-- M14 (20261015180000_game_zone.sql) seeded four games and left both Ludo
-- variants `is_playable = false` on purpose: they needed realtime turn
-- synchronisation this build did not have. They now have a full local rules
-- engine and bot opponent (`src/app/components/games/ludo.ts`), so a player can
-- finish a whole game on-device and record the result.
--
-- WHY THIS MIGRATION IS REQUIRED, NOT OPTIONAL
--   `record_game_result()` rejects a game id that is not playable, and rejects a
--   score above its `max_score`. The client registry now launches both variants
--   with a ceiling of 100, so the catalogue must agree or a finished game would
--   fail to save its result. The UI and the database must stay in step.
--
-- SAFE TO RE-RUN: idempotent upsert on the primary key. No DDL, no policy or
-- grant changes — the existing `game_catalog_readable` policy already covers
-- these rows.
-- =============================================================================

insert into public.game_catalog (game_id, title, is_playable, max_score, sort_order) values
  ('ludo-royale', 'Ludo Royale', true, 100, 3),
  ('ludo-dash',   'Ludo Dash',   true, 100, 4)
on conflict (game_id) do update
  set title       = excluded.title,
      is_playable = excluded.is_playable,
      max_score   = excluded.max_score,
      sort_order  = excluded.sort_order;

-- Report the resulting posture, so applying this by hand in the SQL Editor
-- shows what changed rather than returning silently.
select
  count(*) filter (where is_playable) as playable_games,
  count(*)                            as total_games
from public.game_catalog;
