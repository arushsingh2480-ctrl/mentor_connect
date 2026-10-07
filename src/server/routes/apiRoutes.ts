import { Router, Response } from 'express';
import { db } from '../db/database.ts';
import { requireAuth, requireRole, AuthenticatedRequest } from '../middleware/authMiddleware.ts';
import crypto from 'crypto';
import { signToken } from '../auth/token.ts';
import { emitToUser, getIO } from '../realtime.ts';
import { resolveRoom } from '../services/roomService.ts';
import { rankMentorsForStudent, calculateMentorMatch } from '../services/mentorMatchingService.ts';
import {
  generateCareerAnalysis,
  answerStudentQuestion,
  analyzeMentorDocument
} from '../services/aiService.ts';
import {
  Booking,
  User,
  StudentProfile,
  MentorProfile,
  VerificationSubmission,
  Review,
  PlatformReport,
  AvailabilitySlot,
  RoadmapTask
} from '../../types/index.ts';

export const apiRouter = Router();

// ==========================================
// 1. AUTHENTICATION ROUTES
// ==========================================

apiRouter.post('/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email) {
    res.status(400).json({ success: false, error: 'Email is required' });
    return;
  }

  const user = db.findUserByEmail(email);
  if (!user) {
    res.status(401).json({ success: false, error: 'Invalid email or password.' });
    return;
  }

  if (user.isSuspended) {
    res.status(403).json({ success: false, error: 'Your account has been suspended by administration.' });
    return;
  }

  const token = signToken(user.id);
  res.json({
    success: true,
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatarUrl: user.avatarUrl
    }
  });
});

