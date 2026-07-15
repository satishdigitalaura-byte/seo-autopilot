import { createClient } from '@supabase/supabase-js';

let client;

export function getSupabaseClient() {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — set them in .env or as GitHub Actions secrets.');
  }

  client = createClient(url, key, {
    auth: { persistSession: false },
  });
  return client;
}
