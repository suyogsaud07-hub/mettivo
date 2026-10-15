-- =============================================================================
-- M16 · Game Zone catalogue expansion — playable social mini-games
-- =============================================================================
-- M14 (20261015180000_game_zone.sql) seeded four games, of which only
-- `tic-tac-toe` and `uno-lite` were playable. Everything else the Game Hub
-- offered was a "coming soon" card.
--
-- WHY THIS MIGRATION IS REQUIRED, NOT OPTIONAL
--   `record_game_result()` validates the game id against `public.game_catalog`
--   and rejects an unknown id outright. A new playable game therefore cannot
--   save its score — or even render an honest result — until its catalogue row
--   exists. The UI and the database must agree; adding a game only to the client
--   would ship a button whose result silently fails to record.
--
--   The inserted ids are the exact set the client registry in
--   `src/app/components/games/engine.tsx` renders, and `max_score` is the score
--   ceiling that `record_game_result()` enforces.
--
-- SAFE TO RE-RUN: idempotent. Plain upsert on the primary key, no DDL, no policy
-- changes (the existing `game_catalog_readable` policy and grants already cover
-- these rows). Running it twice is a no-op.
-- =============================================================================

insert into public.game_catalog (game_id, title, is_playable, max_score, sort_order) values
  ('memory-match',     'Memory Match',        true, 100, 5),
  ('word-guess',       'Word Guessing',       true,  60, 6),
  ('icebreaker',       'Icebreaker Trivia',   true,  50, 7),
  ('twenty-questions', '20 Questions',        true,  30, 8),
  ('truth-or-dare',    'Truth or Dare',       true,  15, 9),
  ('spin-the-wheel',   'Spin the Wheel',      true,  20, 10),
  ('speed-matching',   'Speed Matching',      true,  80, 11)
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
