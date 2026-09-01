import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Profile, AppRole } from '../types/database';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string; mustChangePassword?: boolean }>;
  signOut: () => Promise<void>;
  hasRole: (...roles: AppRole[]) => boolean;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  // Move fetchProfile outside useEffect to prevent infinite loops
  const fetchProfile = useCallback(async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        // Network errors: preserve existing profile to avoid redirect loop
        const isNetworkError = error.message?.includes('Failed to fetch') ||
          error.message?.includes('NetworkError') ||
          error.message?.includes('ERR_INTERNET_DISCONNECTED') ||
          error.code === 'PGRST301';
        if (isNetworkError) {
          console.warn('[Auth] Network error fetching profile, keeping existing profile');
          return null; // Keep existing profile state
        }
        console.error('[Auth] Profile fetch error:', error);
        setProfile(null);
        return null;
      }
      
      if (!data) {
        console.warn('[Auth] No profile data found for user:', userId);
        setProfile(null);
        return null;
      }
      
      console.log('[Auth] Profile loaded:', data);
      setProfile(data);
      return data;
    } catch (err) {
      // Network errors thrown as exceptions
      const isNetworkError = err instanceof Error && (
        err.message?.includes('Failed to fetch') ||
        err.message?.includes('NetworkError')
      );
      if (isNetworkError) {
        console.warn('[Auth] Network error, keeping existing profile');
        return null; // Keep existing profile state
      }
      console.error('[Auth] Unexpected profile fetch error:', err);
      setProfile(null);
      return null;
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    let unsubscribe: (() => void) | undefined;

    async function initializeAuth() {
      try {
        // Get initial session
        const { data: { session: initialSession } } = await supabase.auth.getSession();
        
        if (!isMounted) return;
        
        if (initialSession?.user) {
          setSession(initialSession);
          await fetchProfile(initialSession.user.id);
        } else {
          setSession(null);
          setProfile(null);
        }
      } catch (err) {
        console.error('[Auth] Failed to get initial session:', err);
        setSession(null);
        setProfile(null);
      } finally {
        if (isMounted) setLoading(false);
      }

      // Subscribe to auth changes
      const { data: { subscription } } = supabase.auth.onAuthStateChange(
        async (_event, newSession) => {
          if (!isMounted) return;
          
          console.log('[Auth] State change event:', _event, newSession?.user?.id);
          
          setSession(newSession);
          
          if (newSession?.user) {
            setLoading(true);
            await fetchProfile(newSession.user.id);
            if (isMounted) setLoading(false);
          } else {
            setProfile(null);
            setLoading(false);
          }
        }
      );
      
      unsubscribe = subscription.unsubscribe;
    }

    initializeAuth();

    return () => {
      isMounted = false;
      if (unsubscribe) unsubscribe();
    };
  }, []); // Empty dependency array - run only once on mount

  const signIn = async (email: string, password: string) => {
    const { error: authError, data } = await supabase.auth.signInWithPassword({ email, password });

    if (authError) {
      console.error('[Auth] Sign in error:', authError);
      return { error: authError.message || 'Invalid credentials' };
    }

    if (!data.session?.user) {
      return { error: 'Login failed' };
    }

    const prof = await fetchProfile(data.session.user.id);

    if (!prof) {
      console.warn('[Auth] No profile found after sign in');
      await supabase.auth.signOut();
      return { error: 'Account not found. Please contact the store owner.' };
    }

    if (!prof.active) {
      console.warn('[Auth] Account is inactive');
      await supabase.auth.signOut();
      return { error: 'Your account has been deactivated. Please contact the store owner.' };
    }

    console.log('[Auth] Sign in successful for:', prof.email);
    return { mustChangePassword: prof.must_change_password };
  };

  const signOut = async () => {
    console.log('[Auth] Signing out');
    await supabase.auth.signOut();
    setProfile(null);
    setSession(null);
  };

  const hasRole = (...roles: AppRole[]) => {
    return profile !== null && roles.includes(profile.role);
  };

  const refreshProfile = async () => {
    if (session?.user) {
      await fetchProfile(session.user.id);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        loading,
        signIn,
        signOut,
        hasRole,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
