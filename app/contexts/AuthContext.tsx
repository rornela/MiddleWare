import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { createClient, Session, SupabaseClient } from '@supabase/supabase-js';

// Auth context centralizes Supabase client + session for the app.
// It initializes the client once, listens for auth changes, and exposes a simple API.

type AuthContextValue = {
  supabase: SupabaseClient;
  session: Session | null;
  isLoggedIn: boolean;
  isLoading: boolean;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Use Expo public env vars (configure in app.json/app.config.js)
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL as string;
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string;

  const supabase = useMemo(() => {
    if (!supabaseUrl || !supabaseAnonKey) {
      console.warn('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY');
    }
    return createClient(supabaseUrl!, supabaseAnonKey!);
  }, [supabaseUrl, supabaseAnonKey]);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      const { data: { session: initial } } = await supabase.auth.getSession();
      if (!isMounted) return;
      setSession(initial ?? null);
      setIsLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s ?? null);
    });
    return () => {
      isMounted = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  const value: AuthContextValue = {
    supabase,
    session,
    isLoggedIn: Boolean(session?.user?.id),
    isLoading,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
};


