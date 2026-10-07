import React, { createContext, useContext } from 'react';

export interface ChatTarget {
  mentorId?: string;   // mentor profile id (used by students)
  studentId?: string;  // student user id (used by mentors)
}

interface ChatLauncherValue {
  chatTarget: ChatTarget | null;
  openChat: (target: ChatTarget) => void;
  consumeChatTarget: () => void;
}

const ChatLauncherContext = createContext<ChatLauncherValue>({
  chatTarget: null,
  openChat: () => {},
  consumeChatTarget: () => {}
});

export const ChatLauncherProvider = ChatLauncherContext.Provider;
export const useChatLauncher = () => useContext(ChatLauncherContext);
