import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, Button, Alert, ScrollView } from 'react-native';
import { useAuth } from '../contexts/AuthContext';

type Prefs = {
  algorithm_id?: string;
  like_weight?: number;
  comment_weight?: number;
  follower_weight?: number;
  recency_weight?: number;
  third_party_endpoint?: string;
};

const defaultPrefs: Prefs = {
  algorithm_id: 'custom',
  like_weight: 1,
  comment_weight: 0.5,
  follower_weight: 1,
  recency_weight: 1,
};

export default function SettingsScreen() {
  const { supabase, session } = useAuth();
  const [prefs, setPrefs] = useState<Prefs>(defaultPrefs);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!session?.user?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('user_feed_preferences')
        .select('preferences')
        .eq('user_id', session.user.id)
        .maybeSingle();
      if (error) throw error;
      const merged = { ...defaultPrefs, ...(data?.preferences as Prefs | undefined) };
      setPrefs(merged);
    } catch (e) {
      console.warn('Failed to load preferences', e);
    } finally {
      setLoading(false);
    }
  }, [supabase, session?.user?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(async () => {
    if (!session?.user?.id) return;
    setLoading(true);
    try {
      const { error } = await supabase
        .from('user_feed_preferences')
        .upsert({ user_id: session.user.id, preferences: prefs }, { onConflict: 'user_id' });
      if (error) throw error;
      Alert.alert('Saved', 'Feed preferences updated. Reload your feed to see changes.');
    } catch (e) {
      Alert.alert('Error', 'Failed to save preferences.');
    } finally {
      setLoading(false);
    }
  }, [supabase, session?.user?.id, prefs]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Text style={{ fontSize: 18, fontWeight: '600', marginBottom: 12 }}>Feed Algorithm Settings</Text>

      <Text style={{ color: '#666', marginBottom: 8 }}>algorithm_id (custom | chronological | third_party)</Text>
      <TextInput
        value={prefs.algorithm_id}
        onChangeText={(t) => setPrefs((p) => ({ ...p, algorithm_id: t }))}
        placeholder="custom"
        autoCapitalize="none"
        style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10, marginBottom: 16 }}
      />

      <Text style={{ color: '#666', marginBottom: 8 }}>like_weight</Text>
      <NumberInput
        value={prefs.like_weight}
        onChange={(n) => setPrefs((p) => ({ ...p, like_weight: n }))}
      />

      <Text style={{ color: '#666', marginBottom: 8 }}>comment_weight</Text>
      <NumberInput
        value={prefs.comment_weight}
        onChange={(n) => setPrefs((p) => ({ ...p, comment_weight: n }))}
      />

      <Text style={{ color: '#666', marginBottom: 8 }}>follower_weight</Text>
      <NumberInput
        value={prefs.follower_weight}
        onChange={(n) => setPrefs((p) => ({ ...p, follower_weight: n }))}
      />

      <Text style={{ color: '#666', marginBottom: 8 }}>recency_weight</Text>
      <NumberInput
        value={prefs.recency_weight}
        onChange={(n) => setPrefs((p) => ({ ...p, recency_weight: n }))}
      />

      <Text style={{ color: '#666', marginBottom: 8 }}>third_party_endpoint (optional)</Text>
      <TextInput
        value={prefs.third_party_endpoint ?? ''}
        onChangeText={(t) => setPrefs((p) => ({ ...p, third_party_endpoint: t }))}
        placeholder="https://example.com/your-endpoint"
        autoCapitalize="none"
        style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10, marginBottom: 24 }}
      />

      <Button title={loading ? 'Saving...' : 'Save Preferences'} onPress={save} disabled={loading} />
    </ScrollView>
  );
}

function NumberInput({ value, onChange }: { value?: number; onChange: (n: number) => void }) {
  const [text, setText] = useState(value != null ? String(value) : '');
  useEffect(() => {
    setText(value != null ? String(value) : '');
  }, [value]);
  return (
    <TextInput
      value={text}
      onChangeText={(t) => {
        setText(t);
        const n = Number(t);
        if (!Number.isNaN(n)) onChange(n);
      }}
      placeholder="0"
      keyboardType="decimal-pad"
      style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10, marginBottom: 16 }}
    />
  );
}


