-- =============================================================================
-- M43 — Casual Intent Categories
-- =============================================================================
-- WHY
--   Adds support for casual dating intents: Free Tonight, Short Term Fun,
--   and Friends with Benefits. These are distinct from the existing
--   intention field (friendship, dating, both) and allow users to express
--   more specific casual preferences.
--
-- SAFE TO RE-RUN: idempotent
-- =============================================================================

-- Add casual_intent column to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS casual_intent TEXT 
  CHECK (casual_intent IS NULL OR casual_intent IN ('free_tonight', 'short_term_fun', 'friends_with_benefits'));

-- Add index for filtering on casual intent
CREATE INDEX IF NOT EXISTS profiles_casual_intent_idx 
  ON public.profiles (casual_intent) 
  WHERE casual_intent IS NOT NULL;

-- Add to explore_categories table if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'explore_categories') THEN
    -- Insert new casual categories
    INSERT INTO public.explore_categories (id, name, description, icon, is_active, category_type)
    VALUES 
      ('free_tonight', 'Free Tonight', 'Looking for connections tonight', '🌙', true, 'casual'),
      ('short_term_fun', 'Short Term Fun', 'Seeking short-term fun and excitement', '🎉', true, 'casual'),
      ('friends_with_benefits', 'Friends with Benefits', 'Looking for casual relationships with benefits', '🔥', true, 'casual')
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

-- Add casual_intent to the profiles update policy if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'profiles' AND polname = 'profiles_update_own'
  ) THEN
    -- The column will be automatically accessible through existing policies
    RAISE NOTICE 'Casual intent column added; existing RLS policies apply';
  END IF;
END $$;

-- Grant update on casual_intent column to authenticated users (for profile editing)
GRANT UPDATE (casual_intent) ON public.profiles TO authenticated;

-- Posture report
DO $$
BEGIN
  RAISE NOTICE 'M43: Casual intent categories migration complete';
END $$;
