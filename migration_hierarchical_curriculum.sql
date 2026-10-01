-- ==============================================================================
-- CourseHub LMS - Migrasi Hierarki Modul & Kuis Interaktif (Pretest/Posttest)
-- File: migration_hierarchical_curriculum.sql
-- ==============================================================================
-- Script DDL ini meng-upgrade struktur database untuk mendukung:
-- 1. Bab / Lingkup Materi (Course Modules / Sections)
-- 2. Sub-materi bertingkat (Teks, Video, Kuis Pop-Up per Sub-Materi)
-- 3. Pre-Exam (Pretest), Post-Exam (Posttest), Evaluasi, Tugas, & Sertifikat
-- 4. Penyimpanan soal kuis (quiz_data) & metrik hasil ujian (Benar, Salah, Waktu, Nilai)
-- ==============================================================================

-- 1. Buat Tabel Course Modules (Bab / Kelompok Materi Pembelajaran)
CREATE TABLE IF NOT EXISTS public.course_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID REFERENCES public.courses(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  order_index INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 2. Tambahkan Kolom Baru pada course_contents
ALTER TABLE public.course_contents
  ADD COLUMN IF NOT EXISTS module_id UUID REFERENCES public.course_modules(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS section_name TEXT,
  ADD COLUMN IF NOT EXISTS quiz_data JSONB,
  ADD COLUMN IF NOT EXISTS passing_score INT DEFAULT 70;

-- Perbarui constraint tipe konten agar mendukung tipe modular modern
ALTER TABLE public.course_contents DROP CONSTRAINT IF EXISTS course_contents_type_check;
ALTER TABLE public.course_contents ADD CONSTRAINT course_contents_type_check 
  CHECK (type IN (
    -- Tipe baru (hierarki modern)
    'pre_exam', 'materi', 'video', 'kuis_popup', 'evaluasi', 'post_exam', 'tugas', 'refleksi', 'sertifikat',
    -- Kompatibilitas tipe lama
    'Materi', 'Video', 'Kaidah', 'Latihan', 'Kuis'
  ));

-- 3. Tambahkan Kolom Metrik Ujian & Waktu pada Tabel progress
ALTER TABLE public.progress
  ADD COLUMN IF NOT EXISTS correct_answers INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wrong_answers INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS time_spent_seconds INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS answers_data JSONB,
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- 4. Enable Row Level Security (RLS) untuk course_modules
ALTER TABLE public.course_modules ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public Read Modules' AND tablename = 'course_modules') THEN
    CREATE POLICY "Public Read Modules" ON public.course_modules FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public Insert Modules' AND tablename = 'course_modules') THEN
    CREATE POLICY "Public Insert Modules" ON public.course_modules FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public Update Modules' AND tablename = 'course_modules') THEN
    CREATE POLICY "Public Update Modules" ON public.course_modules FOR UPDATE USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public Delete Modules' AND tablename = 'course_modules') THEN
    CREATE POLICY "Public Delete Modules" ON public.course_modules FOR DELETE USING (true);
  END IF;
END $$;
