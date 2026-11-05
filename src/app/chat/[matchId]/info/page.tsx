'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Ban,
  Copy,
  EyeOff,
  Image,
  Link as LinkIcon,
  Users,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  blockMember,
} from '@/lib/blocking';
import {
  fetchChatSettings,
  fetchConversationMute,
  setConversationMute,
  setDisappearingMessages,
} from '@/lib/messages';
import { fetchPublicProfile, type PublicProfile } from '@/lib/public-profiles';
import {
  respondToConversationRequest,
} from '@/lib/conversations';

const DISAPPEARING_SECONDS = 86_400;

export default function ChatInfoPage({
  params,
}: {
  params: Promise<{ matchId: string }>;
}) {
  const resolvedParams = use(params);
  const matchId = resolvedParams.matchId;
  const router = useRouter();

  const [match, setMatch] = useState<{
    id: string;
    user_a_id: string;
    user_b_id: string;
    otherUserId: string;
    kind: string;
    request_status: string;
    requested_by: string | null;
  } | null>(null);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [muted, setMuted] = useState<boolean | null>(null);
  const [disappearing, setDisappearing] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace('/auth');
        return;
      }
      setCurrentUserId(user.id);

      const { data: matchRow, error: matchError } = await supabase
        .from('matches')
        .select('id, user_a_id, user_b_id, kind, request_status, requested_by')
        .eq('id', matchId)
        .maybeSingle();

      if (matchError) throw matchError;
      if (!matchRow) {
        setError('Conversation not found.');
        setLoading(false);
        return;
      }

      const other =
        matchRow.user_a_id === user.id
          ? matchRow.user_b_id
          : matchRow.user_a_id;
      setMatch({
        ...matchRow,
        otherUserId: other,
      });

      const [prof, mute, disp] = await Promise.all([
        fetchPublicProfile(other),
        fetchConversationMute(matchId),
        fetchChatSettings(matchId),
      ]);

      setProfile(prof ?? null);
      setMuted(mute ?? false);
      setDisappearing(disp ?? null);
    } catch (err) {
      console.error('[chat info] load failed:', err);
      setError(
        err instanceof Error ? err.message : 'Could not load conversation info.'
      );
    } finally {
      setLoading(false);
    }
  }, [matchId, router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (loading) return null;
  if (!match || !profile || currentUserId === null) return null;

  const isRequestPending =
    match.request_status === 'pending' &&
    match.requested_by !== currentUserId;

  const handleRespond = async (accept: boolean) => {
    setBusy((prev) => new Set([...prev, 'respond']));
    try {
      await respondToConversationRequest(matchId, accept);
      void load();
    } catch (err) {
      console.error('[chat info] respond failed:', err);
      setError(
        err instanceof Error ? err.message : 'That request could not be updated.'
      );
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete('respond');
        return next;
      });
    }
  };

  const handleBlock = async () => {
    setBusy((prev) => new Set([...prev, 'block']));
    try {
      await blockMember(match.otherUserId);
      router.push('/chat');
    } catch (err) {
      console.error('[chat info] block failed:', err);
      setError(
        err instanceof Error ? err.message : 'That member could not be blocked.'
      );
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete('block');
        return next;
      });
    }
  };

  const handleToggleMute = async () => {
    if (muted === null) return;
    setBusy((prev) => new Set([...prev, 'mute']));
    try {
      const next = await setConversationMute(matchId, !muted);
      setMuted(next);
      setError(null);
    } catch (err) {
      console.error('[chat info] mute toggle failed:', err);
      setError(
        err instanceof Error ? err.message : 'We could not update that setting.'
      );
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete('mute');
        return next;
      });
    }
  };

  const handleToggleDisappearing = async () => {
    setBusy((prev) => new Set([...prev, 'disappearing']));
    try {
      const next = await setDisappearingMessages(
        matchId,
        disappearing ? null : DISAPPEARING_SECONDS
      );
      setDisappearing(next ?? null);
    } catch (err) {
      console.error('[chat info] disappearing failed:', err);
      setError(
        err instanceof Error ? err.message : 'We could not update that setting.'
      );
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete('disappearing');
        return next;
      });
    }
  };

  const displayName =
    profile.display_name?.trim() || profile.username || 'Member';
  const isOnline = profile.is_online === true;

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#0D0A10',
        color: '#F2E9E4',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '20px',
          borderBottom: '1px solid #29202D',
          gap: '12px',
        }}
      >
        <button
          onClick={() => router.back()}
          style={{
            background: 'none',
            border: 'none',
            color: '#F2E9E4',
            cursor: 'pointer',
            padding: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          aria-label="Back"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1
            style={{
              fontSize: '20px',
              fontWeight: 700,
              margin: '0 0 4px 0',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {displayName}
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: '13px',
              color: isOnline ? '#5FBF8F' : '#B58A83',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            {isOnline ? 'Online' : 'Offline'}
            {profile.username && (
              <span style={{ fontSize: '11px', color: '#D4B18A' }}>
                • @{profile.username.replace(/^@/, '')}
              </span>
            )}
          </p>
        </div>
      </header>

      {error && (
        <div
          role="alert"
          style={{
            margin: '16px 20px',
            padding: '12px 16px',
            borderRadius: '12px',
            border: '1px solid #4A1828',
            backgroundColor: '#4A1828',
            color: '#F2E9E4',
            fontSize: '13px',
          }}
        >
          {error}
        </div>
      )}

      <main style={{ padding: '20px', flex: 1, overflowY: 'auto' }}>
        {/* Contact header */}
        <section
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '16px',
            padding: '24px 0',
            borderBottom: '1px solid #29202D',
          }}
        >
          <div
            style={{
              position: 'relative',
              width: '96px',
              height: '96px',
            }}
          >
            {profile.avatar_url ? (
              <img loading="lazy"


                src={profile.avatar_url}
                alt={displayName}
                style={{
                  width: '96px',
                  height: '96px',
                  borderRadius: '24px',
                  objectFit: 'cover',
                  display: 'block',
                  border: '2px solid #29202D',
                }}
              />
            ) : (
              <div
                style={{
                  width: '96px',
                  height: '96px',
                  borderRadius: '24px',
                  backgroundColor: '#29202D',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '32px',
                  fontWeight: 700,
                  color: '#D4B18A',
                  border: '2px solid #29202D',
                }}
              >
                {displayName.charAt(0).toUpperCase()}
              </div>
            )}
            {isOnline && (
              <span
                style={{
                  position: 'absolute',
                  right: 0,
                  bottom: 0,
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  backgroundColor: '#5FBF8F',
                  border: '2px solid #0D0A10',
                }}
                aria-label="Online"
              />
            )}
          </div>
          <p
            style={{
              margin: '4px 0 0 0',
              fontSize: '14px',
              fontWeight: 700,
              color: '#F2E9E4',
            }}
          >
            {profile.username ? `@${profile.username.replace(/^@/, '')}` : ''}
          </p>
        </section>

        {/* Pending request actions */}
        {isRequestPending && (
          <section
            style={{
              display: 'flex',
              gap: '10px',
              padding: '0 20px 20px',
              borderBottom: '1px solid #29202D',
            }}
          >
            <button
              onClick={() => void handleRespond(true)}
              disabled={busy.has('respond')}
              style={{
                flex: 1,
                padding: '12px 16px',
                borderRadius: '12px',
                backgroundColor: '#D4B18A',
                color: '#17121C',
                fontSize: '14px',
                fontWeight: 700,
                border: 'none',
                cursor: busy.has('respond') ? 'wait' : 'pointer',
                opacity: busy.has('respond') ? 0.6 : 1,
              }}
            >
              {busy.has('respond') ? 'Accepting…' : 'Accept'}
            </button>
            <button
              onClick={() => void handleRespond(false)}
              disabled={busy.has('respond')}
              style={{
                flex: 1,
                padding: '12px 16px',
                borderRadius: '12px',
                backgroundColor: 'transparent',
                color: '#F2E9E4',
                fontSize: '14px',
                fontWeight: 700,
                border: '1px solid #29202D',
                cursor: busy.has('respond') ? 'wait' : 'pointer',
                opacity: busy.has('respond') ? 0.6 : 1,
              }}
            >
              {busy.has('respond') ? 'Accepting…' : 'Reject'}
            </button>
          </section>
        )}

        {/* Main action buttons */}
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '10px',
            padding: '20px',
            borderBottom: '1px solid #29202D',
          }}
        >
          <button
            onClick={() => router.push(`/profile/${match.otherUserId}`)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '14px',
              borderRadius: '12px',
              backgroundColor: '#1C1822',
              border: '1px solid #29202D',
              color: '#F2E9E4',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Users size={18} strokeWidth={2} />
            Profile
          </button>
          <button
            onClick={() => {
              router.push(`/chat/${matchId}?search=1`);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '14px',
              borderRadius: '12px',
              backgroundColor: '#1C1822',
              border: '1px solid #29202D',
              color: '#F2E9E4',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Copy size={18} strokeWidth={2} />
            Search in Chat
          </button>
          <button
            onClick={handleToggleMute}
            disabled={muted === null || busy.has('mute')}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '14px',
              borderRadius: '12px',
              backgroundColor: muted ? '#D4B18A' : '#1C1822',
              border: '1px solid #29202D',
              color: muted ? '#17121C' : '#F2E9E4',
              fontSize: '14px',
              fontWeight: 600,
              cursor:
                muted === null || busy.has('mute')
                  ? 'wait'
                  : 'pointer',
              opacity: busy.has('mute') ? 0.6 : 1,
            }}
          >
            <EyeOff size={18} strokeWidth={2} />
            {muted ? 'Unmute' : 'Mute'}
          </button>
          <button
            onClick={handleBlock}
            disabled={busy.has('block')}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '14px',
              borderRadius: '12px',
              backgroundColor: '#1C1822',
              border: '1px solid #29202D',
              color: '#F2E9E4',
              fontSize: '14px',
              fontWeight: 600,
              cursor: busy.has('block') ? 'wait' : 'pointer',
              opacity: busy.has('block') ? 0.6 : 1,
            }}
          >
            <Ban size={18} strokeWidth={2} />
            Block
          </button>
        </section>

        {/* Settings list */}
        <section style={{ padding: '20px', borderBottom: '1px solid #29202D' }}>
          <h2
            style={{
              fontSize: '15px',
              fontWeight: 700,
              margin: '0 0 12px 0',
              color: '#F2E9E4',
              letterSpacing: '0.02em',
              textTransform: 'uppercase',
            }}
          >
            Settings
          </h2>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <button
              onClick={() => {
                router.push(`/chat/${matchId}?nickname=1`);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                borderRadius: '10px',
                backgroundColor: '#1C1822',
                border: '1px solid #29202D',
                color: '#F2E9E4',
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              <span>Nicknames</span>
              <span style={{ fontSize: '12px', color: '#B58A83' }}>Set a custom name for this contact</span>
            </button>
            <button
              onClick={handleToggleDisappearing}
              disabled={busy.has('disappearing')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                borderRadius: '10px',
                backgroundColor: '#1C1822',
                border: '1px solid #29202D',
                color: '#F2E9E4',
                fontSize: '14px',
                cursor: busy.has('disappearing') ? 'wait' : 'pointer',
                opacity: busy.has('disappearing') ? 0.6 : 1,
              }}
            >
              <span>Disappearing messages</span>
              <span style={{ fontSize: '12px', color: '#B58A83' }}>
                {disappearing ? 'On (24 hours)' : 'Off'}
              </span>
            </button>
            <button
              onClick={() => {
                router.push(`/profile/${match.otherUserId}?safety=1`);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                borderRadius: '10px',
                backgroundColor: '#1C1822',
                border: '1px solid #29202D',
                color: '#F2E9E4',
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              <span>Privacy &amp; safety</span>
              <span style={{ fontSize: '12px', color: '#B58A83' }}>Manage safety for this conversation</span>
            </button>
          </div>
        </section>

        {/* Shared content tabs */}
        <section style={{ padding: '20px' }}>
          <div
            style={{
              display: 'flex',
              gap: '8px',
              borderBottom: '1px solid #29202D',
              marginBottom: '16px',
            }}
          >
            <button
              style={{
                padding: '8px 14px',
                borderRadius: '8px',
                backgroundColor: '#D4B18A',
                color: '#17121C',
                fontSize: '13px',
                fontWeight: 700,
                border: 'none',
                cursor: 'pointer',
              }}
            >
              <Image size={16} strokeWidth={2} /> Media
            </button>
            <button
              style={{
                padding: '8px 14px',
                borderRadius: '8px',
                backgroundColor: '#1C1822',
                border: '1px solid #29202D',
                color: '#F2E9E4',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <LinkIcon size={16} strokeWidth={2} /> Links
            </button>
          </div>
          <div
            style={{
              padding: '16px',
              borderRadius: '12px',
              backgroundColor: '#1C1822',
              border: '1px solid #29202D',
              color: '#B58A83',
              fontSize: '14px',
              textAlign: 'center',
            }}
          >
            Shared content appears here as you exchange messages.
          </div>
        </section>
      </main>
    </div>
  );
}
