import { getSupabaseClient } from './supabaseClient.js';

const BUCKET = 'blog-images';

/**
 * Uploads generated image bytes to the public blog-images bucket and returns
 * its public URL, ready to drop straight into an <img src>.
 */
export async function uploadGeneratedImage(buffer, fileName) {
  const supabase = getSupabaseClient();
  const path = `${new Date().toISOString().slice(0, 10)}/${Date.now()}-${fileName}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: 'image/png',
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
