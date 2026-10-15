-- =============================================================================
-- M8 · Interest & prompt catalogue
-- =============================================================================
-- WHY: interests and prompts were string literals duplicated in three places --
-- `mockData.ts` fixtures, hard-coded arrays inside the onboarding wizard, and
-- free-text columns on `profiles`. Nothing stopped a client writing an interest
-- that no other member can ever share, which silently zeroes its match score,
-- and nothing let the curator add a prompt without a code change.
--
-- This migration makes the catalogue DATA:
--   * `interest_categories` — the groups shown in the wizard
--   * `interests`           — the selectable interests, stable ids
--   * `prompt_catalogue`    — the curated questions
--
-- All three are reference data: readable by any signed-in member, writable only
-- by an administrator running SQL. There is deliberately no client write policy.
--
-- The TypeScript boundary (`src/lib/catalogue.ts`) validates user input against
-- these rows, and `MAX_*` limits are enforced there and restated in SQL below.
--
-- SAFE TO RE-RUN: idempotent. Seeds use `on conflict (id) do nothing`, so a
-- curator's later edit to a label is never overwritten by a re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. interest_categories
-- ---------------------------------------------------------------------------
create table if not exists public.interest_categories (
  id         text primary key,
  label      text not null,
  icon       text,
  sort_order integer not null default 0,
  constraint interest_categories_label_len check (char_length(label) between 1 and 60),
  constraint interest_categories_id_shape  check (id ~ '^[a-z0-9_-]+$')
);

-- ---------------------------------------------------------------------------
-- 2. interests
-- ---------------------------------------------------------------------------
create table if not exists public.interests (
  id          text primary key,
  category_id text not null references public.interest_categories(id) on delete restrict,
  label       text not null,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  constraint interests_label_len check (char_length(label) between 1 and 60),
  constraint interests_id_shape  check (id ~ '^[a-z0-9_-]+$')
);

-- The M4 audit fails any unindexed foreign key.
create index if not exists interests_category_idx on public.interests (category_id);
create index if not exists interests_active_sort_idx on public.interests (is_active, sort_order);

-- ---------------------------------------------------------------------------
-- 3. prompt_catalogue
-- ---------------------------------------------------------------------------
create table if not exists public.prompt_catalogue (
  id         text primary key,
  category   text not null,
  question   text not null,
  hint       text,
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  constraint prompt_catalogue_question_len check (char_length(question) between 5 and 200),
  constraint prompt_catalogue_id_shape      check (id ~ '^[a-z0-9_-]+$')
);

create index if not exists prompt_catalogue_active_sort_idx
  on public.prompt_catalogue (is_active, sort_order);

-- ---------------------------------------------------------------------------
-- 4. RLS — reference data, read-only to clients
-- ---------------------------------------------------------------------------
alter table public.interest_categories enable row level security;
alter table public.interests           enable row level security;
alter table public.prompt_catalogue    enable row level security;

drop policy if exists "interest_categories_select_authenticated" on public.interest_categories;
create policy "interest_categories_select_authenticated"
  on public.interest_categories for select to authenticated using (true);

drop policy if exists "interests_select_authenticated" on public.interests;
create policy "interests_select_authenticated"
  on public.interests for select to authenticated using (true);

drop policy if exists "prompt_catalogue_select_authenticated" on public.prompt_catalogue;
create policy "prompt_catalogue_select_authenticated"
  on public.prompt_catalogue for select to authenticated using (true);

-- No INSERT/UPDATE/DELETE policy anywhere: the catalogue is curated by an
-- administrator running SQL, exactly like `user_roles`.

grant select on public.interest_categories to authenticated;
grant select on public.interests           to authenticated;
grant select on public.prompt_catalogue    to authenticated;
revoke all on public.interest_categories from anon;
revoke all on public.interests           from anon;
revoke all on public.prompt_catalogue    from anon;

