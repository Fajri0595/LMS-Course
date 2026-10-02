-- ==============================================================================
-- CourseHub LMS - Migrasi Penghapusan Akun Autentikasi (auth.users)
-- File: migration_delete_auth_user.sql
-- ==============================================================================
-- Masalah yang diselesaikan:
-- Ketika siswa/tutor dihapus dari LMS melalui dashboard Admin, baris di public.profiles
-- terhapus namun akun autentikasi di auth.users masih tersimpan. Akibatnya:
-- 1. Siswa yang dihapus masih bisa masuk kembali lewat Google OAuth (karena auto-create).
-- 2. Email tidak dapat didaftarkan ulang (error: 'User already registered').
--
-- Solusi DDL:
-- 1. Trigger 'tr_on_profile_deleted' dengan SECURITY DEFINER yang otomatis
--    menghapus user dari auth.users setiap kali baris di public.profiles dihapus.
-- 2. Stored Procedure 'delete_user_account(target_user_id uuid)' yang dapat dipanggil
--    langsung via Supabase RPC dari frontend LMS.
-- ==============================================================================

-- 1. Buat Trigger Function untuk menghapus auth.users saat profile dihapus
CREATE OR REPLACE FUNCTION public.handle_profile_deleted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  -- Hapus dari auth.users jika auth_user_id ada
  IF OLD.auth_user_id IS NOT NULL THEN
    DELETE FROM auth.users WHERE id = OLD.auth_user_id;
  END IF;

  -- Hapus juga jika id profile sama dengan id auth.users
  IF OLD.id IS NOT NULL THEN
    DELETE FROM auth.users WHERE id = OLD.id;
  END IF;

  -- Hapus juga jika ada auth.users dengan email yang persis sama
  IF OLD.email IS NOT NULL THEN
    DELETE FROM auth.users WHERE email = OLD.email;
  END IF;

  RETURN OLD;
END;
$$;

-- Pasang Trigger pada tabel public.profiles
DROP TRIGGER IF EXISTS tr_on_profile_deleted ON public.profiles;
CREATE TRIGGER tr_on_profile_deleted
  AFTER DELETE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_profile_deleted();

-- 2. Stored Procedure RPC untuk Penghapusan Akun Lengkap oleh Admin
CREATE OR REPLACE FUNCTION public.delete_user_account(target_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_email text;
  v_auth_id uuid;
BEGIN
  -- Ambil data email dan auth_user_id sebelum profil dihapus
  SELECT email, auth_user_id INTO v_email, v_auth_id
  FROM public.profiles
  WHERE id = target_user_id OR auth_user_id = target_user_id
  LIMIT 1;

  -- 1. Bersihkan seluruh data relasi siswa & tutor
  DELETE FROM public.progress WHERE student_id = target_user_id;
  DELETE FROM public.enrollments WHERE student_id = target_user_id;
  DELETE FROM public.submissions WHERE student_id = target_user_id OR tutor_id = target_user_id;
  
  -- 2. Lepaskan keterkaitan pengampu pada kursus jika yang dihapus adalah tutor
  UPDATE public.courses
  SET author_id = NULL, author_name = 'Belum Ditentukan'
  WHERE author_id = target_user_id;

  -- 3. Hapus profil pengguna dari public.profiles
  DELETE FROM public.profiles
  WHERE id = target_user_id OR (v_auth_id IS NOT NULL AND auth_user_id = v_auth_id);

  -- 4. Hapus pengguna dari auth.users
  IF v_auth_id IS NOT NULL THEN
    DELETE FROM auth.users WHERE id = v_auth_id;
  END IF;
  DELETE FROM auth.users WHERE id = target_user_id;
  IF v_email IS NOT NULL THEN
    DELETE FROM auth.users WHERE email = v_email;
  END IF;

  RETURN json_build_object('success', true, 'message', 'Akun dan profil berhasil dihapus permanen');
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Beri izin eksekusi ke anon & authenticated role agar bisa dipanggil dari frontend LMS
GRANT EXECUTE ON FUNCTION public.delete_user_account(uuid) TO anon, authenticated, service_role;
