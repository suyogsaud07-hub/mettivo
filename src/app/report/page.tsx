"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/app/components/ui/Button";
import { Input } from "@/app/components/ui/Input";
import { Card } from "@/app/components/ui/Card";
import { Badge } from "@/app/components/ui/Badge";
import { Modal } from "@/app/components/ui/Modal";
import { Avatar } from "@/app/components/ui/Avatar";
import { useRouter, useSearchParams } from "next/navigation";
import { type ReportRow, type BlockedUserRow, type BlockedUserWithProfile } from "@/lib/types";

const REPORT_REASONS = [
  { value: "harassment", label: "Harassment or hate speech" },
  { value: "fake_profile", label: "Fake profile or scam" },
  { value: "inappropriate", label: "Inappropriate content" },
  { value: "underage", label: "Underage user" },
  { value: "other", label: "Other" },
] as const;

/**
 * `/report` reads URL params to auto-open the report/block modal, and
 * `useSearchParams()` triggers a client-side render bailout. Next.js requires
 * that hook to sit behind a Suspense boundary, otherwise static prerendering
 * fails the production build with:
 *   "useSearchParams() should be wrapped in a suspense boundary at page /report"
 */
export default function ReportPage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: '#0D0A10',
            color: '#D4B18A',
          }}
        >
          Loading...
        </div>
      }
    >
      <ReportContent />
    </Suspense>
  );
}

function ReportContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // State for reported users (from reports table)
  const [reportedUsers, setReportedUsers] = useState<ReportRow[]>([]);

  // State for blocked users (from blocked_users table joined with profiles)
  const [blockedUsers, setBlockedUsers] = useState<BlockedUserWithProfile[]>([]);

  // Modal state
  const [modal, setModal] = useState<{ open: boolean; userId: string; userName?: string; userAvatar?: string } | null>(null);
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");

  // Loading states
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [blocking, setBlocking] = useState<string | null>(null);
  const [unblocking, setUnblocking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load initial data: reports and blocks for current user
  const loadData = useCallback(async () => {
    try {
      setLoadingInitial(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/auth');
        return;
      }

      // Fetch reports made by current user
      const { data: reports, error: reportsError } = await supabase
        .from('reports')
        .select('*')
        .eq('reporter_id', user.id)
        .order('created_at', { ascending: false });

      if (reportsError) {
        console.error('Failed to load reports:', reportsError.message);
      } else {
        setReportedUsers((reports ?? []) as ReportRow[]);
      }

      // Fetch blocked users with their profile info
      const { data: blocks, error: blocksError } = await supabase
        .from('blocked_users')
        .select(`
          *,
          blocked_profile:profiles!blocked_user_id (
            id,
            display_name,
            avatar_url
          )
        `)
        .eq('blocker_id', user.id)
        .order('created_at', { ascending: false });

      if (blocksError) {
        console.error('Failed to load blocked users:', blocksError.message);
      } else {
        setBlockedUsers((blocks ?? []) as BlockedUserWithProfile[]);
      }
    } catch (err) {
      console.error('Unexpected error loading data:', err);
      setError('Could not load your safety data. Please try again.');
    } finally {
      setLoadingInitial(false);
    }
  }, [router]);

  // Declared before the effects that depend on them: referencing a `const`
  // before its declaration is a temporal dead zone error, and an unmemoized
  // function in a dependency array re-triggers the effect on every render.
  const openReportModal = useCallback(
    (userId: string, userName?: string, userAvatar?: string) => {
      setModal({ open: true, userId, userName, userAvatar });
      setReason("");
      setDetails("");
    },
    []
  );

  const closeModal = useCallback(() => {
    setModal(null);
  }, []);

  // `loadData` only calls setState after an `await`, so this is a one-shot mount
  // fetch rather than a synchronous setState that cascades renders.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData();
  }, [loadData]);

  // Auto-open modal from URL params (e.g. /report?report=u123 or /report?block=u123)
  useEffect(() => {
    // `??` narrows the value to `string`; `a || b` leaves it `string | null`.
    const targetUserId = searchParams.get('report') ?? searchParams.get('block');

    if (!targetUserId) return;

    // Open the modal once the data has loaded.
    const timeoutId = setTimeout(() => openReportModal(targetUserId), 500);
    return () => clearTimeout(timeoutId);
  }, [searchParams, openReportModal]);

  const handleReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modal || !reason) return;

    setSubmitting(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError('You must be signed in to report a user.');
        return;
      }

      // Insert report into Supabase
      const { error: insertError } = await supabase
        .from('reports')
        .insert({
          reporter_id: user.id,
          reported_user_id: modal.userId,
          reason,
          details: reason === 'other' ? details.trim() : null,
        });

      if (insertError) {
        // Handle duplicate report error
        if (insertError.code === '23505') {
          setError('You have already reported this user.');
        } else {
          console.error('Failed to submit report:', insertError.message);
          setError(`Could not submit report: ${insertError.message}`);
        }
        return;
      }

      // Refresh reports list
      await loadData();
      closeModal();
      alert("Report submitted successfully. Our safety team will review it within 24 hours.");
    } catch (err) {
      console.error('Unexpected error submitting report:', err);
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleBlock = async () => {
    if (!modal) return;

    setBlocking(modal.userId);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError('You must be signed in to block a user.');
        return;
      }

      // Insert block into Supabase
      const { error: insertError } = await supabase
        .from('blocked_users')
        .insert({
          blocker_id: user.id,
          blocked_user_id: modal.userId,
        });

      if (insertError) {
        // Handle duplicate block error
        if (insertError.code === '23505') {
          setError('You have already blocked this user.');
        } else {
          console.error('Failed to block user:', insertError.message);
          setError(`Could not block user: ${insertError.message}`);
        }
        return;
      }

      // Refresh blocked users list
      await loadData();
      closeModal();
      alert("User blocked successfully. They will no longer appear in your discover feed or messages.");
    } catch (err) {
      console.error('Unexpected error blocking user:', err);
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setBlocking(null);
    }
  };

  const handleUnblock = async (blockedUserId: string) => {
    setUnblocking(blockedUserId);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Delete block from Supabase
      const { error: deleteError } = await supabase
        .from('blocked_users')
        .delete()
        .eq('blocker_id', user.id)
        .eq('blocked_user_id', blockedUserId);

      if (deleteError) {
        console.error('Failed to unblock user:', deleteError.message);
        setError(`Could not unblock user: ${deleteError.message}`);
        return;
      }

      // Refresh blocked users list
      await loadData();
      alert("User unblocked successfully.");
    } catch (err) {
      console.error('Unexpected error unblocking user:', err);
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setUnblocking(null);
    }
  };

  const getReasonLabel = (value: string) => {
    return REPORT_REASONS.find(r => r.value === value)?.label || value;
  };

  return (
    <div className="pb-6">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-neutral-200 dark:border-neutral-800">
        <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">
          Safety & Reporting
        </h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-500">
          Keep our community safe
        </p>
      </div>

      {error && (
        <div className="mx-4 mt-4 p-3 rounded-xl bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-sm">
          {error}
        </div>
      )}

      {/* Reported users */}
      {reportedUsers.length > 0 && (
        <div className="px-4 py-4">
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-3">
            Your Reports ({reportedUsers.length})
          </h2>
          <div className="space-y-2">
            {reportedUsers.map((report) => (
              <Card key={report.id} className="p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Avatar
                      src="/next.svg"
                      alt={report.reported_user_id}
                      fallback={report.reported_user_id.slice(0, 2).toUpperCase()}
                      size="md"
                    />
                    <div className="flex-1 space-y-1">
                      <p className="font-medium text-neutral-900 dark:text-neutral-100">
                        User: {report.reported_user_id.slice(0, 8)}...
                      </p>
                      <p className="text-sm text-neutral-500 dark:text-neutral-500">
                        {getReasonLabel(report.reason)}
                        {report.details && ` - ${report.details}`}
                      </p>
                    </div>
                  </div>
                  <Badge variant={report.status === 'pending' ? 'warning' : report.status === 'actioned' ? 'error' : 'success'}>
                    {report.status}
                  </Badge>
                </div>
                <p className="text-xs text-neutral-400 mt-1">
                  Submitted: {new Date(report.created_at).toLocaleDateString()}
                </p>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Blocked users */}
      {blockedUsers.length > 0 && (
        <div className="px-4 py-4">
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-3">
            Blocked Users ({blockedUsers.length})
          </h2>
          <div className="space-y-2">
            {blockedUsers.map((block) => {
              const profile = block.blocked_profile;
              return (
                <Card key={block.id} className="p-3">
                  <div className="flex items-center gap-3">
                    <Avatar
                      src={profile?.avatar_url || "/next.svg"}
                      alt={profile?.display_name || 'User'}
                      fallback={profile?.display_name?.slice(0, 2).toUpperCase() || '??'}
                      size="md"
                    />
                    <div className="flex-1 space-y-1">
                      <p className="font-medium text-neutral-900 dark:text-neutral-100">
                        {profile?.display_name || 'Unknown User'}
                      </p>
                      <p className="text-sm text-neutral-500 dark:text-neutral-500">
                        Blocked: {new Date(block.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleUnblock(block.blocked_user_id)}
                      disabled={unblocking === block.blocked_user_id}
                    >
                      {unblocking === block.blocked_user_id ? 'Unblocking...' : 'Unblock'}
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* How to report */}
      <div className="px-4 py-4 border-t border-neutral-200 dark:border-neutral-800">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-3">
          How to report a user
        </h2>
        <div className="space-y-3">
          <p className="text-neutral-600 dark:text-neutral-400">
            If someone makes you feel unsafe or violates our community guidelines, you can report them from their profile or chat.
          </p>
          <div className="space-y-2">
            <p className="font-medium text-neutral-700 dark:text-neutral-300">
              When to report:
            </p>
            <ul className="list-disc list-inside space-y-1 text-sm text-neutral-600 dark:text-neutral-500">
              <li>Harassment or hate speech</li>
              <li>Fake profiles or scams</li>
              <li>Inappropriate content</li>
              <li>Violence or threats</li>
              <li>Underage users</li>
            </ul>
          </div>
          <div className="space-y-2">
            <p className="font-medium text-neutral-700 dark:text-neutral-300">
              What happens next:
            </p>
            <ul className="list-disc list-inside space-y-1 text-sm text-neutral-600 dark:text-neutral-500">
              <li>
                Our safety team reviews the report within 24 hours.
              </li>
              <li>
                We may issue warnings, temporary suspensions, or permanent bans.
              </li>
              <li>
                All reports are anonymous and confidential.
              </li>
            </ul>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => router.push("/discover")}
          className="w-full"
        >
          Back to Discover
        </Button>
      </div>

      {/* Report modal */}
      {modal && (
        <Modal
          isOpen={true}
          onClose={closeModal}
          title="Report user"
          width="md"
        >
          <form onSubmit={handleReport}>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Reason for reporting
                </label>
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
                  disabled={submitting}
                >
                  <option value="">Select a reason...</option>
                  {REPORT_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              {reason === "other" && (
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Please explain
                  </label>
                  <textarea
                    rows={3}
                    value={details}
                    onChange={(e) => setDetails(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
                    placeholder="Tell us more about what happened..."
                    disabled={submitting}
                  />
                </div>
              )}
              {error && (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-sm">
                  {error}
                </div>
              )}
              <div className="flex justify-end">
                <Button
                  variant="ghost"
                  onClick={closeModal}
                  disabled={submitting}
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  type="submit"
                  disabled={!reason || (reason === "other" && !details.trim()) || submitting}
                  loading={submitting}
                >
                  Submit report
                </Button>
              </div>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}