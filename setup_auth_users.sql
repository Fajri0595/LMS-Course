-- ==============================================================================
-- CourseHub LMS — SQL Helper: Sinkronisasi Akun Auth & Profil
-- Jalankan di Supabase SQL Editor jika diperlukan sinkronisasi ulang
-- ==============================================================================

-- 1. Hubungkan auth_user_id ke tabel public.profiles berdasarkan kesamaan email
UPDATE public.profiles p
SET auth_user_id = au.id
FROM auth.users au
WHERE p.email = au.email
  AND (p.auth_user_id IS NULL OR p.auth_user_id <> au.id);

-- 2. Verifikasi status integrasi profil dan auth user:
SELECT 
  p.id,
  p.name, 
  p.email, 
  p.role, 
  p.class_name,
  CASE WHEN p.auth_user_id IS NOT NULL THEN '✅ Terhubung' ELSE '❌ Belum terhubung' END AS auth_status,
  p.created_at
FROM public.profiles p
ORDER BY p.role, p.name;
