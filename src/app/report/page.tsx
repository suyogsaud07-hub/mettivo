"use client";

import { useState } from "react";
import { Button } from "@/app/components/ui/Button";
import { Input } from "@/app/components/ui/Input";
import { Card } from "@/app/components/ui/Card";
import { Badge } from "@/app/components/ui/Badge";
import { Modal } from "@/app/components/ui/Modal";
import { Avatar } from "@/app/components/ui/Avatar";

export default function ReportPage() {
  const [reportedUsers, setReportedUsers] = useState<string[]>([]);
  const [blockedUsers, setBlockedUsers] = useState<string[]>([]);
  const [modal, setModal] = useState<{ open: boolean; userId: string } | null>(null);
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");

  const demoUsers = [
    { id: "u1", name: "Maya", age: 27, city: "San Francisco" },
    { id: "u2", name: "Jordan", age: 29, city: "Oakland" },
    { id: "u3", name: "Alex", age: 26, city: "Berkeley" },
    { id: "u4", name: "Priya", age: 28, city: "San Jose" },
    { id: "u5", name: "Sam", age: 30, city: "San Francisco" },
  ];

  const openReportModal = (userId: string) => {
    setModal({ open: true, userId });
    setReason("");
    setDetails("");
  };

  const closeModal = () => {
    setModal(null);
  };

  const handleReport = () => {
    if (!modal) return;
    // Simulate reporting
    setReportedUsers((prev) => [...prev, modal.userId]);
    closeModal();
    alert("Report submitted. Our team will review it.");
  };

  const handleBlock = () => {
    if (!modal) return;
    setBlockedUsers((prev) => [...prev, modal.userId]);
    closeModal();
    alert("User blocked.");
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

      {/* Reported users */}
      {reportedUsers.length > 0 && (
        <div className="px-4 py-4">
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-3">
            Recently reported
          </h2>
          <div className="space-y-2">
            {reportedUsers.map((userId) => {
              const user = demoUsers.find((u) => u.id === userId);
              if (!user) return null;
              return (
                <div
                  key={userId}
                  className="flex items-center gap-3 p-3 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800"
                >
                  <Avatar
                    src={"/next.svg"}
                    alt={user.name}
                    fallback={user.name}
                    size="md"
                  />
                  <div className="flex-1 space-y-1">
                    <p className="font-medium text-neutral-900 dark:text-neutral-100">
                      {user.name}
                    </p>
                    <p className="text-sm text-neutral-500 dark:text-neutral-500">
                      {user.age}, {user.city}
                    </p>
                  </div>
                  <span className="text-xs text-rose-500">
                    Reported
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Blocked users */}
      {blockedUsers.length > 0 && (
        <div className="px-4 py-4">
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-3">
            Blocked users
          </h2>
          <div className="space-y-2">
            {blockedUsers.map((userId) => {
              const user = demoUsers.find((u) => u.id === userId);
              if (!user) return null;
              return (
                <div
                  key={userId}
                  className="flex items-center gap-3 p-3 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800"
                >
                  <Avatar
                    src={"/next.svg"}
                    alt={user.name}
                    fallback={user.name}
                    size="md"
                  />
                  <div className="flex-1 space-y-1">
                    <p className="font-medium text-neutral-900 dark:text-neutral-100">
                      {user.name}
                    </p>
                    <p className="text-sm text-neutral-500 dark:text-neutral-500">
                      {user.age}, {user.city}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setBlockedUsers(blockedUsers.filter((id) => id !== userId));
                    }}
                    className="p-1 rounded-full hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-500"
                  >
                    <svg
                      className="w-4 h-4"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={2}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
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
          onClick={() => window.location.href = "/discover"}
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
          <form onSubmit={(e) => {
            e.preventDefault();
            handleReport();
          }}>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Reason for reporting
                </label>
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
                >
                  <option value="">Select a reason...</option>
                  <option value="harassment">Harassment or hate speech</option>
                  <option value="fake_profile">Fake profile or scam</option>
                  <option value="inappropriate">Inappropriate content</option>
                  <option value="underage">Underage user</option>
                  <option value="other">Other</option>
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
                  />
                </div>
              )}
              <div className="flex justify-end">
                <Button
                  variant="ghost"
                  onClick={closeModal}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  type="submit"
                  disabled={!reason || (reason === "other" && !details.trim())}
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
