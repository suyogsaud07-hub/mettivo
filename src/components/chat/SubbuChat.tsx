'use client';

import { useState, useRef, useEffect } from 'react';
import { SUBBU_NAME } from '@/lib/bot/constants';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  imageUrl?: string;
}

export default function SubbuChat() {
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', role: 'assistant', content: "Hey there! I'm Subbu. 😊 Need help navigating Mettivo, want some dating advice, or just want to chat? Send me a Mettivo Click (photo) and I'll hype you up! 📸✨" }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      sendMessage('Check out this Mettivo Click!', base64);
    };
    reader.readAsDataURL(file);
  };

  const sendMessage = async (text: string, imageUrl?: string) => {
    if (!text.trim() && !imageUrl) return;

    const newUserMsg: Message = { id: Date.now().toString(), role: 'user', content: text, imageUrl };
    const updatedMessages = [...messages, newUserMsg];
    setMessages(updatedMessages);
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/bot/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: updatedMessages.map(m => ({ role: m.role, content: m.content, imageUrl: m.imageUrl }))
        })
      });

      const data = await response.json();
      
      if (!response.ok) throw new Error(data.message || 'Subbu is busy.');

      setMessages(prev => [...prev, { 
        id: Date.now().toString(), 
        role: 'assistant', 
        content: data.reply 
      }]);

    } catch (err) {
      const detail = err instanceof Error ? err.message : 'unknown error';
      setMessages(prev => [...prev, { 
        id: Date.now().toString(), 
        role: 'assistant', 
        content: `Oops, I glitched. 😅 ${detail}` 
      }]);
    } finally {
      setIsLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="flex flex-col h-screen max-w-2xl mx-auto bg-gray-900 text-white">
      {/* Header */}
      <div className="p-4 bg-gray-800 border-b border-gray-700 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-purple-500 to-pink-500 flex items-center justify-center font-bold text-lg">
          {SUBBU_NAME[0]}
        </div>
        <div>
          <h1 className="font-bold">{SUBBU_NAME}</h1>
          <p className="text-xs text-green-400">Online • AI Companion & Moderator</p>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl p-3 ${msg.role === 'user' ? 'bg-pink-600 rounded-tr-sm' : 'bg-gray-700 rounded-tl-sm'}`}>
              {msg.imageUrl && (
                <img src={msg.imageUrl} alt="Mettivo Click" className="rounded-lg mb-2 max-h-60 object-cover" />
              )}
              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
            </div>
          </div>
        ))}
        {isLoading && <div className="text-gray-400 text-sm animate-pulse">Subbu is typing...</div>}
      </div>

      {/* Input Area */}
      <div className="p-4 bg-gray-800 border-t border-gray-700 flex gap-2 items-center">
        <input 
          type="file" 
          accept="image/*" 
          className="hidden" 
          ref={fileInputRef} 
          onChange={handleImageUpload} 
        />
        <button 
          onClick={() => fileInputRef.current?.click()}
          className="p-2 bg-gray-700 rounded-full hover:bg-gray-600 transition"
          title="Send Mettivo Click"
        >
          📸
        </button>
        
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage(input)}
          placeholder="Message Subbu..."
          className="flex-1 bg-gray-700 rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
        />
        
        <button 
          onClick={() => sendMessage(input)}
          disabled={isLoading || (!input.trim())}
          className="p-2 bg-pink-600 rounded-full hover:bg-pink-500 disabled:opacity-50 transition"
        >
          ➤
        </button>
      </div>
    </div>
  );
}