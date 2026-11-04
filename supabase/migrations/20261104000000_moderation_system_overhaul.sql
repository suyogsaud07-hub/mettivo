-- =============================================================================
-- MXX · Moderation system overhaul - 2h to 24h temporary restrictions
-- =============================================================================
-- WHY THIS MIGRATION EXISTS
--   Replace all previous punishment-duration rules (7/15/30 days) with a new
--   temporary restriction system: 2h minimum, 24h maximum. Escalate based on
--   confirmed violations. Subbu AI reviews reports but cannot auto-punish;
--   only confirmed violations trigger punishment. Restricted users get
--   read-only/view-only access.
--
-- SAFE TO RE-RUN: idempotent (guards, if not exists, drop ... if exists).
-- DEPENDS ON: M21, M25, M29, M32, M37 and others.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Track confirmed violations and escalation
-- ---------------------------------------------------------------------------

-- Add columns to track confirmed violations
ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS confirmed_violation_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_violation_at timestamptz;

-- Table to track confirmed violation incidents (distinct incidents)
CREATE TABLE IF NOT EXISTS public.confirmed_violations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  report_id uuid REFERENCES public.reports(id) ON DELETE SET NULL,
  scan_id uuid REFERENCES public.moderation_ai_scans(id) ON DELETE SET NULL,
  category text NOT NULL,
  reason text,
  source text NOT NULL CHECK (source IN ('ai','moderator','auto_threshold')),
  confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  restriction_starts_at timestamptz,
  restriction_ends_at timestamptz,
  restriction_hours integer,
  details jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS confirmed_violations_user_idx ON public.confirmed_violations (user_id, confirmed_at DESC);
CREATE INDEX IF NOT EXISTS confirmed_violations_report_idx ON public.confirmed_violations (report_id);
CREATE INDEX IF NOT EXISTS confirmed_violations_active_idx ON public.confirmed_violations (user_id, restriction_ends_at); 

ALTER TABLE public.confirmed_violations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "confirmed_violations_select_own_or_moderator" ON public.confirmed_violations;
CREATE POLICY "confirmed_violations_select_own_or_moderator"
  ON public.confirmed_violations FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_moderator());

DROP POLICY IF EXISTS "confirmed_violations_insert_moderator_only" ON public.confirmed_violations;
CREATE POLICY "confirmed_violations_insert_moderator_only"
  ON public.confirmed_violations FOR INSERT TO authenticated
  WITH CHECK (public.is_moderator());

DROP POLICY IF EXISTS "confirmed_violations_update_moderator_only" ON public.confirmed_violations;
CREATE POLICY "confirmed_violations_update_moderator_only"
  ON public.confirmed_violations FOR UPDATE TO authenticated
  USING (public.is_moderator());

