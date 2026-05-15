import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Session, User } from '@supabase/supabase-js';

type AppRole = 'owner' | 'admin' | 'courier' | 'office';

interface AuthState {
  session: Session | null;
  user: User | null;
  roles: AppRole[];
  loading: boolean;
  isOwner: boolean;
  isAdmin: boolean;
  isCourier: boolean;
  isOffice: boolean;
  isOwnerOrAdmin: boolean;
  login: (password: string) => Promise<{ error?: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);
  const authRequestIdRef = useRef(0);

  const fetchRoles = async (userId: string): Promise<AppRole[]> => {
    try {
      const { data } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId);
      return (data?.map(r => r.role as AppRole)) || [];
    } catch {
      return [];
    }
  };

  useEffect(() => {
    let mounted = true;

    const resetAuthState = () => {
      if (!mounted) return;
      setSession(null);
      setUser(null);
      setRoles([]);
      setLoading(false);
    };

    const applySessionState = async (event: string, sess: Session | null, requestId: number) => {
      if (!mounted) return;

      setSession(sess);
      setUser(sess?.user ?? null);

      if (!sess?.user) {
        setRoles([]);
        setLoading(false);
        return;
      }

      if (event === 'TOKEN_REFRESHED') {
        setLoading(false);
        return;
      }

      const userRoles = await fetchRoles(sess.user.id);
      if (!mounted || authRequestIdRef.current !== requestId) return;

      setRoles(userRoles);
      setLoading(false);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, sess) => {
      if (!mounted) return;
      
      if (event === 'SIGNED_OUT') {
        resetAuthState();
        return;
      }

      if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
        const requestId = ++authRequestIdRef.current;
        void applySessionState(event, sess, requestId);
      }
    });

    supabase.auth.getSession().then(async ({ data: { session: sess }, error }) => {
      const initRequestId = authRequestIdRef.current;
      if (!mounted || authRequestIdRef.current !== initRequestId) return;

      const authError = error as { code?: string; message?: string } | null;
      const isMissingRefreshToken = authError?.code === 'refresh_token_not_found'
        || authError?.message?.includes('Refresh Token Not Found');

      if (error || !sess) {
        resetAuthState();
        if (isMissingRefreshToken) {
          await supabase.auth.signOut({ scope: 'local' });
        }
        return;
      }
    });

    const timeout = setTimeout(() => {
      if (mounted && loading) {
        setLoading(false);
      }
    }, 5000);

    return () => {
      mounted = false;
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  const login = async (password: string): Promise<{ error?: string }> => {
    try {
      setLoading(true);
      setRoles([]);

      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/auth-login`,
        {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ password }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setLoading(false);
        return { error: data.error || 'خطأ في تسجيل الدخول' };
      }
      
      if (data.session) {
        await supabase.auth.signOut({ scope: 'local' });
        await supabase.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });
      } else {
        setLoading(false);
      }
      return {};
    } catch {
      setLoading(false);
      return { error: 'خطأ في الاتصال بالخادم' };
    }
  };

  const logout = async () => {
    setRoles([]);
    setSession(null);
    setUser(null);
    await supabase.auth.signOut();
  };

  const isOwner = roles.includes('owner');
  const isAdmin = roles.includes('admin');
  const isCourier = roles.includes('courier');
  const isOffice = roles.includes('office');
  const isOwnerOrAdmin = isOwner || isAdmin;

  return (
    <AuthContext.Provider value={{
      session, user, roles, loading,
      isOwner, isAdmin, isCourier, isOffice, isOwnerOrAdmin,
      login, logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
