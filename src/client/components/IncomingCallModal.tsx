import React from 'react';
import { Phone, PhoneOff, Video } from 'lucide-react';
import { useSocket } from '../context/SocketContext.tsx';

export const IncomingCallModal: React.FC = () => {
  const { incomingCall, acceptCall, declineCall } = useSocket();
  if (!incomingCall) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-3xl p-7 text-center text-white shadow-2xl">
        <div className="relative mx-auto w-20 h-20 mb-4">
          <span className="absolute inset-0 rounded-full bg-emerald-500/30 animate-ping" />
          <div className="relative w-20 h-20 rounded-full bg-emerald-600 flex items-center justify-center text-2xl font-black">
            {incomingCall.fromName.charAt(0)}
          </div>
        </div>
        <p className="text-xs uppercase tracking-widest text-emerald-400 font-bold flex items-center justify-center gap-1.5">
          <Video className="w-3.5 h-3.5" /> Incoming video call
        </p>
        <h2 className="text-xl font-black mt-1">{incomingCall.fromName}</h2>
        <p className="text-xs text-slate-400 mt-1 capitalize">{incomingCall.fromRole} · {incomingCall.topic}</p>

        <div className="flex gap-3 mt-6">
          <button
            onClick={declineCall}
            className="flex-1 py-3 rounded-2xl bg-red-600 hover:bg-red-700 font-bold text-sm flex items-center justify-center gap-2 cursor-pointer"
          >
            <PhoneOff className="w-4 h-4" /> Decline
          </button>
          <button
            onClick={acceptCall}
            className="flex-1 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 font-bold text-sm flex items-center justify-center gap-2 cursor-pointer"
          >
            <Phone className="w-4 h-4" /> Accept
          </button>
        </div>
      </div>
    </div>
  );
};
