'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Modal } from '@/app/components/ui/Modal';
import { sendMessage } from '@/lib/messages';
import { fetchPublicIdentities } from '@/lib/public-profiles';

interface ForwardRecipient {
  matchId: string;
  otherUserId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
}

interface ForwardModalProps {
  isOpen: boolean;
  onClose: () => void;
  messageContent: string;
  currentUserId: string | null;
}

export default function ForwardModal({
  isOpen,
  onClose,
  messageContent,
  currentUserId,
}: ForwardModalProps) {
  const [recipients, setRecipients] = useState<ForwardRecipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forwarding, setForwarding] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!isOpen || !currentUserId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('matches')
          .select('id, user_a_id, user_b_id')
          .or(`user_a_id.eq.${currentUserId},user_b_id.eq.${currentUserId}`)
          .order('updated_at', { ascending: false });

        if (cancelled) return;
        if (error) throw error;

        const rows = data ?? [];
        const otherUserIds = rows.map((m) =>
          m.user_a_id === currentUserId ? m.user_b_id : m.user_a_id
        );

        const identities = await fetchPublicIdentities(otherUserIds);

        const list: ForwardRecipient[] = rows.map((m) => {
          const otherUserId = m.user_a_id === currentUserId ? m.user_b_id : m.user_a_id;
          const identity = identities.get(otherUserId);
          return {
            matchId: m.id,
            otherUserId,
            displayName: identity?.display_name ?? 'Member',
            username: identity?.username ?? null,
            avatarUrl: identity?.avatar_url ?? null,
          };
        });
        setRecipients(list);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load conversations.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, currentUserId]);

  const handleSelect = useCallback(
    async (matchId: string) => {
      if (!currentUserId || forwarding) return;
      setForwarding(matchId);
      setError(null);
      try {
        await sendMessage(matchId, messageContent);
        setSent(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Forwarding failed.');
      } finally {
        setForwarding(null);
      }
    },
    [currentUserId, messageContent, forwarding]
  );

  if (!isOpen) return null;

  if (sent) {
    return (
      <Modal isOpen onClose={onClose} title="Message forwarded" width="sm">
        <div className="space-y-4">
          <p className="text-sm text-[#F2E9E4]">
            Your message has been forwarded to this conversation.
          </p>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-[#C24A6E] text-[#17121C] font-semibold hover:bg-[#B33E5E]"
            >
              Done
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal isOpen onClose={onClose} title="Forward message" width="md">
      <div className="space-y-4">
        <p className="text-xs text-[#B58A83]">
          Select a conversation to forward this message to:
        </p>

        {loading && (
          <div className="flex items-center justify-center py-8 text-[#B58A83] text-sm">
            Loading conversations…
          </div>
        )}

        {!loading && recipients.length === 0 && (
          <div className="flex items-center justify-center py-8 text-[#B58A83] text-sm">
            No conversations available to forward to.
          </div>
        )}

        {!loading && recipients.length > 0 && (
          <div className="space-y-1">
            {recipients.map((r) => (
              <button
                key={r.matchId}
                type="button"
                onClick={() => handleSelect(r.matchId)}
                disabled={forwarding !== null}
                className={`w-full text-left px-4 py-3 rounded-xl border flex items-center justify-between transition-colors ${
                  forwarding === r.matchId
                    ? 'bg-[#29202D] opacity-70 cursor-not-allowed'
                    : 'border-[#34283F] hover:bg-[#29202D] hover:border-[#4A3E55]'
                }`}
              >
                <div className="flex items-center gap-3">
                  {r.avatarUrl ? (
                    <img
                      src={r.avatarUrl}
                      alt=""
                      className="w-8 h-8 rounded-full border border-[#34283F] object-cover"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-[#29202D] border border-[#34283F] flex items-center justify-center text-xs">
                      ?
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-[#F2E9E4] truncate">
                      {r.displayName}
                    </div>
                    <div className="text-[10px] text-[#6B5B79] truncate">
                      Conversation
                    </div>
                  </div>
                  <ArrowRight size={14} strokeWidth={2} className="text-[#6B5B79]" />
                </div>
              </button>
            ))}
          </div>
        )}

        {error && (
          <div className="p-3 rounded-xl bg-[#C24A6E]/10 border border-[#C24A6E]/30 text-[#C24A6E] text-sm">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={forwarding !== null}
            className="px-4 py-2 rounded-xl border border-[#34283F] text-[#F2E9E4] hover:bg-[#29202D] disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
