import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, StudentProfile, MentorProfile, UserRole } from '../../types/index.ts';
import { api } from '../api/apiClient.ts';

interface AuthContextType {
  user: User | null;
  profile: StudentProfile | MentorProfile | null;
  isLoading: boolean;
  login: (email: string) => Promise<void>;
  loginAs: (role: UserRole) => Promise<void>;
  register: (name: string, email: string, role: UserRole) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  updateStudentProfile: (data: Partial<StudentProfile>) => Promise<void>;
  updateMentorProfile: (data: Partial<MentorProfile>) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<StudentProfile | MentorProfile | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const refreshUser = async () => {
    try {
      const token = sessionStorage.getItem('mentorconnect_token');
      if (!token) {
        setUser(null);
        setProfile(null);
        setIsLoading(false);
        return;
      }
      const data = await api.getMe();
      setUser(data.user);
      setProfile(data.profile);
    } catch (err) {
      console.error('[AuthContext] Error loading user session:', err);
      sessionStorage.removeItem('mentorconnect_token');
      setUser(null);
      setProfile(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // First load: if this tab has no session, sign in as the demo student for instant live evaluation.
    (async () => {
      if (!sessionStorage.getItem('mentorconnect_token')) {
        try {
          const res = await api.login('student@mentorconnect.demo');
          sessionStorage.setItem('mentorconnect_token', res.token);
        } catch (e) {
          console.error('[AuthContext] Demo auto-login failed:', e);
        }
      }
      await refreshUser();
    })();
  }, []);

  const login = async (email: string) => {
    setIsLoading(true);
    try {
      const res = await api.login(email);
      sessionStorage.setItem('mentorconnect_token', res.token);
      await refreshUser();
    } finally {
      setIsLoading(false);
    }
  };

  const loginAs = async (role: UserRole) => {
    setIsLoading(true);
    let demoEmail = 'student@mentorconnect.demo';
    if (role === 'mentor') demoEmail = 'mentor@mentorconnect.demo';
    if (role === 'admin') demoEmail = 'admin@mentorconnect.demo';

    try {
      const res = await api.login(demoEmail);
      sessionStorage.setItem('mentorconnect_token', res.token);
      await refreshUser();
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (name: string, email: string, role: UserRole) => {
    setIsLoading(true);
    try {
      const res = await api.register({ name, email, role });
      sessionStorage.setItem('mentorconnect_token', res.token);
      await refreshUser();
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    sessionStorage.removeItem('mentorconnect_token');
    setUser(null);
    setProfile(null);
  };

  const updateStudentProfile = async (data: Partial<StudentProfile>) => {
    const res = await api.updateStudentProfile(data);
    setProfile(res.profile);
  };

  const updateMentorProfile = async (data: Partial<MentorProfile>) => {
    const res = await api.updateMentorProfile(data);
    setProfile(res.mentor);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        isLoading,
        login,
        loginAs,
        register,
        logout,
        refreshUser,
        updateStudentProfile,
        updateMentorProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
