import { createHttpTransport } from './httpTransport';
import { supabase } from './supabaseClient';

export const httpClient = createHttpTransport({
  baseUrl: (import.meta.env.VITE_API_BASE || '/api').replace(/\/+$/, ''),
  getSession: () => supabase.auth.getSession(),
});