-- ---------------------------------------------------------------------------
-- 5. Seed — the curated v1 catalogue
-- ---------------------------------------------------------------------------
insert into public.interest_categories (id, label, icon, sort_order) values
  ('outdoors',  'Outdoors & Adventure', '🏔️', 10),
  ('creative',  'Creative',             '🎨', 20),
  ('food',      'Food & Drink',         '🍜', 30),
  ('wellbeing', 'Health & Wellbeing',   '🧘', 40),
  ('culture',   'Culture & Learning',   '📚', 50),
  ('social',    'Social & Nightlife',   '🎶', 60),
  ('pets',      'Pets & Animals',       '🐾', 70),
  ('tech',      'Tech & Gaming',        '🎮', 80)
on conflict (id) do nothing;

insert into public.interests (id, category_id, label, sort_order) values
  ('hiking',            'outdoors',  'Hiking',            10),
  ('trekking',          'outdoors',  'Trekking',          20),
  ('travel',            'outdoors',  'Travel',            30),
  ('camping',           'outdoors',  'Camping',           40),
  ('photography',       'creative',  'Photography',       10),
  ('art',               'creative',  'Art & Design',      20),
  ('music',             'creative',  'Music',             30),
  ('writing',           'creative',  'Writing',           40),
  ('dancing',           'creative',  'Dancing',           50),
  ('cooking',           'food',      'Cooking',           10),
  ('coffee',            'food',      'Coffee & Tea',      20),
  ('street-food',       'food',      'Street Food',       30),
  ('dining-out',        'food',      'Dining Out',        40),
  ('yoga',              'wellbeing', 'Yoga',              10),
  ('fitness',           'wellbeing', 'Gym & Fitness',     20),
  ('running',           'wellbeing', 'Running',           30),
  ('meditation',        'wellbeing', 'Meditation',        40),
  ('reading',           'culture',   'Reading',           10),
  ('movies',            'culture',   'Movies & Series',   20),
  ('history',           'culture',   'History',           30),
  ('volunteering',      'culture',   'Volunteering',      40),
  ('live-music',        'social',    'Live Music',        10),
  ('nightlife',         'social',    'Nightlife',         20),
  ('board-games',       'social',    'Board Games',       30),
  ('dogs',              'pets',      'Dogs',              10),
  ('cats',              'pets',      'Cats',              20),
  ('animal-welfare',    'pets',      'Animal Welfare',    30),
  ('gaming',            'tech',      'Gaming',            10),
  ('coding',            'tech',      'Coding',            20),
  ('startups',          'tech',      'Startups',          30)
on conflict (id) do nothing;

insert into public.prompt_catalogue (id, category, question, hint, sort_order) values
  ('simple-pleasures', 'about-me',  'The simple pleasures I enjoy are…',        'Coffee at sunrise, a good playlist…', 10),
  ('perfect-weekend',  'about-me',  'My perfect weekend looks like…',          'Hiking then momo, then sleep',        20),
  ('unusual-skill',    'about-me',  'An unusual skill I have is…',             'I can name any Nepali district',      30),
  ('green-flag',       'values',    'A green flag I look for is…',             'Kind to waiters',                     40),
  ('important-to-me',  'values',    'Something I care deeply about is…',       'Family, or the mountains',            50),
  ('learn-together',   'together',  'We could learn together…',                'Cooking, or a new language',          60),
  ('first-date',       'together',  'A great first date would be…',            'Street food and a long walk',         70),
  ('makes-me-laugh',   'fun',       'What makes me laugh is…',                 'Bad puns, honestly',                  80),
  ('hidden-gem',       'about-nepal','My favourite place in Nepal is…',        'A quiet spot in Bandipur',            90)
on conflict (id) do nothing;

comment on table public.interests is
  'Curated selectable interests. Reference data, admin-written. Read by the onboarding wizard and the recommendation engine.';
comment on table public.prompt_catalogue is
  'Curated conversation prompts. Reference data, admin-written. Answers live in profiles.prompts keyed by this id.';

-- ---------------------------------------------------------------------------
-- 6. Posture report
-- ---------------------------------------------------------------------------
select
  'interest_categories' as table_name,
  count(*)              as rows
from public.interest_categories
union all
select 'interests', count(*) from public.interests
union all
select 'prompt_catalogue', count(*) from public.prompt_catalogue
order by 1;
