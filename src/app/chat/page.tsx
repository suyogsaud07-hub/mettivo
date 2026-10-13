"use client";

import { useState } from "react";
import { Avatar } from "@/app/components/ui/Avatar";
import { Input } from "@/app/components/ui/Input";
import { Badge } from "@/app/components/ui/Badge";
import { MOCK_CONVERSATIONS, CURRENT_USER_ID, type Conversation, type Message, type UserProfile } from "@/app/lib/mockData";

// Simple client-side router (since we're not using real auth)
const currentUser: UserProfile = {
  id: CURRENT_USER_ID,
  name: "You",
  age: 25,
  city: "San Francisco",
  intention: "both",
  interests: ["travel", "music", "coffee"],
  promptAnswers: {},
  photos: ["/next.svg"],
  about: "",
  online: true,
};

// Get user by id from mock data (client-side only for demo)
const getUserById = (id: string): UserProfile | null => {
  try {
    const mockData = require("@/app/lib/mockData");
    const user = mockData.MOCK_USERS.find((u: UserProfile) => u.id === id);
    return user || null;
  } catch {
    return null;
  }
};

export default function ChatPage() {
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState("");

  const activeConversation = MOCK_CONVERSATIONS.find(
    (c) => c.id === selectedConversationId
  );

  const handleSendMessage = () => {
    if (!messageInput.trim() || !activeConversation) return;

    const newMessage: Message = {
      id: Date.now().toString(),
      senderId: CURRENT_USER_ID,
      text: messageInput,
      timestamp: new Date(),
      status: "delivered",
    };

    activeConversation.messages.push(newMessage);
    setMessageInput("");
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSendMessage();
    }
  };

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Conversation list (mobile: full width when nothing selected; desktop: always visible) */}
      <div
        className={`flex-1 flex flex-col border-r border-neutral-200 dark:border-neutral-800 ${
          selectedConversationId === null
            ? "flex"
            : "hidden sm:flex"
        }`}
      >
        <div className="p-4 border-b border-neutral-200 dark:border-neutral-800">
          <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">Messages</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-500">
            {MOCK_CONVERSATIONS.reduce((sum, c) => sum + c.unreadCount, 0)} unread
          </p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {MOCK_CONVERSATIONS.map((conversation) => {
            const user = getUserById(conversation.userId);
            if (!user) return null;

            const lastMessage = conversation.messages[conversation.messages.length - 1];
            const isSelected = conversation.id === selectedConversationId;

            return (
              <button
                key={conversation.id}
                onClick={() => {
                  setSelectedConversationId(conversation.id);
                  // Clear unread when opened
                  conversation.unreadCount = 0;
                }}
                className={`w-full p-4 flex items-center gap-3 border-b border-neutral-100 dark:border-neutral-900 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors ${
                  isSelected
                    ? "bg-rose-500/10 dark:bg-rose-500/20"
                    : ""
                }`}
              >
                <Avatar
                  src={user.photos[0]}
                  alt={user.name}
                  fallback={user.name}
                  size="lg"
                  online={user.online}
                />
                <div className="flex-1 text-left">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">
                      {user.name}
                    </h3>
                    <span className="text-xs text-neutral-500 dark:text-neutral-500">
                      {lastMessage
                        ? new Date(lastMessage.timestamp).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : ""}
                    </span>
                  </div>
                  <p
                    className={`text-sm truncate ${
                      conversation.unreadCount > 0
                        ? "font-medium text-neutral-900 dark:text-neutral-100"
                        : "text-neutral-500 dark:text-neutral-500"
                    }`}
                  >
                    {conversation.unreadCount > 0 ? "🔔 " : ""}
                    {lastMessage?.text}
                  </p>
                </div>
                {conversation.unreadCount > 0 && (
                  <Badge variant="primary" size="sm">
                    {conversation.unreadCount}
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Active chat (only shown when a conversation is selected or on desktop) */}
      {activeConversation ? (
        <div
          className={`flex-1 flex flex-col ${
            selectedConversationId !== null ? "flex" : "hidden sm:flex"
          }`}
        >
          {/* Chat header */}
          <div className="p-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center gap-3">
            <button
              onClick={() => setSelectedConversationId(null)}
              className="sm:hidden p-1 -ml-2 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-900"
            >
              <svg
                className="w-5 h-5 stroke-neutral-700 dark:stroke-neutral-300"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
            {(() => {
              const user = getUserById(activeConversation.userId);
              if (!user) return null;
              return (
                <>
                  <Avatar
                    src={user.photos[0]}
                    alt={user.name}
                    fallback={user.name}
                    size="md"
                    online={user.online}
                  />
                  <div>
                    <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">
                      {user.name}
                    </h2>
                    <p className="text-xs text-neutral-500 dark:text-neutral-500">
                      {user.online ? "Online now" : "Offline"}
                    </p>
                  </div>
                </>
              );
            })()}
            <div className="flex-1" />
            <button className="p-2 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-900 text-neutral-500">
              <svg
                className="w-5 h-5"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 13.5V3.75m0 9.75a1.5 1.5 0 010 3m0-3a1.5 1.5 0 000 3m0 3.75V16.5m12-3V3.75m0 9.75a1.5 1.5 0 010 3m0-3a1.5 1.5 0 000 3m0 3.75V16.5m-6-9V3.75m0 3.75a1.5 1.5 0 010 3m0-3a1.5 1.5 0 000 3m0 9.75V10.5"
                />
              </svg>
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {activeConversation.messages.map((message, i) => {
              const isMe = message.senderId === CURRENT_USER_ID;
              const showAvatar =
                !isMe &&
                (i === 0 ||
                  activeConversation.messages[i - 1].senderId === CURRENT_USER_ID);

              return (
                <div
                  key={message.id}
                  className={`flex items-end gap-2 ${
                    isMe ? "flex-row-reverse" : ""
                  }`}
                >
                  {!isMe && showAvatar ? (
                    <Avatar
                      src={getUserById(activeConversation.userId)?.photos[0]}
                      alt={getUserById(activeConversation.userId)?.name}
                      fallback={getUserById(activeConversation.userId)?.name}
                      size="sm"
                    />
                  ) : (
                    <div className="w-8" />
                  )}
                  <div
                    className={`max-w-[70%] rounded-2xl px-4 py-2 ${
                      isMe
                        ? "bg-rose-500 text-white rounded-br-sm"
                        : "bg-neutral-200 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 rounded-bl-sm"
                    }`}
                  >
                    <p className="text-sm">{message.text}</p>
                    <p
                      className={`text-[10px] mt-1 ${
                        isMe
                          ? "text-rose-100 dark:text-rose-200/60"
                          : "text-neutral-500 dark:text-neutral-500"
                      }`}
                    >
                      {new Date(message.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Message input */}
          <div className="p-4 border-t border-neutral-200 dark:border-neutral-800">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage();
              }}
              className="flex items-center gap-3"
            >
              <button
                type="button"
                className="p-2 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-900 text-neutral-500"
              >
                <svg
                  className="w-5 h-5"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 4.5v15m7.5-7.5h-15"
                  />
                </svg>
              </button>
              <input
                type="text"
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Type a message..."
                className="flex-1 px-4 py-2 rounded-full border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
              />
              <button
                type="submit"
                disabled={!messageInput.trim()}
                className="p-2 rounded-full bg-rose-500 text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-rose-600 transition-colors"
              >
                <svg
                  className="w-5 h-5"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
                  />
                </svg>
              </button>
            </form>
          </div>
        </div>
      ) : (
        <div className="hidden sm:flex flex-1 items-center justify-center text-neutral-500 dark:text-neutral-500">
          <p>Select a conversation to start messaging</p>
        </div>
      )}
    </div>
  );
}
