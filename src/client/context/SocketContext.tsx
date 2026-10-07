import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext.tsx';
import { api } from '../api/apiClient.ts';

export type ConnectionState = 'idle' | 'ringing' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'failed';

interface WebRTCSessionState {
  inCall: boolean;
  roomId: string | null;
  remoteUserName: string | null;
  connectionState: ConnectionState;
  isMuted: boolean;
  isVideoOff: boolean;
  isScreenSharing: boolean;
  localStream: MediaStream | null;
  screenStream: MediaStream | null;
  remoteStream: MediaStream | null;
  remoteMedia: { muted: boolean; videoOff: boolean; screen: boolean };
  callDuration: number;
  mediaNotice: string | null;   // e.g. "camera busy, audio only"
  callNotice: string | null;    // e.g. "Aditya declined"
  peerPresent: boolean;
}

export interface IncomingCall { roomId: string; fromName: string; fromRole: string; topic: string }
export interface CallChatMessage { sender: string; text: string; time: string; self?: boolean }
export interface CallActionItem { id: string; title: string; by: string }

interface SocketContextType {
  socket: Socket | null;
  socketConnected: boolean;
  sessionState: WebRTCSessionState;
  incomingCall: IncomingCall | null;
  startCall: (roomId: string, targetName: string) => Promise<void>;
  acceptCall: () => Promise<void>;
  declineCall: () => void;
  endCall: () => void;
  toggleAudio: () => void;
  toggleVideo: () => void;
  toggleScreenShare: () => Promise<void>;
  callChat: CallChatMessage[];
  sendCallChat: (text: string) => void;
  actionItems: CallActionItem[];
  addActionItem: (title: string) => Promise<void>;
  onlineUserIds: Set<string>;
  unreadChatCount: number;
  setActiveChatId: (id: string | null) => void;
  clearUnreadFor: (conversationId: string) => void;
  unreadNotifsCount: number;
  triggerRefreshNotifs: () => void;
}

const SocketContext = createContext<SocketContextType | undefined>(undefined);

const FALLBACK_ICE: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

