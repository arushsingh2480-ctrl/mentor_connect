import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import { useSocket } from '../context/SocketContext.tsx';
import { useChatLauncher } from '../context/ChatLauncherContext.tsx';
import { api } from '../api/apiClient.ts';
import { Conversation, ChatMessage } from '../../types/index.ts';
import { Send, MessageSquare, Video, ArrowLeft, Check, CheckCheck, AlertCircle, RotateCw } from 'lucide-react';

type UIMessage = ChatMessage & { clientId?: string; status?: 'sending' | 'failed' };

export const MessagesPage: React.FC = () => {
  const { user } = useAuth();
  const { socket, sessionState, startCall, onlineUserIds, setActiveChatId, clearUnreadFor } = useSocket();
  const { chatTarget, consumeChatTarget } = useChatLauncher();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [inputMsg, setInputMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typingName, setTypingName] = useState<string | null>(null);
  const [mobileThread, setMobileThread] = useState(false);

  const endRef = useRef<HTMLDivElement | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const typingTimer = useRef<any>(null);
  const lastTypingEmit = useRef(0);
  const clearTypingTimer = useRef<any>(null);

  const activeConv = conversations.find(c => c.id === activeId) || null;
  const otherName = (c: Conversation) => (user?.role === 'student' ? c.mentorName : c.studentName);
  const otherUserId = (c: Conversation) => (user?.role === 'student' ? c.mentorUserId : c.studentId);
  const unreadFor = (c: Conversation) => (user?.id === c.studentId ? c.unreadCountStudent : c.unreadCountMentor);

  const upsertConversation = useCallback((conv: Conversation) => {
    setConversations(prev => {
      const rest = prev.filter(c => c.id !== conv.id);
      return [conv, ...rest].sort((a, b) => new Date(b.lastMessageTime || 0).getTime() - new Date(a.lastMessageTime || 0).getTime());
    });
  }, []);

  const openConversation = useCallback((id: string) => {
    setActiveId(id);
    setMobileThread(true);
    setError(null);
  }, []);

  // ---- initial load + deep link from "Message Mentor" buttons ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getConversations();
        if (cancelled) return;
        let list = res.conversations || [];
        let targetId: string | null = null;

        if (chatTarget) {
          try {
            const started = await api.startConversation(chatTarget);
            targetId = started.conversation.id;
            if (!list.some(c => c.id === targetId)) list = [started.conversation, ...list];
          } catch (e: any) {
            setError(e.message || 'Could not open that conversation.');
          }
          consumeChatTarget();
        }
        setConversations(list);
        if (targetId) openConversation(targetId);
        else if (list.length > 0) setActiveId(list[0].id);
      } catch (e: any) {
        setError(e.message || 'Could not load conversations.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // clicking another "Message" button while already on this page
  useEffect(() => {
    if (!chatTarget || loading) return;
    (async () => {
      try {
        const started = await api.startConversation(chatTarget);
        upsertConversation(started.conversation);
        openConversation(started.conversation.id);
      } catch (e: any) {
        setError(e.message || 'Could not open that conversation.');
      }
      consumeChatTarget();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatTarget]);

  // ---- load thread when active conversation changes ----
  useEffect(() => {
    activeIdRef.current = activeId;
    setActiveChatId(activeId);
    setTypingName(null);
    if (!activeId) { setMessages([]); return; }
    let cancelled = false;
    api.getMessages(activeId).then(res => {
      if (!cancelled) setMessages(res.messages || []);
    }).catch(e => setError(e.message));
    api.markConversationRead(activeId).catch(() => {});
    clearUnreadFor(activeId);
    setConversations(prev => prev.map(c => c.id === activeId
      ? { ...c, ...(user?.id === c.studentId ? { unreadCountStudent: 0 } : { unreadCountMentor: 0 }) }
      : c));
    return () => { cancelled = true; setActiveChatId(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // ---- realtime ----
  useEffect(() => {
    if (!socket) return;

    const onMessage = ({ message, conversation }: { message: UIMessage; conversation: Conversation }) => {
      upsertConversation(conversation);
      if (message.conversationId !== activeIdRef.current) return;

      setMessages(prev => {
        if (prev.some(m => m.id === message.id)) return prev;
        // replace our optimistic copy
        if (message.clientId && prev.some(m => m.clientId === message.clientId)) {
          return prev.map(m => (m.clientId === message.clientId ? { ...message } : m));
        }
        return [...prev, message];
      });

      if (message.senderId !== user?.id) {
        setTypingName(null);
        api.markConversationRead(message.conversationId).catch(() => {});
        clearUnreadFor(message.conversationId);
      }
    };

    const onTyping = ({ conversationId, userName, typing }: { conversationId: string; userName: string; typing: boolean }) => {
      if (conversationId !== activeIdRef.current) return;
      setTypingName(typing ? userName : null);
      clearTimeout(clearTypingTimer.current);
      if (typing) clearTypingTimer.current = setTimeout(() => setTypingName(null), 4000);
    };

    socket.on('chat:message', onMessage);
    socket.on('chat:typing', onTyping);
    return () => {
      socket.off('chat:message', onMessage);
      socket.off('chat:typing', onTyping);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, user?.id]);

  // After a reconnect, pull anything that was missed while offline
  useEffect(() => {
    if (!socket) return;
    const onReconnect = () => {
      api.getConversations().then(r => setConversations(r.conversations || [])).catch(() => {});
      if (activeIdRef.current) api.getMessages(activeIdRef.current).then(r => setMessages(r.messages || [])).catch(() => {});
    };
    socket.io.on('reconnect', onReconnect);
    return () => { socket.io.off('reconnect', onReconnect); };
  }, [socket]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typingName]);

  // ---- sending (REST persists once, server pushes realtime to both people) ----
  const deliver = async (conversationId: string, text: string, clientId: string) => {
    try {
      const res = await api.sendMessage({ conversationId, text, clientId });
      setMessages(prev => {
        if (prev.some(m => m.id === res.message.id)) return prev.filter(m => m.clientId !== clientId || m.id === res.message.id);
        return prev.map(m => (m.clientId === clientId ? { ...res.message } : m));
      });
      upsertConversation(res.conversation);
    } catch (err: any) {
      setMessages(prev => prev.map(m => (m.clientId === clientId ? { ...m, status: 'failed' } : m)));
      setError(err.message || 'Failed to send message');
    }
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputMsg.trim();
    if (!text || !activeConv || !user) return;

    const clientId = `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    setMessages(prev => [...prev, {
      id: clientId, clientId, conversationId: activeConv.id, senderId: user.id, senderName: user.name,
      senderRole: user.role, text, timestamp: new Date().toISOString(), read: false, status: 'sending'
    }]);
    setInputMsg('');
    setError(null);
    socket?.emit('stop-typing', { conversationId: activeConv.id });
    deliver(activeConv.id, text, clientId);
  };

  const retry = (m: UIMessage) => {
    if (!m.clientId) return;
    setMessages(prev => prev.map(x => (x.clientId === m.clientId ? { ...x, status: 'sending' } : x)));
    deliver(m.conversationId, m.text, m.clientId);
  };

  const handleTyping = (value: string) => {
    setInputMsg(value);
    if (!socket || !activeConv) return;
    const now = Date.now();
    if (now - lastTypingEmit.current > 1500) {
      socket.emit('typing', { conversationId: activeConv.id });
      lastTypingEmit.current = now;
    }
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => socket.emit('stop-typing', { conversationId: activeConv.id }), 1800);
  };

  const callThisPerson = () => {
    if (!activeConv || sessionState.inCall) return;
    startCall(`room_chat_${activeConv.id}`, otherName(activeConv));
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 animate-pulse space-y-4">
        <div className="h-20 bg-slate-200/70 rounded-3xl"></div>
        <div className="h-96 bg-slate-200/70 rounded-3xl"></div>
      </div>
    );
  }

  const isOnline = (c: Conversation) => {
    const id = otherUserId(c);
    return !!id && onlineUserIds.has(id);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-black text-slate-900 tracking-tight">Direct Messages</h1>
        <p className="text-xs sm:text-sm text-slate-600 mt-1">
          Private 1-to-1 chat with your {user?.role === 'student' ? 'mentors' : 'mentees'} — with live typing, online status and instant video calls.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 px-4 py-2.5 rounded-xl">
          <AlertCircle className="w-4 h-4 shrink-0" /> <span>{error}</span>
        </div>
      )}

      <div className="bg-white rounded-3xl border border-slate-200/90 shadow-2xs overflow-hidden h-[620px] flex">
        {/* Conversation list */}
        <div className={`${mobileThread ? 'hidden' : 'flex'} md:flex w-full md:w-80 border-r border-slate-200/80 flex-col bg-slate-50/50`}>
          <div className="p-4 border-b border-slate-200/80 font-bold text-xs text-slate-700 uppercase tracking-wider">Conversations</div>
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {conversations.length === 0 && (
              <div className="p-6 text-center text-xs text-slate-500 space-y-1">
                <MessageSquare className="w-6 h-6 mx-auto opacity-40" />
                <p className="font-semibold text-slate-700">No conversations yet</p>
                <p>{user?.role === 'student' ? 'Open any mentor and tap "Message Mentor" to start chatting.' : 'Students can message you from your profile, or message them from Sessions.'}</p>
              </div>
            )}
            {conversations.map(conv => {
              const unread = unreadFor(conv);
              return (
                <button
                  key={conv.id}
                  onClick={() => openConversation(conv.id)}
                  className={`w-full p-4 text-left transition-colors cursor-pointer flex items-start gap-3 ${
                    activeId === conv.id ? 'bg-white border-l-4 border-indigo-600 shadow-2xs' : 'hover:bg-slate-100/70'
                  }`}
                >
                  <div className="relative shrink-0">
                    <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-700 font-bold text-sm flex items-center justify-center">
                      {otherName(conv).charAt(0)}
                    </div>
                    {isOnline(conv) && <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-xs text-slate-900 truncate">{otherName(conv)}</span>
                      {unread > 0 && (
                        <span className="min-w-5 h-5 px-1.5 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center">{unread}</span>
                      )}
                    </div>
                    <p className={`text-[11px] truncate mt-0.5 ${unread > 0 ? 'text-slate-800 font-semibold' : 'text-slate-500'}`}>
                      {conv.lastMessage || 'Say hello 👋'}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Thread */}
        <div className={`${mobileThread ? 'flex' : 'hidden'} md:flex flex-1 flex-col bg-white min-w-0`}>
          {activeConv ? (
            <>
              <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/30 gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <button onClick={() => setMobileThread(false)} className="md:hidden p-1.5 -ml-1 text-slate-500 cursor-pointer" aria-label="Back">
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <div className="w-9 h-9 rounded-full bg-indigo-600 text-white font-bold text-xs flex items-center justify-center shrink-0">
                    {otherName(activeConv).charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-bold text-xs text-slate-900 truncate">{otherName(activeConv)}</h3>
                    <span className={`text-[10px] font-semibold flex items-center gap-1 ${isOnline(activeConv) ? 'text-emerald-600' : 'text-slate-400'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${isOnline(activeConv) ? 'bg-emerald-500' : 'bg-slate-300'}`}></span>
                      {isOnline(activeConv) ? 'Online' : 'Offline — they will see your message later'}
                    </span>
                  </div>
                </div>
                <button
                  onClick={callThisPerson}
                  disabled={sessionState.inCall}
                  className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer shrink-0"
                  title="Start a 1-to-1 video call"
                >
                  <Video className="w-4 h-4" /> <span className="hidden sm:inline">Video Call</span>
                </button>
              </div>

              <div className="flex-1 p-5 overflow-y-auto space-y-3 bg-slate-50/30">
                {messages.length === 0 && (
                  <p className="text-center text-xs text-slate-400 pt-10">No messages yet. Start the conversation!</p>
                )}
                {messages.map(msg => {
                  const isMe = msg.senderId === user?.id;
                  return (
                    <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                      <div className={`max-w-[80%] sm:max-w-md p-3.5 rounded-2xl text-xs leading-relaxed shadow-2xs break-words whitespace-pre-wrap ${
                        isMe ? 'bg-indigo-600 text-white rounded-br-xs' : 'bg-white border border-slate-200 text-slate-800 rounded-bl-xs'
                      } ${msg.status === 'sending' ? 'opacity-70' : ''} ${msg.status === 'failed' ? 'bg-red-500' : ''}`}>
                        {msg.text}
                      </div>
                      <span className="text-[10px] text-slate-400 mt-1 px-1 flex items-center gap-1">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {isMe && msg.status === 'sending' && <span>sending…</span>}
                        {isMe && msg.status === 'failed' && (
                          <button onClick={() => retry(msg)} className="text-red-600 font-semibold flex items-center gap-0.5 cursor-pointer">
                            <RotateCw className="w-3 h-3" /> retry
                          </button>
                        )}
                        {isMe && !msg.status && (msg.read ? <CheckCheck className="w-3 h-3 text-indigo-500" /> : <Check className="w-3 h-3" />)}
                      </span>
                    </div>
                  );
                })}
                {typingName && (
                  <div className="text-[11px] text-slate-400 italic px-1">{typingName} is typing…</div>
                )}
                <div ref={endRef} />
              </div>

              <form onSubmit={handleSendMessage} className="p-3.5 border-t border-slate-100 flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Type a message..."
                  value={inputMsg}
                  maxLength={2000}
                  onChange={e => handleTyping(e.target.value)}
                  className="flex-1 px-4 py-2.5 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                />
                <button
                  type="submit"
                  disabled={!inputMsg.trim()}
                  className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5 shadow-xs"
                >
                  <span>Send</span>
                  <Send className="w-3.5 h-3.5" />
                </button>
              </form>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-slate-400 space-y-2">
              <MessageSquare className="w-8 h-8 opacity-40" />
              <p className="text-xs">Select a conversation to start chatting</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
