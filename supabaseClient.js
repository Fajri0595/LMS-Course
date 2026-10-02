/**
 * CourseHub - Supabase Configuration & Client Initialization (supabaseClient.js)
 * 
 * PETUNJUK:
 * Ganti SUPABASE_URL dan SUPABASE_ANON_KEY di bawah ini dengan kredensial
 * dari Dashboard Supabase Project Anda (Project Settings -> API).
 */

const SUPABASE_CONFIG = {
  URL: 'https://emocavbmyargceusmxcm.supabase.co',
  ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVtb2NhdmJteWFyZ2NldXNteGNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg3MjYxMTYsImV4cCI6MjEwNDMwMjExNn0.a0pKlDmi8tm2jGkOEn_0jqhLYwkGPzTNNy7ep75uESU'
};

// Inisialisasi Supabase Client jika SDK tersedia
let supabaseClient = null;

function getSupabase() {
  if (supabaseClient) return supabaseClient;

  if (typeof window.supabase !== 'undefined' && window.supabase.createClient) {
    // Validasi apakah URL sudah diisi
    if (SUPABASE_CONFIG.URL.includes('YOUR_PROJECT_ID')) {
      console.info('💡 [CourseHub Supabase]: Menggunakan mode fallback offline/mock sampai kredensial Supabase dimasukkan.');
      return null;
    }
    supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.URL, SUPABASE_CONFIG.ANON_KEY);
    return supabaseClient;
  }
  return null;
}

// Client sekunder untuk pembuatan user baru oleh Admin tanpa mengganti sesi login admin saat ini
function getSupabaseAuthAdmin() {
  if (typeof window.supabase !== 'undefined' && window.supabase.createClient) {
    if (SUPABASE_CONFIG.URL.includes('YOUR_PROJECT_ID')) return null;
    return window.supabase.createClient(SUPABASE_CONFIG.URL, SUPABASE_CONFIG.ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });
  }
  return null;
}

