import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function createSafeClient(url: string, key: string): SupabaseClient {
  if (!url || !key) {
    // Return a proxy that throws helpful errors if actually used
    return new Proxy({} as SupabaseClient, {
      get(_, prop) {
        if (prop === 'from') {
          return () => {
            throw new Error('Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and keys in .env.local');
          };
        }
        return undefined;
      },
    });
  }
  return createClient(url, key);
}

// Client-side Supabase (uses anon key, respects RLS)
export const supabase = createSafeClient(supabaseUrl, supabaseAnonKey);

// Server-side Supabase (uses service key, bypasses RLS)
export const supabaseAdmin = createSafeClient(supabaseUrl, supabaseServiceKey);

export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseAnonKey);
}
