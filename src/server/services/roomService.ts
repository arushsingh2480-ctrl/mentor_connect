import { db } from '../db/database.ts';

export interface RoomInfo {
  allowed: string[];          // user ids allowed in the room
  label: string;              // booking topic / "Direct call"
  studentUserId: string;
  mentorUserId: string;
}

/**
 * Call rooms look like:
 *   room_<bookingId>            -> booked session (student + that mentor only)
 *   room_chat_<conversationId>  -> direct 1-to-1 call started from the chat window
 */
export function resolveRoom(roomId: string): RoomInfo | null {
  if (roomId.startsWith('room_chat_')) {
    const conv = db.getConversationById(roomId.replace('room_chat_', ''));
    if (!conv) return null;
    const { studentUserId, mentorUserId } = db.getConversationParticipants(conv);
    return { allowed: [studentUserId, mentorUserId], label: 'Direct call', studentUserId, mentorUserId };
  }
  const booking = Array.from(db.bookings.values()).find(b => b.meetingLink === roomId || `room_${b.id}` === roomId);
  if (!booking) return null;
  const mentorUserId = db.getMentorProfileById(booking.mentorId)?.userId || '';
  return {
    allowed: [booking.studentId, mentorUserId].filter(Boolean),
    label: booking.topic,
    studentUserId: booking.studentId,
    mentorUserId
  };
}
