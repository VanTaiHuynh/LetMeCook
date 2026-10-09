import { createClient } from '@supabase/supabase-js'
import { browserSupabaseUrl, remapSupabaseStorageUrl } from './deploymentUrl'

export const localSupabaseUrl = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '')
export const supabaseUrl = browserSupabaseUrl(localSupabaseUrl, import.meta.env.VITE_PUBLIC_SITE_ORIGIN, typeof window === 'undefined' ? '' : window.location.origin)
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
export const publicStorageUrl = value => remapSupabaseStorageUrl(value, localSupabaseUrl, supabaseUrl)
