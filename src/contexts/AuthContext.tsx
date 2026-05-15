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
  const resolvedUserIdRef = useRef<string | null>(null);
  const loginRoleSeedRef = useRef<{ userId: string; roles: AppRole[] } | null>(null);

  const fetchRoles = async (userId: string): Promise<AppRole[] | null> => {
    try {
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId);

      if (error) return null;

      return (data?.map(r => r.role as AppRole)) || [];
    } catch {
      return null;
    }
  };

  useEffect(() => {
    let mounted = true;

    const resetAuthState = () => {
      if (!mounted) return;
      authRequestIdRef.current += 1;
      resolvedUserIdRef.current = null;
      loginRoleSeedRef.current = null;
      setSession(null);
      setUser(null);
      setRoles([]);
      setLoading(false);
    };

    const applySessionState = async (event: string, sess: Session | null) => {
      const requestId = ++authRequestIdRef.current;

      if (!mounted) return;

      setSession(sess);
      setUser(sess?.user ?? null);

      if (!sess?.user) {
        setRoles([]);
        setLoading(false);
        return;
      }

      const sameUser = resolvedUserIdRef.current === sess.user.id;
      const seededRoles = loginRoleSeedRef.current?.userId === sess.user.id
        ? loginRoleSeedRef.current.roles
        : null;

      if (seededRoles) {
        setRoles(seededRoles);
        resolvedUserIdRef.current = sess.user.id;
        loginRoleSeedRef.current = null;
        setLoading(false);
        return;
      }

      if (event === 'TOKEN_REFRESHED' && sameUser) {
        setLoading(false);
        return;
      }

      const userRoles = await fetchRoles(sess.user.id);
      if (!mounted || authRequestIdRef.current !== requestId) return;

      if (userRoles) {
        setRoles(userRoles);
        resolvedUserIdRef.current = sess.user.id;
      } else if (!sameUser) {
        setRoles([]);
        resolvedUserIdRef.current = sess.user.id;
      }

      setLoading(false);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, sess) => {
      if (!mounted) return;
      
      if (event === 'SIGNED_OUT') {
        resetAuthState();
        return;
      }

      if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
        void applySessionState(event, sess);
      }
    });

    supabase.auth.getSession().then(async ({ data: { session: sess }, error }) => {
      if (!mounted) return;

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

      void applySessionState('INITIAL_SESSION', sess);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const login = async (password: string): Promise<{ error?: string }> => {
    try {
      authRequestIdRef.current += 1;
      resolvedUserIdRef.current = null;
      loginRoleSeedRef.current = null;
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
      
      if (data.session && data.user) {
        await supabase.auth.signOut({ scope: 'local' });

        loginRoleSeedRef.current = {
          userId: data.user.id,
          roles: Array.isArray(data.roles) ? data.roles as AppRole[] : [],
        };

        const { error: sessionError } = await supabase.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });

        if (sessionError) {
          loginRoleSeedRef.current = null;
          setLoading(false);
          return { error: 'تعذر تثبيت جلسة تسجيل الدخول' };
        }
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
    authRequestIdRef.current += 1;
    resolvedUserIdRef.current = null;
    loginRoleSeedRef.current = null;
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
