import React, { useEffect } from 'react';
import { Slot, useRouter, useSegments, Stack } from 'expo-router';
import { AuthProvider, useAuth } from './contexts/AuthContext';

// RootLayout wraps the app with AuthProvider and controls group-based redirects.

function AuthGate() {
  const { isLoggedIn, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return; // wait until auth is hydrated
    const inAuthGroup = segments[0] === '(auth)';
    if (!isLoggedIn && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (isLoggedIn && inAuthGroup) {
      router.replace('/(tabs)/feed');
    }
  }, [isLoggedIn, isLoading, segments, router]);

  return <Slot />;
}

export default function RootLayout() {
  return (
    <AuthProvider>
      {/* Optional Stack to show default headers while developing */}
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
      <AuthGate />
    </AuthProvider>
  );
}


