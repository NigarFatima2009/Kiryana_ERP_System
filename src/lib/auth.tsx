import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Profile, AppRole } from '../types/database';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  hasRole: (...roles: AppRole[]) => boolean;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error || !data) {
      setProfile(null);
      return null;
    }
    setProfile(data);
    return data;
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        fetchProfile(session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, [fetchProfile]);

  const signIn = async (email: string, password: string) => {
    // First try Supabase auth login
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    
    if (!authError) {
      // Supabase auth successful, verify the session
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        await fetchProfile(session.user.id);
        return {};
      }
    }

    // If Supabase auth fails, try temporary password verification
    const { data, error: rpcError } = await supabase.rpc('verify_employee_password', {
      p_email: email,
      p_password: password,
    });

    if (rpcError || !data || !data[0]) {
      return { error: authError?.message || rpcError?.message || 'Invalid credentials' };
    }

    const result = data[0];
    if (!result.success) {
      return { error: result.message };
    }

    // Temporary password verified, create a session-like state
    // Fetch the employee profile
    await fetchProfile(result.user_id);
    
    // Set a flag that this is a temp password login (not a full auth session)
    // We'll use localStorage to track this
    localStorage.setItem('temp_login_user_id', result.user_id);
    localStorage.setItem('temp_login_email', email);
    
    return {};
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    localStorage.removeItem('temp_login_user_id');
    localStorage.removeItem('temp_login_email');
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
