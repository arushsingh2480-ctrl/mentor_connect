import type { Server as SocketIOServer } from 'socket.io';

// Lets REST routes push realtime events (chat, notifications) through Socket.IO.
let ioRef: SocketIOServer | null = null;
export const setIO = (io: SocketIOServer) => { ioRef = io; };
export const getIO = () => ioRef;

export const emitToUser = (userId: string, event: string, payload: unknown) => {
  ioRef?.to(`user_${userId}`).emit(event, payload);
};
