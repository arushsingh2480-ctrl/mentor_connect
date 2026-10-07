import React, { useState } from 'react';
import { AuthProvider, useAuth } from './client/context/AuthContext.tsx';
import { SocketProvider, useSocket } from './client/context/SocketContext.tsx';
import { Navbar } from './client/components/Navbar.tsx';
import { Footer } from './client/components/Footer.tsx';
import { DemoBar } from './client/components/DemoBar.tsx';
import { WebRTCCallModal } from './client/components/WebRTCCallModal.tsx';
import { IncomingCallModal } from './client/components/IncomingCallModal.tsx';
import { ChatLauncherProvider, ChatTarget } from './client/context/ChatLauncherContext.tsx';

// Pages
import { LandingPage } from './client/pages/LandingPage.tsx';
import { StudentDashboard } from './client/pages/StudentDashboard.tsx';
import { MentorDiscoveryPage } from './client/pages/MentorDiscoveryPage.tsx';
import { MentorProfilePage } from './client/pages/MentorProfilePage.tsx';
import { MentorDashboard } from './client/pages/MentorDashboard.tsx';
import { MentorAIAssistantPage } from './client/pages/MentorAIAssistantPage.tsx';
import { RoadmapPage } from './client/pages/RoadmapPage.tsx';
import { SessionsPage } from './client/pages/SessionsPage.tsx';
import { MessagesPage } from './client/pages/MessagesPage.tsx';
import { StudentOnboarding } from './client/pages/StudentOnboarding.tsx';
import { AdminDashboard } from './client/pages/AdminDashboard.tsx';
import { AdminVerificationPage } from './client/pages/AdminVerificationPage.tsx';
import { AdminUsersPage } from './client/pages/AdminUsersPage.tsx';
import { LoginPage } from './client/pages/LoginPage.tsx';
import { RegisterPage } from './client/pages/RegisterPage.tsx';

function MainRouter() {
  const { user, isLoading } = useAuth();
  const { sessionState, endCall } = useSocket();
  const [currentPath, setCurrentPath] = useState<string>('/dashboard');
  const [selectedMentorId, setSelectedMentorId] = useState<string>('mentor_profile_1');
  const [chatTarget, setChatTarget] = useState<ChatTarget | null>(null);

  const navigate = (path: string) => {
    setCurrentPath(path);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openChat = (target: ChatTarget) => {
    setChatTarget(target);
    navigate('/messages');
  };

  const handleSelectMentor = (mentorId: string) => {
    setSelectedMentorId(mentorId);
    navigate(`/mentor/${mentorId}`);
  };

  // Don't mount pages (which fetch data) until the session token exists, otherwise first load races and 401s.
  if (isLoading && !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500 text-sm">
        Loading Mentor Connect AI…
      </div>
    );
  }

  return (
    <ChatLauncherProvider value={{ chatTarget, openChat, consumeChatTarget: () => setChatTarget(null) }}>
    <div className="min-h-screen bg-slate-50/50 flex flex-col font-sans text-slate-800 antialiased selection:bg-indigo-500 selection:text-white">
      {/* Top Demo Bar for Hackathon Presentation */}
      <DemoBar onNavigate={navigate} />

      {/* Main Navbar */}
      <Navbar currentPath={currentPath} onNavigate={navigate} />

      {/* Routed Main View */}
      <main className="flex-1">
        {currentPath === '/' && (
          <LandingPage
            onNavigate={navigate}
            onSelectMentor={handleSelectMentor}
          />
        )}

        {currentPath === '/dashboard' && (
          <StudentDashboard
            onNavigate={navigate}
            onSelectMentor={handleSelectMentor}
          />
        )}

        {currentPath === '/mentors' && (
          <MentorDiscoveryPage
            onSelectMentor={handleSelectMentor}
            onBookSuccess={() => navigate('/sessions')}
          />
        )}

        {currentPath.startsWith('/mentor/') && currentPath !== '/mentor/dashboard' && (
          <MentorProfilePage
            mentorId={selectedMentorId}
            onBack={() => navigate('/mentors')}
            onBookSuccess={() => navigate('/sessions')}
            onOpenChat={(id: string) => openChat({ mentorId: id })}
          />
        )}

        {currentPath === '/mentor/dashboard' && (
          <MentorDashboard
            onNavigate={navigate}
          />
        )}

        {currentPath === '/mentor-ai' && (
          <MentorAIAssistantPage
            onNavigateToMentors={() => navigate('/mentors')}
          />
        )}

        {currentPath === '/roadmap' && (
          <RoadmapPage />
        )}

        {currentPath === '/sessions' && (
          <SessionsPage
            onNavigateToMentors={() => navigate('/mentors')}
          />
        )}

        {currentPath === '/messages' && (
          <MessagesPage />
        )}

        {currentPath === '/onboarding' && (
          <StudentOnboarding
            onComplete={() => navigate('/dashboard')}
          />
        )}

        {currentPath === '/admin' && (
          <AdminDashboard
            onNavigate={navigate}
          />
        )}

        {currentPath === '/admin/verification' && (
          <AdminVerificationPage />
        )}

        {currentPath === '/admin/users' && (
          <AdminUsersPage />
        )}

        {currentPath === '/login' && (
          <LoginPage onNavigate={navigate} />
        )}

        {currentPath === '/register' && (
          <RegisterPage onNavigate={navigate} />
        )}
      </main>

      {/* WebRTC Video Call Modal */}
      {sessionState.inCall && (
        <WebRTCCallModal onClose={endCall} />
      )}

      <IncomingCallModal />

      {/* Footer */}
      <Footer />
    </div>
    </ChatLauncherProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <SocketProvider>
        <MainRouter />
      </SocketProvider>
    </AuthProvider>
  );
}
