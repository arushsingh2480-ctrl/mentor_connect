import { Server as SocketIOServer, Socket } from 'socket.io';
import { db } from '../db/database.ts';
import { verifyToken } from '../auth/token.ts';
import { setIO } from '../realtime.ts';
import { User } from '../../types/index.ts';
import { resolveRoom } from '../services/roomService.ts';

// onlineUsers: userId -> number of live sockets (a user can have several tabs)
const onlineUsers = new Map<string, number>();

export function setupSocketIO(io: SocketIOServer) {
  setIO(io);

  // ---- Authenticate every socket from the signed token (client can no longer fake senderId) ----
  io.use((socket, next) => {
    const userId = verifyToken(socket.handshake.auth?.token);
    const user = userId ? db.findUserById(userId) : undefined;
    if (!user || user.isSuspended) return next(new Error('unauthorized'));
    (socket.data as { user: User }).user = user;
    next();
  });

  io.on('connection', (socket: Socket) => {
    const user = (socket.data as { user: User }).user;

    // Personal room: chat delivery, incoming-call rings, notifications
    socket.join(`user_${user.id}`);
    onlineUsers.set(user.id, (onlineUsers.get(user.id) || 0) + 1);
    io.emit('presence', { userId: user.id, online: true });
    socket.emit('presence:list', Array.from(onlineUsers.keys()));

    // ==========================================
    // CHAT (typing + room join; sending goes through REST so a message is stored exactly once)
    // ==========================================
    const canUseConversation = (conversationId: string) => {
      const conv = db.getConversationById(conversationId);
      return !!conv && db.isConversationParticipant(conv, user.id) ? conv : null;
    };

    socket.on('typing', ({ conversationId }: { conversationId: string }) => {
      const conv = canUseConversation(conversationId);
      if (!conv) return;
      const { studentUserId, mentorUserId } = db.getConversationParticipants(conv);
      const other = user.id === studentUserId ? mentorUserId : studentUserId;
      io.to(`user_${other}`).emit('chat:typing', { conversationId, userName: user.name, typing: true });
    });

    socket.on('stop-typing', ({ conversationId }: { conversationId: string }) => {
      const conv = canUseConversation(conversationId);
      if (!conv) return;
      const { studentUserId, mentorUserId } = db.getConversationParticipants(conv);
      const other = user.id === studentUserId ? mentorUserId : studentUserId;
      io.to(`user_${other}`).emit('chat:typing', { conversationId, userName: user.name, typing: false });
    });

    // ==========================================
    // CALL SIGNALING
    // ==========================================

    // Ring the other person ("incoming call")
    socket.on('call:invite', ({ roomId }: { roomId: string }) => {
      const info = resolveRoom(roomId);
      if (!info || !info.allowed.includes(user.id)) {
        socket.emit('call:error', { message: 'You are not allowed to start this call.' });
        return;
      }
      const targets = info.allowed.filter(id => id !== user.id);
      targets.forEach(id => {
        const online = (onlineUsers.get(id) || 0) > 0;
        io.to(`user_${id}`).emit('call:incoming', {
          roomId,
          fromUserId: user.id,
          fromName: user.name,
          fromRole: user.role,
          topic: info.label
        });
        socket.emit('call:ringing', { roomId, targetOnline: online });
      });
    });

    socket.on('call:decline', ({ roomId }: { roomId: string }) => {
      const info = resolveRoom(roomId);
      if (!info || !info.allowed.includes(user.id)) return;
      info.allowed.filter(id => id !== user.id).forEach(id => {
        io.to(`user_${id}`).emit('call:declined', { roomId, byName: user.name });
      });
    });

    socket.on('call:cancel', ({ roomId }: { roomId: string }) => {
      const info = resolveRoom(roomId);
      if (!info || !info.allowed.includes(user.id)) return;
      info.allowed.filter(id => id !== user.id).forEach(id => {
        io.to(`user_${id}`).emit('call:cancelled', { roomId });
      });
    });

    socket.on('join-room', async ({ roomId }: { roomId: string }) => {
      const info = resolveRoom(roomId);
      if (!info || !info.allowed.includes(user.id)) {
        socket.emit('call:error', { message: 'This call room is not available for your account.' });
        return;
      }
      // Max 2 distinct people; the same user opening a 2nd tab replaces the old socket
      const sockets = await io.in(roomId).fetchSockets();
      for (const s of sockets) {
        if ((s.data as { user: User }).user?.id === user.id && s.id !== socket.id) {
          s.emit('call:replaced');
          s.leave(roomId);
        }
      }
      const remaining = sockets.filter(s => (s.data as { user: User }).user?.id !== user.id);
      if (remaining.length >= 2) {
        socket.emit('call:error', { message: 'Room is full.' });
        return;
      }
      socket.join(roomId);
      socket.data.roomId = roomId;
      // Tell the already-present peer so it can create the offer; tell the newcomer who is already there.
      socket.emit('room:peers', { count: remaining.length });
      socket.to(roomId).emit('user-joined', { socketId: socket.id, userId: user.id, userName: user.name, role: user.role });
    });

    const relay = (event: string) =>
      socket.on(event, (data: any) => {
        const roomId = data?.roomId;
        if (!roomId || !socket.rooms.has(roomId)) return;
        socket.to(roomId).emit(event, { ...data, senderSocketId: socket.id });
      });
    ['offer', 'answer', 'ice-candidate', 'screen-share-toggle', 'media-state'].forEach(relay);

    // In-call chat: relayed live to the room (not mixed into the persistent inbox)
    socket.on('call-chat', ({ roomId, text }: { roomId: string; text: string }) => {
      if (!roomId || !socket.rooms.has(roomId) || typeof text !== 'string' || !text.trim()) return;
      socket.to(roomId).emit('call-chat', {
        roomId,
        senderName: user.name,
        text: text.trim().slice(0, 1000),
        time: new Date().toISOString()
      });
    });

    socket.on('leave-room', ({ roomId }: { roomId: string }) => {
      socket.leave(roomId);
      socket.to(roomId).emit('user-left', { socketId: socket.id, userName: user.name });
    });

    // Fires before rooms are cleared, so the peer is told when someone closes the tab / loses network
    socket.on('disconnecting', () => {
      socket.rooms.forEach(room => {
        if (room.startsWith('room_')) socket.to(room).emit('user-left', { socketId: socket.id, userName: user.name });
      });
    });

    socket.on('disconnect', () => {
      const n = (onlineUsers.get(user.id) || 1) - 1;
      if (n <= 0) {
        onlineUsers.delete(user.id);
        io.emit('presence', { userId: user.id, online: false });
      } else {
        onlineUsers.set(user.id, n);
      }
    });
  });
}