-- ---------------------------------------------------------------------------
-- 2. Calculate restriction duration based on confirmed violations
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.calculate_restriction_hours(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT COALESCE(confirmed_violation_count, 0) INTO v_count
  FROM public.profiles
  WHERE id = p_user_id;
  
  -- Escalation: 1st=2h, 2nd=4h, 3rd=8h, 4th=12h, 5th+=24h
  CASE v_count + 1  -- Next violation count
    WHEN 1 THEN RETURN 2;
    WHEN 2 THEN RETURN 4;
    WHEN 3 THEN RETURN 8;
    WHEN 4 THEN RETURN 12;
    WHEN 5 THEN RETURN 24;
    ELSE RETURN 24; -- Never exceed 24 hours
  END CASE;
END;
$$;

REVOKE ALL ON FUNCTION public.calculate_restriction_hours(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.calculate_restriction_hours(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Apply temporary restriction (replaces old suspension logic)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.apply_temporary_restriction(
  p_user_id uuid,
  p_category text,
  p_reason text DEFAULT NULL,
  p_source text DEFAULT 'moderator',
  p_report_id uuid DEFAULT NULL,
  p_scan_id uuid DEFAULT NULL,
  p_confirmed_by uuid DEFAULT NULL,
  p_hours integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hours integer;
  v_violation_id uuid;
  v_starts_at timestamptz := now();
  v_ends_at timestamptz;
  v_new_count integer;
BEGIN
  -- Calculate hours if not provided
  IF p_hours IS NULL THEN
    v_hours := public.calculate_restriction_hours(p_user_id);
  ELSE
    -- Enforce 2-24 hour range
    v_hours := GREATEST(2, LEAST(24, p_hours));
  END IF;
  
  v_ends_at := v_starts_at + (v_hours || ' hours')::interval;
  
  -- Check if already restricted
  IF EXISTS (
    SELECT 1 FROM public.suspensions s
    WHERE s.user_id = p_user_id AND s.active AND s.ends_at > now()
  ) THEN
    -- Extend or update existing? For now, don't stack - return existing
    SELECT id INTO v_violation_id FROM public.confirmed_violations
    WHERE user_id = p_user_id AND restriction_ends_at > now()
    ORDER BY confirmed_at DESC LIMIT 1;
    RETURN v_violation_id;
  END IF;
  
  -- Increment violation count
  UPDATE public.profiles
  SET confirmed_violation_count = COALESCE(confirmed_violation_count, 0) + 1,
      last_violation_at = now()
  WHERE id = p_user_id
  RETURNING confirmed_violation_count INTO v_new_count;
  
  -- Create confirmed violation record
  INSERT INTO public.confirmed_violations (
    user_id, report_id, scan_id, category, reason, source,
    confirmed_by, restriction_starts_at, restriction_ends_at,
    restriction_hours, details
  ) VALUES (
    p_user_id, p_report_id, p_scan_id, p_category, 
    COALESCE(p_reason, 'Community guidelines violation'),
    p_source, COALESCE(p_confirmed_by, auth.uid()),
    v_starts_at, v_ends_at, v_hours,
    jsonb_build_object('previous_count', v_new_count - 1)
  ) RETURNING id INTO v_violation_id;
  
  -- Create suspension record (for compatibility with existing system)
  INSERT INTO public.suspensions (user_id, category, reason, source, report_id, scan_id, ends_at, created_by)
  VALUES (p_user_id, p_category, p_reason, p_source, p_report_id, p_scan_id, v_ends_at, p_confirmed_by);
  
  -- Update profile flags
  PERFORM set_config('mettivo.moderation_action', 'on', true);
  UPDATE public.profiles
  SET is_suspended = true,
      suspended_at = now(),
      suspension_reason = COALESCE(p_reason, 'Temporary restriction')
  WHERE id = p_user_id;
  PERFORM set_config('mettivo.moderation_action', 'off', true);
  
  -- Create warning/notification
  INSERT INTO public.moderation_warnings (user_id, report_id, scan_id, category, scope, action, message, created_by)
  VALUES (
    p_user_id, p_report_id, p_scan_id, p_category, 'account', 'account_suspended',
    format('Your account has temporary interaction restrictions for %s hours. Time remaining will be shown in the app. Reason: %s', v_hours, COALESCE(p_reason, 'Community guidelines violation')),
    p_confirmed_by
  );
  
  INSERT INTO public.notifications (user_id, actor_id, type, entity_id, body)
  VALUES (
    p_user_id, null, 'warning', v_violation_id,
    format('Account temporarily restricted (%s hours)', v_hours)
  );
  
  -- Audit log
  INSERT INTO public.admin_audit_log (actor_id, action, target_user_id, target_report_id, details)
  VALUES (
    COALESCE(p_confirmed_by, auth.uid()),
    'moderation.temporary_restriction',
    p_user_id,
    p_report_id,
    jsonb_build_object('hours', v_hours, 'category', p_category, 'violation_count', v_new_count, 'source', p_source)
  );
  
  RETURN v_violation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_temporary_restriction(uuid, text, text, text, uuid, uuid, uuid, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.apply_temporary_restriction(uuid, text, text, text, uuid, uuid, uuid, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Update my_restrictions to include new info
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.my_restrictions()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me uuid := auth.uid();
  susp record;
  viol record;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING errcode = '28000';
  END IF;

  -- Get active suspension
  SELECT s.ends_at, s.reason, s.category INTO susp
  FROM public.suspensions s
  WHERE s.user_id = me AND s.active AND s.ends_at > now()
  ORDER BY s.ends_at DESC LIMIT 1;

  -- Get violation details
  SELECT cv.restriction_starts_at, cv.restriction_hours, cv.reason as viol_reason INTO viol
  FROM public.confirmed_violations cv
  WHERE cv.user_id = me AND cv.restriction_ends_at > now()
  ORDER BY cv.confirmed_at DESC LIMIT 1;

  RETURN jsonb_build_object(
    'chat_banned', false,
    'chat_until', null,
    'video_banned', false,
    'video_until', null,
    'suspended', susp.ends_at IS NOT NULL,
    'suspended_until', susp.ends_at,
    'suspended_reason', COALESCE(susp.reason, viol.viol_reason),
    'restriction_starts_at', viol.restriction_starts_at,
    'restriction_hours', viol.restriction_hours,
    'is_read_only', susp.ends_at IS NOT NULL AND susp.ends_at > now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.my_restrictions() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.my_restrictions() TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Update admin functions to use new system
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_apply_moderation_action(
  p_target_user uuid,
  p_category text,
  p_scope text DEFAULT 'account',
  p_note text DEFAULT NULL,
  p_hours integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_moderator() THEN
    RAISE EXCEPTION 'Moderator access required' USING errcode = '42501';
  END IF;
  IF p_target_user IS NULL THEN
    RAISE EXCEPTION 'A target member is required' USING errcode = '22023';
  END IF;
  IF p_target_user = auth.uid() THEN
    RAISE EXCEPTION 'You cannot restrict yourself' USING errcode = '22023';
  END IF;
  IF public.is_staff_user(p_target_user) AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only a super admin can restrict a staff account' USING errcode = '42501';
  END IF;
  
  -- Enforce 2-24 hour range
  IF p_hours IS NOT NULL THEN
    p_hours := GREATEST(2, LEAST(24, p_hours));
  END IF;
  
  RETURN public.apply_temporary_restriction(
    p_target_user, p_category, p_note, 'moderator', NULL, NULL, auth.uid(), p_hours
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_apply_moderation_action(uuid, text, text, text, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_apply_moderation_action(uuid, text, text, text, integer) TO authenticated;

-- Keep old signature for compatibility
CREATE OR REPLACE FUNCTION public.admin_apply_moderation_action(
  p_target_user uuid,
  p_category text,
  p_scope text DEFAULT 'account',
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public.admin_apply_moderation_action(p_target_user, p_category, p_scope, p_note, NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_apply_moderation_action(uuid, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_apply_moderation_action(uuid, text, text, text) TO authenticated;

-- Update admin suspend/unsuspend
CREATE OR REPLACE FUNCTION public.admin_suspend_user(
  p_target_user uuid,
  p_reason text DEFAULT NULL,
  p_hours integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_viol_id uuid;
BEGIN
  IF NOT public.is_moderator() THEN
    RAISE EXCEPTION 'Moderator access required' USING errcode = '42501';
  END IF;
  IF p_target_user IS NULL THEN
    RAISE EXCEPTION 'p_target_user is required' USING errcode = '22023';
  END IF;
  IF p_target_user = auth.uid() THEN
    RAISE EXCEPTION 'You cannot suspend yourself' USING errcode = '22023';
  END IF;
  IF public.is_staff_user(p_target_user) AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only a super admin can suspend a staff account' USING errcode = '42501';
  END IF;
  
  v_viol_id := public.apply_temporary_restriction(
    p_target_user, 'other', p_reason, 'moderator', NULL, NULL, auth.uid(), p_hours
  );
  
  RETURN jsonb_build_object('ok', true, 'user_id', p_target_user, 'suspended', true, 'violation_id', v_viol_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_suspend_user(uuid, text, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_suspend_user(uuid, text, integer) TO authenticated;

-- Keep old signature
CREATE OR REPLACE FUNCTION public.admin_suspend_user(
  p_target_user uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public.admin_suspend_user(p_target_user, p_reason, NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_suspend_user(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_suspend_user(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_unsuspend_user(p_target_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_moderator() THEN
    RAISE EXCEPTION 'Moderator access required' USING errcode = '42501';
  END IF;
  IF p_target_user IS NULL THEN
    RAISE EXCEPTION 'p_target_user is required' USING errcode = '22023';
  END IF;
  IF public.is_staff_user(p_target_user) AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only a super admin can restore a staff account' USING errcode = '42501';
  END IF;

  -- End active suspensions
  UPDATE public.suspensions
  SET active = false, updated_at = now()
  WHERE user_id = p_target_user AND active AND ends_at > now();
  
  UPDATE public.confirmed_violations
  SET restriction_ends_at = now()
  WHERE user_id = p_target_user AND restriction_ends_at > now();
  
  UPDATE public.profiles
  SET is_suspended = false,
      suspended_at = null,
      suspension_reason = null
  WHERE id = p_target_user;

  INSERT INTO public.admin_audit_log (actor_id, action, target_user_id)
  VALUES (auth.uid(), 'user.unsuspended', p_target_user);

  RETURN jsonb_build_object('ok', true, 'user_id', p_target_user, 'suspended', false);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_unsuspend_user(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_unsuspend_user(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Update Subbu self-ban to use new system (2h-24h)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.apply_self_ban(integer, text);
CREATE OR REPLACE FUNCTION public.apply_self_ban(
  p_duration_hours integer,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me uuid := auth.uid();
  reason text := left(coalesce(nullif(trim(p_reason), ''), 'community_guidelines'), 120);
  v_hours integer;
  v_viol_id uuid;
  v_ends_at timestamptz;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING errcode = '28000';
  END IF;

  -- Enforce 2-24 hour range
  v_hours := GREATEST(2, LEAST(24, p_duration_hours));
  v_ends_at := now() + (v_hours || ' hours')::interval;

  -- Use new restriction system
  v_viol_id := public.apply_temporary_restriction(
    me, 'other', reason, 'ai', NULL, NULL, NULL, v_hours
  );

  RETURN jsonb_build_object('ok', true, 'banned_until', v_ends_at, 'reason', reason, 'hours', v_hours);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_self_ban(integer, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.apply_self_ban(integer, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT ON public.confirmed_violations TO authenticated;

COMMIT;

-- =============================================================================
-- Update existing apply_moderation_action to use new system
-- =============================================================================

CREATE OR REPLACE FUNCTION public.apply_moderation_action(
  p_user      uuid,
  p_category  text,
  p_scope     text,
  p_source    text,
  p_report_id uuid DEFAULT NULL,
  p_scan_id   uuid DEFAULT NULL,
  p_note      text DEFAULT NULL,
  p_actor     uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_viol_id uuid;
BEGIN
  -- For underage, still might need special handling, but use new system
  v_viol_id := public.apply_temporary_restriction(
    p_user, p_category, p_note, p_source, p_report_id, p_scan_id, p_actor, NULL
  );
  RETURN v_viol_id;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_moderation_action(uuid, text, text, text, uuid, uuid, text, uuid) FROM public, anon, authenticated;