import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { UserRole } from '../types';
import { LogIn, Sparkles, Mail, Lock, User, Check, X, Shield, Camera, ShieldAlert } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultRole?: UserRole;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, defaultRole = 'event_manager' }) => {
  const { signInWithGoogle, signInWithDemo, signInWithEmail, signUpWithEmail } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [role, setRole] = useState<UserRole>(defaultRole);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (mode === 'signin') {
        await signInWithEmail(email, password);
      } else {
        await signUpWithEmail(email, password, role, displayName);
      }
      onClose();
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Authentication failed. Please verify credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleDemo = async (demoRole: UserRole) => {
    setLoading(true);
    setError(null);
    try {
      await signInWithDemo(demoRole);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Demo sign in failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setLoading(true);
    setError(null);
    try {
      await signInWithGoogle();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Google sign in failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-2xl border border-slate-200">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-bold text-sm">
              L
            </div>
            <h3 className="text-base font-bold text-slate-900">
              {mode === 'signin' ? 'Sign In to Lumina' : 'Create New Account'}
            </h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs">
            {error}
          </div>
        )}

        {/* Quick Demo Logins for Fast Evaluation */}
        <div className="mb-5 p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
            Quick Demo Login (One-Click)
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <button
              onClick={() => handleDemo('super_admin')}
              disabled={loading}
              className="py-2 px-2 bg-white hover:bg-violet-50 border border-slate-200 text-slate-800 text-[11px] font-semibold rounded-xl transition flex flex-col items-center justify-center gap-1 shadow-xs cursor-pointer"
            >
              <ShieldAlert className="w-4 h-4 text-violet-600" />
              <span>Super Admin</span>
            </button>
            <button
              onClick={() => handleDemo('event_manager')}
              disabled={loading}
              className="py-2 px-2 bg-white hover:bg-indigo-50 border border-slate-200 text-slate-800 text-[11px] font-semibold rounded-xl transition flex flex-col items-center justify-center gap-1 shadow-xs cursor-pointer"
            >
              <Shield className="w-4 h-4 text-indigo-600" />
              <span>Manager</span>
            </button>
            <button
              onClick={() => handleDemo('photographer')}
              disabled={loading}
              className="py-2 px-2 bg-white hover:bg-purple-50 border border-slate-200 text-slate-800 text-[11px] font-semibold rounded-xl transition flex flex-col items-center justify-center gap-1 shadow-xs cursor-pointer"
            >
              <Camera className="w-4 h-4 text-purple-600" />
              <span>Photographer</span>
            </button>
          </div>
        </div>

        {/* Google SSO */}
        <button
          onClick={handleGoogle}
          disabled={loading}
          className="w-full py-2.5 px-4 mb-4 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium rounded-xl text-xs transition flex items-center justify-center gap-2 shadow-xs cursor-pointer"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
            />
          </svg>
          Continue with Google
        </button>

        <div className="relative my-4 text-center">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-slate-200"></div>
          </div>
          <span className="relative bg-white px-3 text-[11px] text-slate-400 uppercase tracking-wider">
            Or with email
          </span>
        </div>

        {/* Standard Email / Password Form */}
        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === 'signup' && (
            <>
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Full Name
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    required
                    placeholder="Alex Morgan"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Initial Role
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setRole('event_manager')}
                    className={`py-1.5 px-3 rounded-xl text-xs font-semibold border ${
                      role === 'event_manager'
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                        : 'border-slate-200 text-slate-600'
                    }`}
                  >
                    Event Manager
                  </button>
                  <button
                    type="button"
                    onClick={() => setRole('photographer')}
                    className={`py-1.5 px-3 rounded-xl text-xs font-semibold border ${
                      role === 'photographer'
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                        : 'border-slate-200 text-slate-600'
                    }`}
                  >
                    Photographer
                  </button>
                </div>
              </div>
            </>
          )}

          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Email Address
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="email"
                required
                placeholder="you@domain.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 mt-2 bg-slate-900 hover:bg-black text-white text-xs font-semibold rounded-xl transition shadow-sm"
          >
            {loading ? 'Processing...' : mode === 'signin' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <div className="text-center mt-4">
          <button
            type="button"
            onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
            className="text-xs text-indigo-600 hover:underline"
          >
            {mode === 'signin'
              ? "Don't have an account? Create one"
              : 'Already have an account? Sign in'}
          </button>
        </div>
      </div>
    </div>
  );
};