const EMPTY_SESSION: WebRTCSessionState = {
  inCall: false,
  roomId: null,
  remoteUserName: null,
  connectionState: 'idle',
  isMuted: false,
  isVideoOff: false,
  isScreenSharing: false,
  localStream: null,
  screenStream: null,
  remoteStream: null,
  remoteMedia: { muted: false, videoOff: false, screen: false },
  callDuration: 0,
  mediaNotice: null,
  callNotice: null,
  peerPresent: false
};

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [unreadNotifsCount, setUnreadNotifsCount] = useState<number>(0);
  const [sessionState, setSessionState] = useState<WebRTCSessionState>(EMPTY_SESSION);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [callChat, setCallChat] = useState<CallChatMessage[]>([]);
  const [actionItems, setActionItems] = useState<CallActionItem[]>([]);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [unreadByConv, setUnreadByConv] = useState<Record<string, number>>({});

  // ---- refs: the single source of truth for WebRTC internals (avoids stale closures) ----
  const socketRef = useRef<Socket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const roomIdRef = useRef<string | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const iceServersRef = useRef<RTCIceServer[]>(FALLBACK_ICE);
  const videoTransceiverRef = useRef<RTCRtpTransceiver | null>(null);
  const politeRef = useRef(false);
  const makingOfferRef = useRef(false);
  const ignoreOfferRef = useRef(false);
  const peerPresentRef = useRef(false);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const ringTimeoutRef = useRef<any>(null);
  const failTimerRef = useRef<any>(null);
  const incomingRef = useRef<IncomingCall | null>(null);
  const activeChatIdRef = useRef<string | null>(null);
  const userRef = useRef(user);
  const ringtoneRef = useRef<{ stop: () => void } | null>(null);
  userRef.current = user;
  incomingRef.current = incomingCall;

  const patch = useCallback((p: Partial<WebRTCSessionState>) => setSessionState(prev => ({ ...prev, ...p })), []);

  // ---------------------------------------------------------------- ringtone (best effort)
  const startRingtone = () => {
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new Ctx();
      const beep = () => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = 880;
        g.gain.value = 0.05;
        o.connect(g); g.connect(ctx.destination);
        o.start(); o.stop(ctx.currentTime + 0.35);
      };
      beep();
      const t = setInterval(beep, 1800);
      ringtoneRef.current = { stop: () => { clearInterval(t); ctx.close().catch(() => {}); } };
    } catch { /* audio blocked – visual ring is enough */ }
  };
  const stopRingtone = () => { ringtoneRef.current?.stop(); ringtoneRef.current = null; };

  // ---------------------------------------------------------------- socket lifecycle
  useEffect(() => {
    const token = sessionStorage.getItem('mentorconnect_token');
    if (!user || !token) {
      setSocket(null);
      socketRef.current = null;
      return;
    }

    const s = io(window.location.origin, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelayMax: 4000
    });
    socketRef.current = s;
    setSocket(s);

    s.on('connect', () => {
      setSocketConnected(true);
      // After a network blip, put ourselves back into the call room; the peer re-offers.
      if (roomIdRef.current) {
        s.emit('join-room', { roomId: roomIdRef.current });
      }
    });
    s.on('disconnect', () => setSocketConnected(false));
    s.on('connect_error', err => console.warn('[Socket] connect_error:', err.message));

    // presence
    s.on('presence:list', (ids: string[]) => setOnlineUserIds(new Set(ids)));
    s.on('presence', ({ userId, online }: { userId: string; online: boolean }) =>
      setOnlineUserIds(prev => {
        const next = new Set(prev);
        online ? next.add(userId) : next.delete(userId);
        return next;
      })
    );

    // chat unread tracking (MessagesPage handles the message list itself)
    s.on('chat:message', ({ message, conversation }: any) => {
      const me = userRef.current;
      if (!me || message.senderId === me.id) return;
      if (activeChatIdRef.current === conversation.id && document.visibilityState === 'visible') return;
      const mine = conversation.studentId === me.id ? conversation.unreadCountStudent : conversation.unreadCountMentor;
      setUnreadByConv(prev => ({ ...prev, [conversation.id]: mine }));
      setUnreadNotifsCount(c => c + 1);
    });

    // incoming call
    s.on('call:incoming', (call: IncomingCall) => {
      if (roomIdRef.current) {            // already busy
        s.emit('call:decline', { roomId: call.roomId });
        return;
      }
      setIncomingCall(call);
      startRingtone();
    });
    s.on('call:cancelled', ({ roomId }: { roomId: string }) => {
      if (incomingRef.current?.roomId === roomId) {
        setIncomingCall(null);
        stopRingtone();
      }
    });
    s.on('call:declined', ({ byName }: { byName: string }) => {
      clearTimeout(ringTimeoutRef.current);
      if (!peerPresentRef.current) patch({ callNotice: `${byName} declined the call.`, connectionState: 'disconnected' });
    });
    s.on('call:ringing', ({ targetOnline }: { targetOnline: boolean }) => {
      if (!targetOnline && !peerPresentRef.current) {
        patch({ callNotice: 'They appear to be offline right now. Stay here — the call connects as soon as they open the app and accept.' });
      }
    });
    s.on('call:error', ({ message }: { message: string }) => patch({ callNotice: message, connectionState: 'failed' }));
    s.on('call:replaced', () => { teardownCall(false); patch({ callNotice: 'This call was opened in another tab.' }); });

    // call signaling
    s.on('room:peers', ({ count }: { count: number }) => {
      // Someone is already in the room: they will send us the offer.
      if (count > 0) markPeerPresent(true);
    });
    s.on('user-joined', async ({ userName }: { userName: string }) => {
      markPeerPresent(true, userName);
      await makeOffer();                  // the person already in the room is the offerer
    });
    s.on('user-left', () => {
      markPeerPresent(false);
      patch({ connectionState: 'disconnected', remoteMedia: { muted: false, videoOff: false, screen: false }, callNotice: 'The other person left the call. You can wait for them to rejoin.' });
      resetPeerConnection();              // fresh PC so a rejoin negotiates cleanly
    });

    s.on('offer', ({ sdp }: any) => handleDescription(sdp));
    s.on('answer', ({ sdp }: any) => handleDescription(sdp));
    s.on('ice-candidate', async ({ candidate }: { candidate: RTCIceCandidateInit }) => {
      const pc = pcRef.current;
      if (!pc || !candidate) return;
      if (!pc.remoteDescription) {        // candidate arrived before the offer/answer was applied: queue it
        pendingCandidatesRef.current.push(candidate);
        return;
      }
      try { await pc.addIceCandidate(candidate); }
      catch (err) { if (!ignoreOfferRef.current) console.warn('[WebRTC] addIceCandidate failed', err); }
    });
    s.on('media-state', ({ muted, videoOff }: { muted: boolean; videoOff: boolean }) =>
      setSessionState(prev => ({ ...prev, remoteMedia: { ...prev.remoteMedia, muted, videoOff } })));
    s.on('screen-share-toggle', ({ isSharing }: { isSharing: boolean }) =>
      setSessionState(prev => ({ ...prev, remoteMedia: { ...prev.remoteMedia, screen: isSharing } })));

    // in-call chat + action items
    s.on('call-chat', (m: { senderName: string; text: string; time: string }) =>
      setCallChat(prev => [...prev, { sender: m.senderName, text: m.text, time: new Date(m.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }]));
    s.on('call:action-item', (item: CallActionItem) =>
      setActionItems(prev => (prev.some(a => a.id === item.id) ? prev : [...prev, item])));

    // initial unread counts
    api.getConversations().then(res => {
      const me = userRef.current;
      if (!me) return;
      const map: Record<string, number> = {};
      (res.conversations || []).forEach(c => {
        map[c.id] = c.studentId === me.id ? c.unreadCountStudent : c.unreadCountMentor;
      });
      setUnreadByConv(map);
    }).catch(() => {});

    return () => {
      s.removeAllListeners();
      s.disconnect();
      setSocketConnected(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // call timer (counts from the moment media is connected)
  useEffect(() => {
    if (sessionState.connectionState !== 'connected') return;
    const t = setInterval(() => setSessionState(prev => ({ ...prev, callDuration: prev.callDuration + 1 })), 1000);
    return () => clearInterval(t);
  }, [sessionState.connectionState]);

  // ---------------------------------------------------------------- WebRTC internals
  function markPeerPresent(present: boolean, name?: string) {
    peerPresentRef.current = present;
    if (present) {
      clearTimeout(ringTimeoutRef.current);
      setSessionState(prev => ({
        ...prev,
        peerPresent: true,
        callNotice: null,
        remoteUserName: name || prev.remoteUserName,
        connectionState: prev.connectionState === 'connected' ? 'connected' : 'connecting'
      }));
    } else {
      patch({ peerPresent: false });
    }
  }

  function createPeerConnection(): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current, iceCandidatePoolSize: 4 });
    pcRef.current = pc;
    pendingCandidatesRef.current = [];
    makingOfferRef.current = false;
    ignoreOfferRef.current = false;
    videoTransceiverRef.current = null;

    const local = localStreamRef.current;
    const hasAudio = !!local?.getAudioTracks().length;
    const hasVideo = !!local?.getVideoTracks().length;

    local?.getTracks().forEach(track => {
      const sender = pc.addTrack(track, local);
      if (track.kind === 'video') videoTransceiverRef.current = pc.getTransceivers().find(t => t.sender === sender) || null;
    });
    // Always negotiate both directions, even if our own camera/mic is missing, so we can still SEE/HEAR the peer.
    if (!hasAudio) pc.addTransceiver('audio', { direction: 'recvonly' });
    if (!hasVideo) videoTransceiverRef.current = pc.addTransceiver('video', { direction: 'recvonly' });

    const remote = new MediaStream();
    remoteStreamRef.current = remote;
    setSessionState(prev => ({ ...prev, remoteStream: remote }));

    pc.ontrack = ev => {
      if (!remote.getTracks().includes(ev.track)) remote.addTrack(ev.track);
      // New array identity so React effects re-attach / re-evaluate
      setSessionState(prev => ({ ...prev, remoteStream: remote, connectionState: prev.connectionState === 'connected' ? 'connected' : 'connecting' }));
    };

    pc.onicecandidate = ev => {
      if (ev.candidate && roomIdRef.current) {
        socketRef.current?.emit('ice-candidate', { roomId: roomIdRef.current, candidate: ev.candidate.toJSON() });
      }
    };

    // Renegotiation (e.g. screen share starts) – "perfect negotiation" so both sides can offer safely.
    pc.onnegotiationneeded = async () => {
      if (!peerPresentRef.current) return;      // initial offer is sent when the peer joins
      await makeOffer();
    };

    pc.onconnectionstatechange = () => {
      clearTimeout(failTimerRef.current);
      switch (pc.connectionState) {
        case 'connected':
          setSessionState(prev => ({ ...prev, connectionState: 'connected', callNotice: null }));
          break;
        case 'disconnected':
          setSessionState(prev => ({ ...prev, connectionState: 'reconnecting' }));
          // give the network 4s to recover, then force an ICE restart
          failTimerRef.current = setTimeout(() => { if (pc.connectionState !== 'connected') pc.restartIce(); }, 4000);
          break;
        case 'failed':
          pc.restartIce();
          setSessionState(prev => ({ ...prev, connectionState: 'reconnecting' }));
          failTimerRef.current = setTimeout(() => {
            if (pc.connectionState === 'failed') {
              setSessionState(prev => ({ ...prev, connectionState: 'failed', callNotice: 'Could not establish a connection. Check your network or try rejoining the call.' }));
            }
          }, 8000);
          break;
      }
    };
    return pc;
  }

  function resetPeerConnection() {
    const old = pcRef.current;
    if (old) {
      old.ontrack = null; old.onicecandidate = null; old.onnegotiationneeded = null; old.onconnectionstatechange = null;
      old.close();
    }
    if (roomIdRef.current) createPeerConnection();
  }

  async function makeOffer() {
    const pc = pcRef.current;
    const roomId = roomIdRef.current;
    if (!pc || !roomId || pc.signalingState === 'closed') return;
    try {
      makingOfferRef.current = true;
      const hadDescription = !!pc.localDescription;
      const offer = await pc.createOffer(hadDescription && pc.iceConnectionState !== 'new' ? { iceRestart: pc.connectionState !== 'connected' } : undefined);
      if (pc.signalingState !== 'stable') return;   // an incoming offer won the race
      await pc.setLocalDescription(offer);
      socketRef.current?.emit('offer', { roomId, sdp: pc.localDescription });
    } catch (err) {
      console.warn('[WebRTC] makeOffer failed', err);
    } finally {
      makingOfferRef.current = false;
    }
  }

  async function handleDescription(desc: RTCSessionDescriptionInit) {
    const pc = pcRef.current;
    const roomId = roomIdRef.current;
    if (!pc || !roomId || !desc) return;
    try {
      const collision = desc.type === 'offer' && (makingOfferRef.current || pc.signalingState !== 'stable');
      ignoreOfferRef.current = !politeRef.current && collision;
      if (ignoreOfferRef.current) return;

      await pc.setRemoteDescription(desc);
      // flush candidates that arrived early
      for (const c of pendingCandidatesRef.current.splice(0)) {
        try { await pc.addIceCandidate(c); } catch (e) { console.warn('[WebRTC] queued candidate failed', e); }
      }
      if (desc.type === 'offer') {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socketRef.current?.emit('answer', { roomId, sdp: pc.localDescription });
      }
    } catch (err) {
      console.warn('[WebRTC] handleDescription failed', err);
    }
  }

  async function acquireMedia(): Promise<{ stream: MediaStream | null; notice: string | null }> {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      return {
        stream: null,
        notice: 'Camera & mic are blocked because this page is not HTTPS. Open the app via https:// (deployed link / ngrok / cloudflared) or http://localhost. You can still see/hear the other person and chat.'
      };
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      return { stream, notice: null };
    } catch (err: any) {
      const reason = err?.name === 'NotAllowedError'
        ? 'Camera permission denied'
        : err?.name === 'NotReadableError'
          ? 'Camera is in use by another app/tab'
          : 'Camera not available';
      try {
        const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        return { stream: audioOnly, notice: `${reason} — joined with audio only.` };
      } catch {
        return { stream: null, notice: `${reason} and microphone unavailable — you can still see/hear the other person and chat.` };
      }
    }
  }

  async function joinRoom(roomId: string, targetName: string, polite: boolean, ringing: boolean) {
    roomIdRef.current = roomId;
    politeRef.current = polite;
    peerPresentRef.current = false;
    setCallChat([]);
    setActionItems([]);
    setSessionState({ ...EMPTY_SESSION, inCall: true, roomId, remoteUserName: targetName, connectionState: ringing ? 'ringing' : 'connecting' });

    const [{ stream, notice }, ice] = await Promise.all([
      acquireMedia(),
      api.getIceServers().then(r => r.iceServers).catch(() => FALLBACK_ICE)
    ]);
    // user may have hung up while the permission prompt was open
    if (roomIdRef.current !== roomId) { stream?.getTracks().forEach(t => t.stop()); return; }

    iceServersRef.current = ice;
    localStreamRef.current = stream;
    createPeerConnection();
    patch({ localStream: stream, mediaNotice: notice });

    socketRef.current?.emit('join-room', { roomId });
  }

  function teardownCall(notifyPeer: boolean) {
    const roomId = roomIdRef.current;
    clearTimeout(ringTimeoutRef.current);
    clearTimeout(failTimerRef.current);
    if (roomId && notifyPeer) {
      if (!peerPresentRef.current) socketRef.current?.emit('call:cancel', { roomId });
      socketRef.current?.emit('leave-room', { roomId });
    }
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    const pc = pcRef.current;
    if (pc) {
      pc.ontrack = null; pc.onicecandidate = null; pc.onnegotiationneeded = null; pc.onconnectionstatechange = null;
      pc.close();
    }
    pcRef.current = null;
    localStreamRef.current = null;
    screenStreamRef.current = null;
    remoteStreamRef.current = null;
    videoTransceiverRef.current = null;
    roomIdRef.current = null;
    peerPresentRef.current = false;
    pendingCandidatesRef.current = [];
    setSessionState(EMPTY_SESSION);
  }

  // ---------------------------------------------------------------- public actions
  const startCall = async (roomId: string, targetName: string) => {
    if (roomIdRef.current) return;
    await joinRoom(roomId, targetName, false, true);
    socketRef.current?.emit('call:invite', { roomId });
    // stop ringing after 60s
    ringTimeoutRef.current = setTimeout(() => {
      if (!peerPresentRef.current && roomIdRef.current === roomId) {
        patch({ callNotice: `${targetName} did not answer. You can keep waiting or end the call and send them a message.` });
      }
    }, 60000);
  };

  const acceptCall = async () => {
    const call = incomingRef.current;
    if (!call) return;
    stopRingtone();
    setIncomingCall(null);
    await joinRoom(call.roomId, call.fromName, true, false);
  };

  const declineCall = () => {
    const call = incomingRef.current;
    if (call) socketRef.current?.emit('call:decline', { roomId: call.roomId });
    stopRingtone();
    setIncomingCall(null);
  };

  const endCall = () => teardownCall(true);

  const broadcastMedia = () => {
    const a = localStreamRef.current?.getAudioTracks()[0];
    const v = localStreamRef.current?.getVideoTracks()[0];
    if (roomIdRef.current) {
      socketRef.current?.emit('media-state', { roomId: roomIdRef.current, muted: a ? !a.enabled : true, videoOff: v ? !v.enabled : true });
    }
  };

  const toggleAudio = () => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    patch({ isMuted: !track.enabled });
    broadcastMedia();
  };

  const toggleVideo = () => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    patch({ isVideoOff: !track.enabled });
    broadcastMedia();
  };

  const stopScreenSharing = async () => {
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;
    const cam = localStreamRef.current?.getVideoTracks()[0] || null;
    try { await videoTransceiverRef.current?.sender.replaceTrack(cam); } catch (e) { console.warn(e); }
    if (!cam && videoTransceiverRef.current) videoTransceiverRef.current.direction = 'recvonly';
    if (roomIdRef.current) socketRef.current?.emit('screen-share-toggle', { roomId: roomIdRef.current, isSharing: false });
    patch({ isScreenSharing: false, screenStream: null });
  };

  const toggleScreenShare = async () => {
    if (sessionState.isScreenSharing) { await stopScreenSharing(); return; }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      patch({ callNotice: 'Screen sharing is not supported on this device/browser (use desktop Chrome, Edge or Firefox).' });
      return;
    }
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const track = screen.getVideoTracks()[0];
      track.onended = () => { stopScreenSharing(); };
      screenStreamRef.current = screen;
      const tr = videoTransceiverRef.current;
      if (tr) {
        await tr.sender.replaceTrack(track);
        // we had no camera before (recvonly) -> must become sendrecv; this fires renegotiation automatically
        if (tr.direction === 'recvonly') tr.direction = 'sendrecv';
      }
      if (roomIdRef.current) socketRef.current?.emit('screen-share-toggle', { roomId: roomIdRef.current, isSharing: true });
      patch({ isScreenSharing: true, screenStream: screen });
    } catch (err) {
      console.warn('[WebRTC] Screen share cancelled/denied', err);
    }
  };

  const sendCallChat = (text: string) => {
    const clean = text.trim();
    if (!clean || !roomIdRef.current) return;
    socketRef.current?.emit('call-chat', { roomId: roomIdRef.current, text: clean });
    setCallChat(prev => [...prev, {
      sender: userRef.current?.name || 'You',
      text: clean,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      self: true
    }]);
  };

  const addActionItem = async (title: string) => {
    if (!roomIdRef.current || !title.trim()) return;
    const res = await api.addSessionActionItem(roomIdRef.current, title.trim());
    setActionItems(prev => (prev.some(a => a.id === res.task.id) ? prev : [...prev, { id: res.task.id, title: res.task.title, by: userRef.current?.name || 'Mentor' }]));
  };

  // ---------------------------------------------------------------- chat unread helpers
  const setActiveChatId = (id: string | null) => { activeChatIdRef.current = id; };
  const clearUnreadFor = (conversationId: string) => setUnreadByConv(prev => ({ ...prev, [conversationId]: 0 }));
  const unreadChatCount = Object.values(unreadByConv).reduce((a, b) => a + b, 0);
  const triggerRefreshNotifs = () => setUnreadNotifsCount(prev => Math.max(0, prev - 1));

  // hang up cleanly if the tab is closed
  useEffect(() => {
    const onUnload = () => { if (roomIdRef.current) socketRef.current?.emit('leave-room', { roomId: roomIdRef.current }); };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  // switching account/logging out mid-call must not leave a ghost call
  useEffect(() => {
    if (!user && roomIdRef.current) teardownCall(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return (
    <SocketContext.Provider
      value={{
        socket,
        socketConnected,
        sessionState,
        incomingCall,
        startCall,
        acceptCall,
        declineCall,
        endCall,
        toggleAudio,
        toggleVideo,
        toggleScreenShare,
        callChat,
        sendCallChat,
        actionItems,
        addActionItem,
        onlineUserIds,
        unreadChatCount,
        setActiveChatId,
        clearUnreadFor,
        unreadNotifsCount,
        triggerRefreshNotifs
      }}
    >
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
};