apiRouter.post('/auth/register', (req, res) => {
  const { name, email, role, password } = req.body;
  if (!name || !email || !role) {
    res.status(400).json({ success: false, error: 'Name, email, and role are required.' });
    return;
  }

  if (db.findUserByEmail(email)) {
    res.status(409).json({ success: false, error: 'An account with this email already exists.' });
    return;
  }

  const newUser: User = {
    id: `user_${crypto.randomUUID()}`,
    name,
    email,
    role: role as User['role'],
    avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name)}`,
    createdAt: new Date().toISOString()
  };

  db.createUser(newUser);

  // Initialize role profiles
  if (role === 'student') {
    const studentProfile: StudentProfile = {
      id: `student_profile_${newUser.id}`,
      userId: newUser.id,
      name: newUser.name,
      email: newUser.email,
      age: 20,
      education: 'Undergraduate',
      college: 'Maharaja Agrasen College, University of Delhi',
      degree: 'B.Tech / B.Sc',
      branch: 'Computer Science',
      yearOrSemester: '3rd Year',
      skills: ['JavaScript', 'React', 'Problem Solving'],
      interests: ['Software Engineering', 'Placements'],
      targetCareer: 'Software Engineer',
      targetCompanies: ['Top Product Firms'],
      targetExams: ['Campus Placements'],
      preferredDomain: 'Software Engineering',
      currentSkillLevel: 'Intermediate',
      availability: 'Weekday evenings & weekends',
      careerGoals: 'Secure internship in product tech company',
      currentProblems: 'Balancing DSA and project work',
      careerReadinessScore: 50,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.saveStudentProfile(studentProfile);
  } else if (role === 'mentor') {
    const mentorProfile: MentorProfile = {
      id: `mentor_profile_${newUser.id}`,
      userId: newUser.id,
      name: newUser.name,
      email: newUser.email,
      avatarUrl: newUser.avatarUrl,
      college: 'University of Delhi',
      degree: 'B.Tech / B.Sc (Batch 2023)',
      graduationYear: 2023,
      currentRole: 'Software Engineer',
      companyOrOrg: 'Tech Startup / Corporate',
      experienceYears: 1,
      skills: ['Software Engineering', 'DSA', 'Web Tech'],
      areasOfExpertise: ['Placement Strategy', 'Resume Review'],
      mentorshipCategories: ['Placements', 'Software Engineering'],
      targetDomains: ['Software Engineering'],
      examsHandled: ['Campus Placements'],
      languages: ['English', 'Hindi'],
      bio: `Mentor on Mentor Connect AI. Excited to guide juniors on their career journey!`,
      verificationStatus: 'PENDING',
      rating: 5.0,
      reviewsCount: 0,
      sessionsCompleted: 0,
      availabilityDescription: 'Available weekends',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.saveMentorProfile(mentorProfile);
  }

  res.status(201).json({
    success: true,
    token: signToken(newUser.id),
    user: newUser
  });
});

apiRouter.get('/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  let profile = null;

  if (user.role === 'student') {
    profile = db.getStudentProfileByUserId(user.id);
  } else if (user.role === 'mentor') {
    profile = db.getMentorProfileByUserId(user.id);
  }

  res.json({
    success: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatarUrl: user.avatarUrl
    },
    profile
  });
});

// ==========================================
// 2. STUDENT ROUTES & DASHBOARD
// ==========================================

apiRouter.get('/students/profile', requireAuth, (req: AuthenticatedRequest, res) => {
  const profile = db.getStudentProfileByUserId(req.user!.id);
  if (!profile) {
    res.status(404).json({ success: false, error: 'Student profile not found.' });
    return;
  }
  res.json({ success: true, profile });
});

apiRouter.put('/students/profile', requireAuth, (req: AuthenticatedRequest, res) => {
  let profile = db.getStudentProfileByUserId(req.user!.id);
  const data = req.body;

  if (!profile) {
    profile = {
      id: `student_profile_${req.user!.id}`,
      userId: req.user!.id,
      name: req.user!.name,
      email: req.user!.email,
      age: data.age || 20,
      education: data.education || 'Undergraduate',
      college: data.college || 'College of Engineering',
      degree: data.degree || 'B.Tech',
      branch: data.branch || 'Computer Science',
      yearOrSemester: data.yearOrSemester || '3rd Year',
      skills: data.skills || [],
      interests: data.interests || [],
      targetCareer: data.targetCareer || 'Software Engineer',
      targetCompanies: data.targetCompanies || [],
      targetExams: data.targetExams || [],
      preferredDomain: data.preferredDomain || 'Software Engineering',
      currentSkillLevel: data.currentSkillLevel || 'Intermediate',
      availability: data.availability || 'Weekends',
      careerGoals: data.careerGoals || '',
      currentProblems: data.currentProblems || '',
      careerReadinessScore: data.careerReadinessScore || 50,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  } else {
    Object.assign(profile, data, { updatedAt: new Date().toISOString() });
  }

  db.saveStudentProfile(profile);
  res.json({ success: true, profile });
});

apiRouter.get('/students/dashboard', requireAuth, (req: AuthenticatedRequest, res) => {
  const student = db.getStudentProfileByUserId(req.user!.id) || {
    name: req.user!.name,
    targetCareer: 'Software Engineer',
    careerReadinessScore: 64,
    skills: ['DSA', 'React', 'Node.js']
  };

  const bookings = db.getBookingsForStudent(req.user!.id);
  const upcomingBooking = bookings.find(b => b.status === 'ACCEPTED' || b.status === 'REQUESTED');
  const roadmap = db.getRoadmapByStudentId(req.user!.id);
  const allMentors = db.getAllMentors({ verifiedOnly: true });

  // Get top recommended mentor
  const ranked = student ? rankMentorsForStudent(student as StudentProfile, allMentors) : [];
  const topRecommended = ranked.length > 0 ? ranked[0] : null;

  const completedTasks = roadmap.tasks.filter(t => t.status === 'COMPLETED').length;
  const pendingTasks = roadmap.tasks.filter(t => t.status !== 'COMPLETED').length;

  res.json({
    success: true,
    data: {
      greeting: `Welcome back, ${req.user!.name.split(' ')[0]}`,
      careerGoal: student.targetCareer,
      careerReadinessScore: roadmap.overallProgress || 64,
      upcomingSession: upcomingBooking || null,
      topRecommendedMentor: topRecommended ? {
        mentor: topRecommended.mentor,
        match: topRecommended.match
      } : null,
      pendingActionItemsCount: pendingTasks,
      roadmapSummary: {
        completed: completedTasks,
        total: roadmap.tasks.length,
        progressPercent: roadmap.overallProgress
      },
      aiInsight: student.careerReadinessScore > 60
        ? 'Your profile demonstrates strong web foundations. Completing 2 dynamic programming topics will advance your placement readiness past 70%.'
        : 'Getting your resume reviewed by a verified product alumnus will significantly increase callback rates for summer internship drives.',
      recommendedNextAction: 'Book a 1-on-1 strategy call with a verified alumni mentor or complete your next pending roadmap milestone.'
    }
  });
});

// ==========================================
// 3. MENTOR DISCOVERY & PROFILE ROUTES
// ==========================================

apiRouter.get('/mentors', (req, res) => {
  const { search, domain, college, skill, verifiedOnly, minExp, sort } = req.query;

  let mentors = db.getAllMentors({
    search: search as string,
    domain: domain as string,
    college: college as string,
    skill: skill as string,
    verifiedOnly: verifiedOnly === 'true',
    minExp: minExp ? Number(minExp) : undefined
  });

  if (sort === 'rating') {
    mentors.sort((a, b) => b.rating - a.rating);
  } else if (sort === 'experience') {
    mentors.sort((a, b) => b.experienceYears - a.experienceYears);
  } else if (sort === 'sessions') {
    mentors.sort((a, b) => b.sessionsCompleted - a.sessionsCompleted);
  }

  res.json({ success: true, count: mentors.length, mentors });
});

apiRouter.get('/mentors/:id', (req, res) => {
  const mentor = db.getMentorProfileById(req.params.id);
  if (!mentor) {
    res.status(404).json({ success: false, error: 'Mentor not found.' });
    return;
  }

  const availability = db.getMentorAvailability(mentor.id);
  const reviews = db.getReviewsForMentor(mentor.id);

  res.json({
    success: true,
    mentor,
    availability,
    reviews
  });
});

apiRouter.put('/mentors/profile', requireAuth, requireRole('mentor'), (req: AuthenticatedRequest, res) => {
  const mentor = db.getMentorProfileByUserId(req.user!.id);
  if (!mentor) {
    res.status(404).json({ success: false, error: 'Mentor profile not found.' });
    return;
  }

  Object.assign(mentor, req.body, { updatedAt: new Date().toISOString() });
  db.saveMentorProfile(mentor);
  res.json({ success: true, mentor });
});

// ==========================================
// 4. MENTOR MATCHING ENGINE ROUTE
// ==========================================

apiRouter.get('/matching/mentors', requireAuth, (req: AuthenticatedRequest, res) => {
  const student = db.getStudentProfileByUserId(req.user!.id);
  const mentors = db.getAllMentors();

  if (!student) {
    // If student profile not completed, return mentors sorted by rating
    res.json({
      success: true,
      matches: mentors.map(m => ({
        mentor: m,
        match: {
          mentorId: m.id,
          score: Math.round(m.rating * 18),
          reasons: ['High student rating', 'Verified college alumnus', 'Active mentorship availability'],
          matchedSkills: m.skills.slice(0, 2),
          matchedGoals: [m.targetDomains[0] || 'Software Engineering'],
          matchedCategories: m.mentorshipCategories.slice(0, 2),
          careerMatchPercent: 75,
          skillMatchPercent: 70,
          experienceMatchPercent: 80,
          availabilityMatchPercent: 80,
          collegeMatchPercent: 70
        }
      }))
    });
    return;
  }

  const ranked = rankMentorsForStudent(student, mentors);
  res.json({ success: true, count: ranked.length, matches: ranked });
});

// ==========================================
// 5. BOOKINGS & ANTI-DOUBLE-BOOKING
// ==========================================

apiRouter.post('/bookings', requireAuth, (req: AuthenticatedRequest, res) => {
  const { mentorId, date, startTime, endTime, topic, notes } = req.body;

  if (!mentorId || !date || !startTime || !endTime || !topic) {
    res.status(400).json({ success: false, error: 'Mentor, date, time slot, and topic are required.' });
    return;
  }

  const mentor = db.getMentorProfileById(mentorId);
  if (!mentor) {
    res.status(404).json({ success: false, error: 'Selected mentor not found.' });
    return;
  }

  const bookingId = `booking_${crypto.randomUUID()}`;
  const newBooking: Booking = {
    id: bookingId,
    studentId: req.user!.id,
    studentName: req.user!.name,
    mentorId: mentor.id,
    mentorName: mentor.name,
    mentorRole: mentor.currentRole,
    mentorCompany: mentor.companyOrOrg,
    date,
    startTime,
    endTime,
    topic,
    notes: notes || '',
    status: 'REQUESTED',
    meetingLink: `room_${bookingId}`,
    createdAt: new Date().toISOString()
  };

  const result = db.createBooking(newBooking);
  if (!result.success) {
    res.status(409).json({ success: false, error: result.error });
    return;
  }

  // Create persistent notification for mentor
  db.createNotification({
    id: `notif_${crypto.randomUUID()}`,
    userId: mentor.userId,
    title: 'New Mentorship Request',
    message: `${req.user!.name} requested a session on "${topic}" for ${date} at ${startTime}.`,
    type: 'BOOKING_REQUEST',
    link: '/mentor/dashboard',
    read: false,
    createdAt: new Date().toISOString()
  });

  res.status(201).json({ success: true, booking: result.booking });
});

apiRouter.get('/bookings', requireAuth, (req: AuthenticatedRequest, res) => {
  if (req.user!.role === 'student') {
    const list = db.getBookingsForStudent(req.user!.id);
    res.json({ success: true, bookings: list });
  } else if (req.user!.role === 'mentor') {
    const mentor = db.getMentorProfileByUserId(req.user!.id);
    const list = mentor ? db.getBookingsForMentor(mentor.id) : [];
    res.json({ success: true, bookings: list });
  } else {
    // Admin sees all
    res.json({ success: true, bookings: Array.from(db.bookings.values()) });
  }
});

apiRouter.patch('/bookings/:id/status', requireAuth, (req: AuthenticatedRequest, res) => {
  const { status } = req.body;
  const booking = db.getBookingById(req.params.id);

  if (!booking) {
    res.status(404).json({ success: false, error: 'Booking not found.' });
    return;
  }

  const allowed: string[] = ['ACCEPTED', 'REJECTED', 'COMPLETED', 'CANCELLED'];
  if (!allowed.includes(status)) {
    res.status(400).json({ success: false, error: 'Invalid booking status.' });
    return;
  }
  const ownerMentor = db.getMentorProfileById(booking.mentorId);
  const isOwnerMentor = ownerMentor?.userId === req.user!.id;
  const isStudentCancelling = booking.studentId === req.user!.id && status === 'CANCELLED';
  if (!isOwnerMentor && !isStudentCancelling && req.user!.role !== 'admin') {
    res.status(403).json({ success: false, error: 'You are not allowed to change this booking.' });
    return;
  }

  const updated = db.updateBookingStatus(req.params.id, status);

  // Notify student
  db.createNotification({
    id: `notif_${crypto.randomUUID()}`,
    userId: booking.studentId,
    title: `Booking ${status}`,
    message: `Your mentorship session with ${booking.mentorName} for ${booking.date} at ${booking.startTime} has been ${status.toLowerCase()}.`,
    type: status === 'ACCEPTED' ? 'BOOKING_ACCEPTED' : 'BOOKING_REJECTED',
    link: '/sessions',
    read: false,
    createdAt: new Date().toISOString()
  });

  res.json({ success: true, booking: updated });
});

// ==========================================
// 6. AVAILABILITY ROUTES
// ==========================================

apiRouter.get('/availability/:mentorId', (req, res) => {
  const slots = db.getMentorAvailability(req.params.mentorId);
  res.json({ success: true, slots });
});

apiRouter.post('/availability', requireAuth, requireRole('mentor'), (req: AuthenticatedRequest, res) => {
  const mentor = db.getMentorProfileByUserId(req.user!.id);
  if (!mentor) {
    res.status(404).json({ success: false, error: 'Mentor profile not found.' });
    return;
  }

  const { dayOfWeek, startTime, endTime } = req.body;
  if (!dayOfWeek || !startTime || !endTime) {
    res.status(400).json({ success: false, error: 'Day of week, start time, and end time are required.' });
    return;
  }

  const newSlot: AvailabilitySlot = {
    id: `slot_${crypto.randomUUID()}`,
    mentorId: mentor.id,
    dayOfWeek,
    startTime,
    endTime,
    isBooked: false
  };

  db.saveAvailabilitySlot(newSlot);
  res.status(201).json({ success: true, slot: newSlot });
});

apiRouter.delete('/availability/:id', requireAuth, requireRole('mentor'), (req, res) => {
  const deleted = db.deleteAvailabilitySlot(req.params.id);
  res.json({ success: deleted });
});

// ==========================================
// 7. ROADMAP & PROGRESS ROUTES
// ==========================================

apiRouter.get('/roadmap', requireAuth, (req: AuthenticatedRequest, res) => {
  const studentId = req.query.studentId ? (req.query.studentId as string) : req.user!.id;
  const roadmap = db.getRoadmapByStudentId(studentId);
  res.json({ success: true, roadmap });
});

apiRouter.post('/roadmap/tasks', requireAuth, (req: AuthenticatedRequest, res) => {
  const { roadmapId, phaseNumber, phaseName, title, description, priority, estimatedTime } = req.body;
  if (!roadmapId || !title) {
    res.status(400).json({ success: false, error: 'Roadmap ID and task title are required.' });
    return;
  }

  const task: RoadmapTask = {
    id: `task_${crypto.randomUUID()}`,
    roadmapId,
    phaseNumber: phaseNumber || 1,
    phaseName: phaseName || 'Custom Milestones',
    title,
    description: description || '',
    priority: priority || 'MEDIUM',
    estimatedTime: estimatedTime || '1 week',
    status: 'TODO'
  };

  const updated = db.addRoadmapTask(roadmapId, task);
  res.status(201).json({ success: true, roadmap: updated });
});

apiRouter.patch('/roadmap/tasks/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const { roadmapId, status } = req.body;
  if (!roadmapId || !status) {
    res.status(400).json({ success: false, error: 'Roadmap ID and task status are required.' });
    return;
  }

  const updated = db.updateRoadmapTaskStatus(roadmapId, req.params.id, status);
  if (!updated) {
    res.status(404).json({ success: false, error: 'Task or roadmap not found.' });
    return;
  }

  res.json({ success: true, roadmap: updated });
});

// ==========================================
// 8. CHAT & CONVERSATIONS
// ==========================================

apiRouter.get('/conversations', requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({ success: true, conversations: db.getConversationsForUser(req.user!.id) });
});

// Start (or open) a 1-to-1 conversation.
// Student passes { mentorId } (mentor profile id); mentor passes { studentId } (student user id).
apiRouter.post('/conversations', requireAuth, (req: AuthenticatedRequest, res) => {
  const { mentorId, studentId } = req.body || {};
  const me = req.user!;

  if (me.role === 'student') {
    const mentor = mentorId ? db.getMentorProfileById(mentorId) : undefined;
    if (!mentor) {
      res.status(404).json({ success: false, error: 'Mentor not found.' });
      return;
    }
    res.json({ success: true, conversation: db.getOrCreateConversation(me.id, mentor.id) });
    return;
  }

  if (me.role === 'mentor') {
    const myProfile = db.getMentorProfileByUserId(me.id);
    const student = studentId ? db.findUserById(studentId) : undefined;
    if (!myProfile || !student || student.role !== 'student') {
      res.status(404).json({ success: false, error: 'Student not found.' });
      return;
    }
    res.json({ success: true, conversation: db.getOrCreateConversation(student.id, myProfile.id) });
    return;
  }

  res.status(403).json({ success: false, error: 'Admins cannot start mentor chats.' });
});

apiRouter.get('/conversations/:id/messages', requireAuth, (req: AuthenticatedRequest, res) => {
  const conv = db.getConversationById(req.params.id);
  if (!conv || !db.isConversationParticipant(conv, req.user!.id)) {
    res.status(403).json({ success: false, error: 'You are not part of this conversation.' });
    return;
  }
  res.json({ success: true, messages: db.getMessagesForConversation(conv.id) });
});

apiRouter.post('/conversations/:id/read', requireAuth, (req: AuthenticatedRequest, res) => {
  const conv = db.getConversationById(req.params.id);
  if (!conv || !db.isConversationParticipant(conv, req.user!.id)) {
    res.status(403).json({ success: false, error: 'Not allowed.' });
    return;
  }
  db.markConversationRead(conv.id, req.user!.id);
  res.json({ success: true });
});

// Single source of truth for sending: persist once, then push in realtime to both participants.
apiRouter.post('/messages', requireAuth, (req: AuthenticatedRequest, res) => {
  const { conversationId, text, mentorId, clientId } = req.body || {};
  const clean = typeof text === 'string' ? text.trim().slice(0, 2000) : '';
  if (!clean) {
    res.status(400).json({ success: false, error: 'Message text is required.' });
    return;
  }

  let conv = conversationId ? db.getConversationById(conversationId) : undefined;
  if (!conv && mentorId && req.user!.role === 'student') {
    const mentor = db.getMentorProfileById(mentorId);
    if (mentor) conv = db.getOrCreateConversation(req.user!.id, mentor.id);
  }

  if (!conv) {
    res.status(404).json({ success: false, error: 'Conversation not found.' });
    return;
  }
  if (!db.isConversationParticipant(conv, req.user!.id)) {
    res.status(403).json({ success: false, error: 'You are not part of this conversation.' });
    return;
  }

  const message = db.addMessage({
    id: `msg_${crypto.randomUUID()}`,
    conversationId: conv.id,
    senderId: req.user!.id,
    senderName: req.user!.name,
    senderRole: req.user!.role,
    text: clean,
    timestamp: new Date().toISOString(),
    read: false
  });

  const { studentUserId, mentorUserId } = db.getConversationParticipants(conv);
  const recipientId = req.user!.id === studentUserId ? mentorUserId : studentUserId;
  const payload = { message: { ...message, clientId }, conversation: db.getConversationById(conv.id) };

  // Both participants get it (sender's other tabs/devices too) via their personal rooms.
  emitToUser(studentUserId, 'chat:message', payload);
  if (mentorUserId !== studentUserId) emitToUser(mentorUserId, 'chat:message', payload);

  db.createNotification({
    id: `notif_${crypto.randomUUID()}`,
    userId: recipientId,
    title: `New message from ${req.user!.name}`,
    message: clean.length > 80 ? clean.slice(0, 77) + '...' : clean,
    type: 'NEW_MESSAGE',
    link: '/messages',
    read: false,
    createdAt: new Date().toISOString()
  });

  res.status(201).json({ success: true, message, conversation: db.getConversationById(conv.id) });
});

// Mentor assigns an action item during a live call -> lands in the student's roadmap + shown live to both sides.
apiRouter.post('/sessions/action-items', requireAuth, requireRole('mentor'), (req: AuthenticatedRequest, res) => {
  const { roomId, title } = req.body || {};
  const clean = typeof title === 'string' ? title.trim().slice(0, 200) : '';
  const room = typeof roomId === 'string' ? resolveRoom(roomId) : null;
  if (!clean || !room || !room.allowed.includes(req.user!.id)) {
    res.status(400).json({ success: false, error: 'Valid session and action item are required.' });
    return;
  }

  const roadmap = db.getRoadmapByStudentId(room.studentUserId);
  const task: RoadmapTask = {
    id: `task_${crypto.randomUUID()}`,
    roadmapId: roadmap.id,
    phaseNumber: 5,
    phaseName: roadmap.phases.find(p => p.phaseNumber === 5)?.phaseName || 'Mentor Action Items',
    title: clean,
    description: `Assigned by ${req.user!.name} during a live session.`,
    priority: 'HIGH',
    estimatedTime: '1 week',
    status: 'TODO'
  };
  db.addRoadmapTask(roadmap.id, task);

  db.createNotification({
    id: `notif_${crypto.randomUUID()}`,
    userId: room.studentUserId,
    title: 'New action item from your mentor',
    message: clean,
    type: 'ACTION_ITEM',
    link: '/roadmap',
    read: false,
    createdAt: new Date().toISOString()
  });

  getIO()?.to(roomId).emit('call:action-item', { id: task.id, title: clean, by: req.user!.name });
  res.status(201).json({ success: true, task });
});

// ICE servers (STUN + TURN). TURN is what makes calls work across different networks / mobile data / college wifi.
apiRouter.get('/ice-servers', requireAuth, (_req, res) => {
  const iceServers: any[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
  ];
  if (process.env.TURN_URL) {
    iceServers.push({
      urls: process.env.TURN_URL.split(',').map(u => u.trim()),
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL
    });
  } else {
    // Public Open Relay (Metered) free TURN for demos. Replace with your own via TURN_* env vars for production.
    iceServers.push({
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp'
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject'
    });
  }
  res.json({ success: true, iceServers });
});

// ==========================================
// 9. REVIEWS & RATINGS
// ==========================================

apiRouter.post('/reviews', requireAuth, requireRole('student'), (req: AuthenticatedRequest, res) => {
  const { bookingId, mentorId, rating, comment } = req.body;
  if (!mentorId || !rating || !comment) {
    res.status(400).json({ success: false, error: 'Mentor, rating (1-5), and review comment are required.' });
    return;
  }

  // Prevent duplicate reviews for the same booking
  if (bookingId) {
    const existing = Array.from(db.reviews.values()).find(r => r.bookingId === bookingId);
    if (existing) {
      res.status(409).json({ success: false, error: 'A review has already been submitted for this session.' });
      return;
    }
  }

  const student = db.getStudentProfileByUserId(req.user!.id);
  const newReview: Review = {
    id: `rev_${crypto.randomUUID()}`,
    bookingId: bookingId || `manual_${crypto.randomUUID()}`,
    mentorId,
    studentId: req.user!.id,
    studentName: req.user!.name,
    studentCollege: student?.college || 'University Student',
    rating: Number(rating),
    comment,
    createdAt: new Date().toISOString()
  };

  db.addReview(newReview);
  res.status(201).json({ success: true, review: newReview });
});

apiRouter.get('/mentors/:id/reviews', (req, res) => {
  const reviews = db.getReviewsForMentor(req.params.id);
  res.json({ success: true, reviews });
});

// ==========================================
// 10. AI SERVICES ROUTES
// ==========================================

apiRouter.post('/ai/career-analysis', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const student = req.body || db.getStudentProfileByUserId(req.user!.id) || {};
    const analysis = await generateCareerAnalysis(student);

    // Persist to student profile
    const existing = db.getStudentProfileByUserId(req.user!.id);
    if (existing) {
      existing.aiProfileSummary = analysis;
      db.saveStudentProfile(existing);
    }

    res.json({ success: true, analysis });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'AI analysis temporarily unavailable.' });
  }
});

apiRouter.post('/ai/chat', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { query } = req.body;
  if (!query) {
    res.status(400).json({ success: false, error: 'Query is required.' });
    return;
  }

  try {
    const student = db.getStudentProfileByUserId(req.user!.id);
    const response = await answerStudentQuestion(query, student);
    res.json({ success: true, response });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'AI Assistant unavailable.' });
  }
});

// ==========================================
// 11. MENTOR VERIFICATION WORKFLOW
// ==========================================

apiRouter.post('/verification', requireAuth, requireRole('mentor'), async (req: AuthenticatedRequest, res) => {
  const mentor = db.getMentorProfileByUserId(req.user!.id);
  if (!mentor) {
    res.status(404).json({ success: false, error: 'Mentor profile not found.' });
    return;
  }

  const {
    college,
    collegeEmail,
    studentOrAlumniId,
    graduationYear,
    currentRole,
    documentUrl
  } = req.body;

  if (!college || !collegeEmail || !studentOrAlumniId || !graduationYear) {
    res.status(400).json({ success: false, error: 'College, college email, ID, and graduation year are required.' });
    return;
  }

  // AI-assisted document verification analysis
  const aiExtraction = await analyzeMentorDocument({
    mentorName: mentor.name,
    college,
    collegeEmail,
    studentOrAlumniId,
    graduationYear: Number(graduationYear),
    currentRole: currentRole || mentor.currentRole
  });

  const submission: VerificationSubmission = {
    id: `verif_${crypto.randomUUID()}`,
    mentorId: mentor.id,
    mentorName: mentor.name,
    college,
    collegeEmail,
    studentOrAlumniId,
    graduationYear: Number(graduationYear),
    currentRole: currentRole || mentor.currentRole,
    documentUrl: documentUrl || 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=600&q=80',
    status: 'UNDER_REVIEW',
    confidenceScore: aiExtraction.confidenceScore || 94,
    extractedDetails: aiExtraction,
    submittedAt: new Date().toISOString()
  };

  db.saveVerification(submission);
  res.status(201).json({ success: true, verification: submission });
});

apiRouter.get('/admin/verifications', requireAuth, requireRole('admin'), (req, res) => {
  const list = db.getAllVerifications();
  res.json({ success: true, verifications: list });
});

apiRouter.patch('/admin/verifications/:id', requireAuth, requireRole('admin'), (req, res) => {
  const { status, adminNotes } = req.body;
  const verif = db.getVerificationById(req.params.id);

  if (!verif) {
    res.status(404).json({ success: false, error: 'Verification submission not found.' });
    return;
  }

  verif.status = status;
  verif.adminNotes = adminNotes || verif.adminNotes;
  verif.reviewedAt = new Date().toISOString();

  db.saveVerification(verif);

  // Notify mentor
  const mentor = db.getMentorProfileById(verif.mentorId);
  if (mentor) {
    db.createNotification({
      id: `notif_${crypto.randomUUID()}`,
      userId: mentor.userId,
      title: status === 'VERIFIED' ? 'Verification Approved! ✓' : 'Verification Update',
      message: status === 'VERIFIED'
        ? 'Congratulations! Your college alumni credentials have been verified. You now hold the Verified Mentor badge!'
        : `Your verification submission was updated: ${status}. Notes: ${adminNotes || 'Please check dashboard.'}`,
      type: 'VERIFICATION_UPDATE',
      link: '/mentor/dashboard',
      read: false,
      createdAt: new Date().toISOString()
    });
  }

  res.json({ success: true, verification: verif });
});

// ==========================================
// 12. NOTIFICATIONS ROUTES
// ==========================================

apiRouter.get('/notifications', requireAuth, (req: AuthenticatedRequest, res) => {
  const list = db.getNotificationsForUser(req.user!.id);
  res.json({ success: true, notifications: list });
});

apiRouter.patch('/notifications/:id/read', requireAuth, (req, res) => {
  const updated = db.markNotificationAsRead(req.params.id);
  res.json({ success: updated });
});

// ==========================================
// 13. ADMIN STATS & USER MANAGEMENT
// ==========================================

apiRouter.get('/admin/stats', requireAuth, requireRole('admin'), (req, res) => {
  const stats = db.getAdminStats();
  res.json({ success: true, stats });
});

apiRouter.get('/admin/users', requireAuth, requireRole('admin'), (req, res) => {
  const users = Array.from(db.users.values()).map(u => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    avatarUrl: u.avatarUrl,
    createdAt: u.createdAt,
    isSuspended: !!u.isSuspended
  }));
  res.json({ success: true, users });
});

apiRouter.patch('/admin/users/:id/suspend', requireAuth, requireRole('admin'), (req, res) => {
  const user = db.findUserById(req.params.id);
  if (!user) {
    res.status(404).json({ success: false, error: 'User not found.' });
    return;
  }

  user.isSuspended = req.body.isSuspended !== undefined ? req.body.isSuspended : true;
  db.createUser(user);
  res.json({ success: true, user });
});

apiRouter.get('/admin/reports', requireAuth, requireRole('admin'), (req, res) => {
  const reports = Array.from(db.reports.values());
  res.json({ success: true, reports });
});

apiRouter.post('/reports', requireAuth, (req: AuthenticatedRequest, res) => {
  const { reportedUserId, reason, details } = req.body;
  if (!reportedUserId || !reason) {
    res.status(400).json({ success: false, error: 'Target user ID and reason are required.' });
    return;
  }

  const reportedUser = db.findUserById(reportedUserId);
  const newReport: PlatformReport = {
    id: `report_${crypto.randomUUID()}`,
    reporterId: req.user!.id,
    reporterName: req.user!.name,
    reporterRole: req.user!.role,
    reportedUserId,
    reportedUserName: reportedUser?.name || 'User',
    reason,
    details: details || '',
    status: 'PENDING',
    createdAt: new Date().toISOString()
  };

  db.reports.set(newReport.id, newReport);
  res.status(201).json({ success: true, report: newReport });
});
