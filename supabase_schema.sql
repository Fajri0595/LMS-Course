-- ==============================================================================
-- CourseHub LMS - Supabase Database Schema & Security Migration Script
-- ==============================================================================

-- 1. Enable UUID Extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Profiles Table (Menyimpan informasi pengguna & RBAC)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role TEXT CHECK (role IN ('admin', 'educator', 'student')) DEFAULT 'student',
  subject TEXT DEFAULT 'Umum',
  class_name TEXT DEFAULT 'XII MIPA 1',
  teacher_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  phone TEXT,
  whatsapp TEXT,
  status TEXT DEFAULT 'Aktif',
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 3. Courses Table (Katalog Course / Tema Pembelajaran)
CREATE TABLE IF NOT EXISTS public.courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  author_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  status TEXT DEFAULT 'Aktif',
  cover_gradient TEXT DEFAULT 'linear-gradient(135deg, #1e3a5f 0%, #14b8a6 100%)',
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 4. Course Modules Table (Bab / Kelompok Materi Pembelajaran)
CREATE TABLE IF NOT EXISTS public.course_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID REFERENCES public.courses(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  order_index INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 5. Course Contents Table (Unit Sub-Materi, Video, Kuis Pop-Up, Pre-Exam, Post-Exam)
CREATE TABLE IF NOT EXISTS public.course_contents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID REFERENCES public.courses(id) ON DELETE CASCADE NOT NULL,
  module_id UUID REFERENCES public.course_modules(id) ON DELETE CASCADE,
  section_name TEXT,
  title TEXT NOT NULL,
  type TEXT CHECK (type IN (
    'pre_exam', 'materi', 'video', 'kuis_popup', 'evaluasi', 'post_exam', 'tugas', 'refleksi', 'sertifikat',
    'Materi', 'Video', 'Kaidah', 'Latihan', 'Kuis', 'tugas_drive', 'tugas_zoom'
  )) DEFAULT 'materi',
  duration TEXT DEFAULT '5 Menit',
  order_index INT DEFAULT 1,
  embed_url TEXT,
  drive_file_id TEXT,
  content_body TEXT,
  quiz_data JSONB,
  passing_score INT DEFAULT 70,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 6. Enrollments Table (Hubungan Peserta Didik ke Course)
CREATE TABLE IF NOT EXISTS public.enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID REFERENCES public.courses(id) ON DELETE CASCADE NOT NULL,
  student_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  enrolled_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(course_id, student_id)
);

-- 7. Progress Table (Pencatatan Status Belajar & Nilai Unit/Kuis)
CREATE TABLE IF NOT EXISTS public.progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID REFERENCES public.courses(id) ON DELETE CASCADE NOT NULL,
  content_id UUID REFERENCES public.course_contents(id) ON DELETE CASCADE NOT NULL,
  student_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  status TEXT DEFAULT 'Selesai',
  score INT DEFAULT 100,
  correct_answers INT DEFAULT 0,
  wrong_answers INT DEFAULT 0,
  time_spent_seconds INT DEFAULT 0,
  answers_data JSONB,
  notes TEXT,
  completed_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(student_id, content_id)
);

-- 8. Assignment Submissions Table (Pengumpulan Tugas Google Drive & Jadwal Mentoring Zoom)
CREATE TABLE IF NOT EXISTS public.assignment_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID REFERENCES public.courses(id) ON DELETE CASCADE NOT NULL,
  module_id UUID REFERENCES public.course_modules(id) ON DELETE SET NULL,
  content_id UUID REFERENCES public.course_contents(id) ON DELETE CASCADE NOT NULL,
  student_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  tutor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  type TEXT CHECK (type IN ('drive', 'zoom')) NOT NULL DEFAULT 'drive',
  drive_url TEXT,
  student_notes TEXT,
  zoom_url TEXT,
  zoom_meeting_time TIMESTAMPTZ,
  schedule_status TEXT CHECK (schedule_status IN ('proposed', 'confirmed', 'rescheduled', 'completed')) DEFAULT 'proposed',
  approval_status TEXT CHECK (approval_status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
  score INT,
  tutor_feedback TEXT,
  submitted_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  reviewed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(student_id, content_id)
);

-- ==============================================================================
-- Row Level Security (RLS) Policies
-- ==============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_contents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_submissions ENABLE ROW LEVEL SECURITY;

-- Policy untuk Akses Publik / Anonim Demo (Bisa disesuaikan dengan auth.uid() saat production)
CREATE POLICY "Public Read Profiles" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Public Insert Profiles" ON public.profiles FOR INSERT WITH CHECK (true);
CREATE POLICY "Public Update Profiles" ON public.profiles FOR UPDATE USING (true);
CREATE POLICY "Public Delete Profiles" ON public.profiles FOR DELETE USING (true);

CREATE POLICY "Public Read Courses" ON public.courses FOR SELECT USING (true);
CREATE POLICY "Public Insert Courses" ON public.courses FOR INSERT WITH CHECK (true);
CREATE POLICY "Public Update Courses" ON public.courses FOR UPDATE USING (true);
CREATE POLICY "Public Delete Courses" ON public.courses FOR DELETE USING (true);

CREATE POLICY "Public Read Modules" ON public.course_modules FOR SELECT USING (true);
CREATE POLICY "Public Insert Modules" ON public.course_modules FOR INSERT WITH CHECK (true);
CREATE POLICY "Public Update Modules" ON public.course_modules FOR UPDATE USING (true);
CREATE POLICY "Public Delete Modules" ON public.course_modules FOR DELETE USING (true);

CREATE POLICY "Public Read Contents" ON public.course_contents FOR SELECT USING (true);
CREATE POLICY "Public Insert Contents" ON public.course_contents FOR INSERT WITH CHECK (true);
CREATE POLICY "Public Update Contents" ON public.course_contents FOR UPDATE USING (true);
CREATE POLICY "Public Delete Contents" ON public.course_contents FOR DELETE USING (true);

CREATE POLICY "Public Read Enrollments" ON public.enrollments FOR SELECT USING (true);
CREATE POLICY "Public Insert Enrollments" ON public.enrollments FOR INSERT WITH CHECK (true);

CREATE POLICY "Public Read Progress" ON public.progress FOR SELECT USING (true);
CREATE POLICY "Public Insert Progress" ON public.progress FOR INSERT WITH CHECK (true);
CREATE POLICY "Public Update Progress" ON public.progress FOR UPDATE USING (true);

CREATE POLICY "Public Read Submissions" ON public.assignment_submissions FOR SELECT USING (true);
CREATE POLICY "Public Insert Submissions" ON public.assignment_submissions FOR INSERT WITH CHECK (true);
CREATE POLICY "Public Update Submissions" ON public.assignment_submissions FOR UPDATE USING (true);
CREATE POLICY "Public Delete Submissions" ON public.assignment_submissions FOR DELETE USING (true);


-- ==============================================================================
-- End of Schema Definition
-- Semua data pengguna, course, dan materi diinput secara dinamis melalui aplikasi.
-- ==============================================================================

