-- ==============================================================================
-- CourseHub LMS — SQL Script untuk Membuat Auth Users (Login)
-- Jalankan di Supabase SQL Editor SETELAH menjalankan supabase_schema.sql
-- ==============================================================================
-- 
-- Script ini membuat akun login (auth.users) untuk seed data yang sudah ada
-- di tabel public.profiles, sehingga user bisa login via halaman Login.
--
-- PASSWORD DEFAULT untuk semua akun: CourseHub2026!
-- (Ganti setelah login pertama kali)
-- ==============================================================================

-- Aktifkan akses ke schema auth (diperlukan untuk insert langsung)
-- CATATAN: Di Supabase, insert ke auth.users memerlukan service_role key
-- Gunakan Dashboard > Authentication > Users > Add User untuk membuat user manual,
-- ATAU gunakan SQL di bawah ini jika Anda memiliki akses service_role.

-- ==============================================================================
-- CARA TERMUDAH: Buat User via Supabase Dashboard
-- ==============================================================================
-- 1. Buka https://supabase.com/dashboard > Project Anda
-- 2. Klik menu "Authentication" di sidebar kiri
-- 3. Klik tab "Users"
-- 4. Klik tombol "Add user" > "Create new user"
-- 5. Buat 3 user berikut (satu per satu):

-- USER 1 - Administrator:
--   Email   : admin@institusi.sch.id
--   Password: CourseHub2026!

-- USER 2 - Guru/Educator:
--   Email   : syarif@institusi.sch.id
--   Password: CourseHub2026!

-- USER 3 - Siswa:
--   Email   : annisa.n@siswa.institusi.sch.id
--   Password: CourseHub2026!

-- ==============================================================================
-- SETELAH MEMBUAT USER DI DASHBOARD, jalankan SQL ini untuk link auth_user_id
-- ke tabel profiles berdasarkan email yang sama:
-- ==============================================================================

-- Link auth_user_id ke profiles (jalankan SETELAH membuat user di dashboard)
UPDATE public.profiles p
SET auth_user_id = au.id
FROM auth.users au
WHERE p.email = au.email
  AND p.auth_user_id IS NULL;

-- Verifikasi hasilnya:
SELECT p.name, p.email, p.role, 
       CASE WHEN p.auth_user_id IS NOT NULL THEN '✅ Terhubung' ELSE '❌ Belum terhubung' END AS auth_status
FROM public.profiles p
ORDER BY p.role, p.name;

-- ==============================================================================
-- TAMBAHAN: Enrollment siswa ke course (agar Student Dashboard tidak kosong)
-- ==============================================================================

-- Daftarkan Annisa & Ahmad ke kedua course
INSERT INTO public.enrollments (course_id, student_id)
VALUES 
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '55555555-5555-5555-5555-555555555555'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '44444444-4444-4444-4444-444444444444')
ON CONFLICT (course_id, student_id) DO NOTHING;

-- Buat sample progress untuk Annisa (3 unit pertama sudah selesai)
INSERT INTO public.progress (student_id, content_id, course_id, status, score, completed_at)
SELECT 
  '44444444-4444-4444-4444-444444444444',
  cc.id,
  cc.course_id,
  'Selesai',
  100,
  NOW() - (INTERVAL '1 day' * (5 - cc.order_index))
FROM public.course_contents cc
WHERE cc.course_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  AND cc.order_index <= 3
ON CONFLICT (student_id, content_id) DO NOTHING;

-- Verifikasi enrollment & progress:
SELECT 
  p.name AS siswa,
  c.title AS course,
  COUNT(pr.id) AS unit_selesai
FROM public.profiles p
JOIN public.enrollments e ON e.student_id = p.id
JOIN public.courses c ON c.id = e.course_id
LEFT JOIN public.progress pr ON pr.student_id = p.id AND pr.course_id = c.id
WHERE p.role = 'student'
GROUP BY p.name, c.title
ORDER BY p.name, c.title;
