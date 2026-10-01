-- ==============================================================================
-- CourseHub LMS - Migrasi Penugasan Google Drive, Sesi Zoom & Persetujuan Tutor
-- File: migration_assignment_approval_zoom.sql
-- ==============================================================================
-- Script DDL ini menambahkan struktur:
-- 1. Penambahan kolom kontak telepon/WhatsApp pada tabel profiles
-- 2. Pembuatan tabel public.assignment_submissions (Tugas Drive & Sesi Zoom)
-- 3. Dukungan tipe unit konten baru: tugas_drive dan tugas_zoom
-- 4. Row Level Security (RLS) untuk assignment_submissions
-- ==============================================================================

-- 1. Tambahkan kolom kontak telepon & WhatsApp pada tabel profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp TEXT;

-- 2. Buat Tabel Assignment Submissions (Tugas Drive & Booking Zoom)
CREATE TABLE IF NOT EXISTS public.assignment_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID REFERENCES public.courses(id) ON DELETE CASCADE NOT NULL,
  module_id UUID REFERENCES public.course_modules(id) ON DELETE CASCADE,
  content_id UUID REFERENCES public.course_contents(id) ON DELETE CASCADE NOT NULL,
  student_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  tutor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  
  -- Tipe penugasan: 'drive' (Link Google Drive) atau 'zoom' (Sesi Zoom Meeting)
  type TEXT CHECK (type IN ('drive', 'zoom')) DEFAULT 'drive' NOT NULL,
  
  -- Atribut Tugas Google Drive
  drive_url TEXT,
  student_notes TEXT,
  
  -- Atribut Sesi Zoom Meeting
  zoom_url TEXT,
  zoom_meeting_time TIMESTAMPTZ,
  schedule_status TEXT CHECK (schedule_status IN ('proposed', 'confirmed', 'rescheduled', 'completed')) DEFAULT 'proposed',
  tutor_suggested_time TIMESTAMPTZ,
  
  -- Atribut Evaluasi & Persetujuan Tutor
  approval_status TEXT CHECK (approval_status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending' NOT NULL,
  score INT DEFAULT NULL,
  tutor_feedback TEXT,
  reviewed_at TIMESTAMPTZ,
  
  -- Timestamps
  submitted_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  
  -- Satu peserta hanya memiliki 1 rekaman aktif per unit konten
  UNIQUE(student_id, content_id)
);

-- 3. Perbarui Constraint Tipe Konten pada course_contents
ALTER TABLE public.course_contents DROP CONSTRAINT IF EXISTS course_contents_type_check;
ALTER TABLE public.course_contents ADD CONSTRAINT course_contents_type_check 
  CHECK (type IN (
    'pre_exam', 'materi', 'video', 'kuis_popup', 'evaluasi', 'post_exam', 'tugas', 'refleksi', 'sertifikat',
    'tugas_drive', 'tugas_zoom',
    'Materi', 'Video', 'Kaidah', 'Latihan', 'Kuis'
  ));

-- 4. Row Level Security (RLS) untuk assignment_submissions
ALTER TABLE public.assignment_submissions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public Read Submissions' AND tablename = 'assignment_submissions') THEN
    CREATE POLICY "Public Read Submissions" ON public.assignment_submissions FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public Insert Submissions' AND tablename = 'assignment_submissions') THEN
    CREATE POLICY "Public Insert Submissions" ON public.assignment_submissions FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public Update Submissions' AND tablename = 'assignment_submissions') THEN
    CREATE POLICY "Public Update Submissions" ON public.assignment_submissions FOR UPDATE USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public Delete Submissions' AND tablename = 'assignment_submissions') THEN
    CREATE POLICY "Public Delete Submissions" ON public.assignment_submissions FOR DELETE USING (true);
  END IF;
END $$;
