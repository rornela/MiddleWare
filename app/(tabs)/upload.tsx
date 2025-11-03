import React, { useCallback, useState } from 'react';
import { View, Text, Button, Image, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../contexts/AuthContext';

export default function UploadScreen() {
  const { supabase, session } = useAuth();
  const [asset, setAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [uploading, setUploading] = useState(false);

  const pick = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'We need access to your media library.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.All, quality: 1 });
    if (!res.canceled && res.assets?.[0]) {
      setAsset(res.assets[0]);
    }
  }, []);

  const createPostAndMedia = useCallback(async (mediaPayload: { type: 'photo' | 'video'; storage_path?: string; mux_asset_id?: string; mux_playback_id?: string; }, textContent?: string) => {
    if (!session?.user?.id) throw new Error('Not authenticated');
    // Create the post row
    const { data: postRows, error: postErr } = await supabase
      .from('posts')
      .insert({ author_id: session.user.id, text_content: textContent ?? null })
      .select('id')
      .limit(1);
    if (postErr) throw postErr;
    const postId = postRows?.[0]?.id as string;

    // Create the media row
    const { error: mediaErr } = await supabase.from('media').insert({
      post_id: postId,
      type: mediaPayload.type,
      storage_path: mediaPayload.storage_path ?? null,
      mux_asset_id: mediaPayload.mux_asset_id ?? null,
      mux_playback_id: mediaPayload.mux_playback_id ?? null,
    });
    if (mediaErr) throw mediaErr;
    return postId;
  }, [supabase, session?.user?.id]);

  const upload = useCallback(async () => {
    if (!asset) return;
    if (!session?.user?.id) {
      Alert.alert('Not logged in');
      return;
    }
    setUploading(true);
    try {
      if (asset.type === 'image') {
        // Upload photo to Supabase Storage (public bucket recommended, e.g., 'photos')
        const fileResp = await fetch(asset.uri);
        const blob = await fileResp.blob();
        const ext = asset.fileName?.split('.').pop() || 'jpg';
        const path = `${session.user.id}/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from('photos').upload(path, blob, {
          contentType: asset.mimeType ?? 'image/jpeg',
          upsert: false,
        });
        if (upErr) throw upErr;

        const postId = await createPostAndMedia({ type: 'photo', storage_path: path });
        Alert.alert('Uploaded', `Photo post created: ${postId}`);
      } else if (asset.type === 'video') {
        // Secure Mux upload flow via Edge Function (stubbed)
        const { data, error } = await supabase.functions.invoke('get-mux-upload-url', { body: { contentType: asset.mimeType ?? 'video/mp4' } });
        if (error) throw error;
        const { uploadUrl, muxAssetId, muxPlaybackId } = (data as any) || {};
        if (!uploadUrl || !muxPlaybackId) throw new Error('Invalid Mux response');

        const fileResp = await fetch(asset.uri);
        const blob = await fileResp.blob();
        const resp = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': asset.mimeType ?? 'video/mp4' }, body: blob });
        if (!resp.ok) throw new Error(`Mux upload failed: ${resp.status}`);

        const postId = await createPostAndMedia({ type: 'video', mux_asset_id: muxAssetId, mux_playback_id: muxPlaybackId });
        Alert.alert('Uploaded', `Video post created: ${postId}`);
      } else {
        Alert.alert('Unsupported', 'Please select an image or video.');
      }
    } catch (e) {
      console.warn(e);
      Alert.alert('Upload failed', 'Please try again.');
    } finally {
      setUploading(false);
    }
  }, [asset, supabase, session?.user?.id, createPostAndMedia]);

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 18, fontWeight: '600', marginBottom: 12 }}>Upload</Text>
      <Button title="Pick from library" onPress={pick} />
      {asset ? (
        <View style={{ marginTop: 16 }}>
          {asset.type === 'image' ? (
            <Image source={{ uri: asset.uri }} style={{ width: '100%', height: 300, resizeMode: 'cover', borderRadius: 8 }} />
          ) : (
            <Text>Selected video: {asset.fileName ?? 'video'}</Text>
          )}
        </View>
      ) : null}
      <View style={{ marginTop: 24 }}>
        <Button title={uploading ? 'Uploading...' : 'Upload'} onPress={upload} disabled={!asset || uploading} />
      </View>
    </View>
  );
}


