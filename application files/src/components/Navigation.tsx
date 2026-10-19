import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { UserRole } from '../types';
import {
  Shield,
  Camera,
  UserCheck,
  LogOut,
  LogIn,
  ChevronDown,
  Layers,
  Sparkles,
  ArrowRightLeft,
  ShieldAlert
} from 'lucide-react';
import { AuthModal } from './AuthModal';

export type ActiveSurface = 'admin' | 'manager' | 'photographer' | 'attendee';

interface NavigationProps {
  currentSurface: ActiveSurface;
  onSurfaceChange: (surface: ActiveSurface) => void;
  activeCheckInEventId?: string | null;
}

export const Navigation: React.FC<NavigationProps> = ({
  currentSurface,
  onSurfaceChange,
  activeCheckInEventId
}) => {
  const { user, profile, role, isSuperAdmin, isManager, isPhotographer, updateRole, logOut } = useAuth();
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);

  const handleSelectRole = async (targetRole: UserRole) => {
    await updateRole(targetRole);
    if (targetRole === 'super_admin') {
      onSurfaceChange('admin');
    } else if (targetRole === 'event_manager') {
      onSurfaceChange('manager');
    } else {
      onSurfaceChange('photographer');
    }
  };

  return (
    <>
      <nav className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            {/* Brand Logo & Name */}
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-400 flex items-center justify-center font-bold text-base shadow-sm">
                L
              </div>
              <div className="flex flex-col">
                <span className="font-bold text-sm tracking-tight text-white flex items-center gap-2">
                  Lumina Hub
                  <span className="text-[10px] font-mono font-medium px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                    Firebase
                  </span>
                </span>
                <span className="text-[10px] text-slate-400 -mt-0.5 hidden sm:inline">
                  Event Photo Management & Check-In
                </span>
              </div>
            </div>

            {/* Surface Switcher Tabs */}
            <div className="flex items-center bg-slate-800/80 p-1 rounded-xl border border-slate-700/80 text-xs">
              {/* Super Admin Tab */}
              <button
                onClick={() => onSurfaceChange('admin')}
                className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer flex items-center gap-1.5 ${
                  currentSurface === 'admin'
                    ? 'bg-violet-600 text-white shadow-xs'
                    : 'text-violet-300 hover:text-white hover:bg-slate-700/50'
                }`}
                title="Super Admin Platform Overview & Cross-Manager Governance"
              >
                <ShieldAlert className="w-3.5 h-3.5 text-violet-400" />
                <span className="hidden sm:inline">Super Admin</span>
                <span className="sm:hidden">Admin</span>
              </button>

              {/* Manager Portal Tab */}
              <button
                onClick={() => onSurfaceChange('manager')}
                className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer flex items-center gap-1.5 ${
                  currentSurface === 'manager'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
                }`}
              >
                <Shield className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Manager Portal</span>
                <span className="sm:hidden">Manager</span>
              </button>

              {/* Photographer Portal Tab */}
              <button
                onClick={() => onSurfaceChange('photographer')}
                className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer flex items-center gap-1.5 ${
                  currentSurface === 'photographer'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
                }`}
              >
                <Camera className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Photographer Portal</span>
                <span className="sm:hidden">Photographer</span>
              </button>

              {/* Attendee Check-In Tab */}
              <button
                onClick={() => onSurfaceChange('attendee')}
                className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer flex items-center gap-1.5 ${
                  currentSurface === 'attendee'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
                }`}
              >
                <UserCheck className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Attendee Check-In</span>
                <span className="sm:hidden">Check-In</span>
              </button>
            </div>

            {/* Auth / Profile Area */}
            <div className="flex items-center gap-2">
              {user ? (
                <div className="relative">
                  <button
                    onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                    className="flex items-center gap-2 p-1.5 pl-2.5 rounded-xl bg-slate-800 hover:bg-slate-750 border border-slate-700 text-xs transition cursor-pointer"
                  >
                    <span className="font-medium text-slate-200 truncate max-w-[120px] hidden md:inline">
                      {profile?.displayName || user.email?.split('@')[0]}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] uppercase font-bold tracking-wider ${
                        isSuperAdmin || role === 'super_admin'
                          ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30'
                          : role === 'event_manager'
                          ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      }`}
                    >
                      {isSuperAdmin || role === 'super_admin' ? 'Admin' : role === 'event_manager' ? 'Manager' : 'Photo'}
                    </span>
                    <div className="w-6 h-6 rounded-lg bg-indigo-600 text-white font-bold flex items-center justify-center text-[11px]">
                      {(profile?.displayName || user.email || 'U').charAt(0).toUpperCase()}
                    </div>
                    <ChevronDown className="w-3 h-3 text-slate-400" />
                  </button>

                  {userDropdownOpen && (
                    <div
                      className="absolute right-0 mt-2 w-60 bg-slate-800 rounded-2xl shadow-xl border border-slate-700 p-2 z-50 text-xs"
                      onClick={() => setUserDropdownOpen(false)}
                    >
                      <div className="px-3 py-2 border-b border-slate-700/80 mb-1">
                        <div className="font-semibold text-slate-200 truncate">
                          {profile?.displayName || user.displayName || 'User'}
                        </div>
                        <div className="text-[11px] text-slate-400 truncate">{user.email}</div>
                      </div>

                      {/* Demo Role Switcher Section */}
                      <div className="py-1 border-b border-slate-700/80 mb-1">
                        <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400 px-3 py-1">
                          Switch Role (Demo Mode)
                        </div>
                        <button
                          onClick={() => handleSelectRole('super_admin')}
                          className={`w-full text-left px-3 py-1.5 rounded-lg transition flex items-center justify-between cursor-pointer ${
                            role === 'super_admin'
                              ? 'bg-violet-600/30 text-violet-200 font-semibold'
                              : 'text-slate-300 hover:bg-slate-700/70'
                          }`}
                        >
                          <span className="flex items-center gap-1.5">
                            <ShieldAlert className="w-3 h-3 text-violet-400" />
                            Super Admin
                          </span>
                          {role === 'super_admin' && <span className="text-[10px]">✓</span>}
                        </button>

                        <button
                          onClick={() => handleSelectRole('event_manager')}
                          className={`w-full text-left px-3 py-1.5 rounded-lg transition flex items-center justify-between cursor-pointer ${
                            role === 'event_manager'
                              ? 'bg-indigo-600/30 text-indigo-200 font-semibold'
                              : 'text-slate-300 hover:bg-slate-700/70'
                          }`}
                        >
                          <span className="flex items-center gap-1.5">
                            <Shield className="w-3 h-3 text-indigo-400" />
                            Event Manager
                          </span>
                          {role === 'event_manager' && <span className="text-[10px]">✓</span>}
                        </button>

                        <button
                          onClick={() => handleSelectRole('photographer')}
                          className={`w-full text-left px-3 py-1.5 rounded-lg transition flex items-center justify-between cursor-pointer ${
                            role === 'photographer'
                              ? 'bg-indigo-600/30 text-indigo-200 font-semibold'
                              : 'text-slate-300 hover:bg-slate-700/70'
                          }`}
                        >
                          <span className="flex items-center gap-1.5">
                            <Camera className="w-3 h-3 text-indigo-400" />
                            Photographer
                          </span>
                          {role === 'photographer' && <span className="text-[10px]">✓</span>}
                        </button>
                      </div>

                      <button
                        onClick={() => logOut()}
                        className="w-full text-left px-3 py-2 rounded-xl hover:bg-rose-500/20 text-rose-300 transition flex items-center gap-2 cursor-pointer"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span>Sign Out</span>
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => setAuthModalOpen(true)}
                  className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>Sign In</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Auth Modal */}
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        defaultRole={currentSurface === 'photographer' ? 'photographer' : 'event_manager'}
      />
    </>
  );
};
