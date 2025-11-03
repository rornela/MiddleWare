import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, Dimensions, ActivityIndicator, RefreshControl, Image } from 'react-native';
import Video from 'react-native-video';
import { useAuth } from '../contexts/AuthContext';

type FeedPost = {
  id?: string; // for chronological path
  post_id?: string; // for custom path
  author_id: string;
  text_content: string | null;
  created_at: string;
  // Enriched media fields from RPC (custom) or embedded media (chronological)
  media?: Array<{ type: 'photo' | 'video'; mux_playback_id?: string | null; storage_path?: string | null }>; // chronological
  media_type?: 'photo' | 'video' | null; // custom
  mux_playback_id?: string | null; // custom
  storage_path?: string | null; // custom
};

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function FeedScreen() {
  const { supabase } = useAuth();
  const [items, setItems] = useState<FeedPost[]>([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const PAGE_SIZE = 10;

  const mapRows = useCallback((rows: any[]): FeedPost[] => {
    return rows.map((r) => ({
      id: r.id ?? r.post_id,
      post_id: r.post_id ?? r.id,
      author_id: r.author_id,
      text_content: r.text_content ?? null,
      created_at: r.created_at,
      media: r.media ?? undefined,
      media_type: r.media_type ?? null,
      mux_playback_id: r.mux_playback_id ?? null,
      storage_path: r.storage_path ?? null,
    }));
  }, []);

  const fetchPage = useCallback(async (reset = false) => {
    if (loading) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('get-feed', {
        body: { limit: PAGE_SIZE, offset: reset ? 0 : offset },
      });
      if (error) throw error;
      const rows = mapRows((data as any)?.posts ?? []);
      setItems((prev) => (reset ? rows : [...prev, ...rows]));
      setOffset((prev) => (reset ? PAGE_SIZE : prev + PAGE_SIZE));
    } catch (e) {
      console.warn('Failed to fetch feed', e);
    } finally {
      setLoading(false);
      if (reset) setRefreshing(false);
    }
  }, [supabase, offset, loading, mapRows]);

  useEffect(() => {
    fetchPage(true);
  }, []);

  const onEndReached = useCallback(() => {
    if (!loading) fetchPage(false);
  }, [loading, fetchPage]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchPage(true);
  }, [fetchPage]);

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: any[] }) => {
    if (viewableItems?.length > 0) {
      const nextIndex = viewableItems[0].index ?? 0;
      setActiveIndex(nextIndex);
    }
  }).current;

  const viewabilityConfig = useMemo(() => ({ itemVisiblePercentThreshold: 80 }), []);

  const renderItem = useCallback(({ item, index }: { item: FeedPost; index: number }) => {
    const isActive = index === activeIndex;
    return (
      <View style={{ height: SCREEN_HEIGHT, justifyContent: 'center', backgroundColor: 'black' }}>
        <PostItem item={item} isActive={isActive} />
        {item.text_content ? (
          <Text style={{ position: 'absolute', bottom: 80, left: 16, right: 16, color: 'white', fontSize: 16 }}>
            {item.text_content}
          </Text>
        ) : null}
      </View>
    );
  }, [activeIndex]);

  return (
    <View style={{ flex: 1, backgroundColor: 'black' }}>
      <FlatList
        data={items}
        keyExtractor={(item, idx) => (item.id ?? String(idx))}
        renderItem={renderItem}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        onEndReachedThreshold={0.4}
        onEndReached={onEndReached}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig as any}
        getItemLayout={(_, index) => ({ length: SCREEN_HEIGHT, offset: SCREEN_HEIGHT * index, index })}
        ListFooterComponent={loading ? (
          <View style={{ height: 80, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : null}
      />
    </View>
  );
}

function PostItem({ item, isActive }: { item: FeedPost; isActive: boolean }) {
  const { supabase } = useAuth();

  // Derive media details regardless of strategy
  const mediaType = item.media_type ?? item.media?.[0]?.type ?? null;
  const playbackId = item.mux_playback_id ?? item.media?.[0]?.mux_playback_id ?? null;
  const storagePath = item.storage_path ?? item.media?.[0]?.storage_path ?? null;

  if (mediaType === 'video' && playbackId) {
    const uri = `https://stream.mux.com/${playbackId}.m3u8`;
    return (
      <Video
        source={{ uri }}
        style={{ width: '100%', height: '100%' }}
        resizeMode="cover"
        repeat
        paused={!isActive}
        controls={false}
        posterResizeMode="cover"
        playInBackground={false}
        playWhenInactive={false}
      />
    );
  }

  if (mediaType === 'photo' && storagePath) {
    // NOTE: Configure a public bucket or generate signed URLs server-side for private buckets.
    const { data } = supabase.storage.from('photos').getPublicUrl(storagePath);
    const uri = data.publicUrl;
    return <Image source={{ uri }} style={{ width: '100%', height: '100%', resizeMode: 'cover' }} />;
  }

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: 'white' }}>No media</Text>
    </View>
  );
}


