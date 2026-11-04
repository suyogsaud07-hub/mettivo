-- Create message_deletions table for "Delete for Me" functionality
CREATE TABLE IF NOT EXISTS public.message_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(message_id, user_id)
);

ALTER TABLE public.message_deletions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "message_deletions_select_own" ON public.message_deletions;
CREATE POLICY "message_deletions_select_own" ON public.message_deletions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "message_deletions_insert_own" ON public.message_deletions;
CREATE POLICY "message_deletions_insert_own" ON public.message_deletions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "message_deletions_delete_own" ON public.message_deletions;
CREATE POLICY "message_deletions_delete_own" ON public.message_deletions
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS message_deletions_user_idx ON public.message_deletions(user_id);
CREATE INDEX IF NOT EXISTS message_deletions_message_idx ON public.message_deletions(message_id);
