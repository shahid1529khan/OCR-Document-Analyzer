import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase backend env. Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
}

function getJwtRole(token: string) {
  try {
    const payload = token.split('.')[1];
    const decoded = Buffer.from(payload, 'base64url').toString('utf8');
    return JSON.parse(decoded)?.role;
  } catch {
    return null;
  }
}

if (getJwtRole(supabaseServiceKey) !== 'service_role') {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY must be the Supabase service_role key, not the anon key.');
}

export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
