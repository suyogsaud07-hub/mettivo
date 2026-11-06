-- =============================================================================
-- M50 · pinned_messages: require match participation for inserts
-- =============================================================================
-- WHY
--   The existing insert policy "pinned_messages_insert_own" only checks
--   `auth.uid() = user_id`, so any authenticated member can pin a message from
--   any conversation they do not participate in. The select and delete policies
--   already scope to participants, but insert was missing that guard. This
--   migration adds a match-participation `WITH CHECK` so a member may only pin
--   messages in a match they belong to.
--
-- SAFE TO RE-RUN: `drop policy if exists` before `create policy`.
-- =============================================================================

-- Re-create the insert policy with a match-participation guard.
drop policy if exists "pinned_messages_insert_own" on public.pinned_messages;
create policy "pinned_messages_insert_own"
  on public.pinned_messages for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.matches m
      where m.id = pinned_messages.match_id
        and (m.user_a = auth.uid() or m.user_b = auth.uid())
    )
  );

-- Ensure grants remain correct.
grant select, insert, delete on public.pinned_messages to authenticated;
revoke all on public.pinned_messages from anon;

comment on policy "pinned_messages_insert_own" on public.pinned_messages is
  'A member may only pin messages in a match they participate in, and only their own pin.';
