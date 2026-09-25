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
    'Materi', 'Video', 'Kaidah', 'Latihan', 'Kuis'
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

-- ==============================================================================
-- Row Level Security (RLS) Policies
-- ==============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_contents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.progress ENABLE ROW LEVEL SECURITY;

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

-- ==============================================================================
-- Initial Seed Data (Contoh Data Awal)
-- ==============================================================================

-- 1. Pendidik & Siswa
INSERT INTO public.profiles (id, name, email, role, subject, class_name, status)
VALUES 
  ('11111111-1111-1111-1111-111111111111', 'Administrator Institusi', 'admin@institusi.sch.id', 'admin', 'Super Admin', 'Pusat', 'Aktif'),
  ('22222222-2222-2222-2222-222222222222', 'Dr. Syarif Hidayat, M.Pd.', 'syarif@institusi.sch.id', 'educator', 'Fisika & Sains', 'Guru Pengampu', 'Aktif'),
  ('33333333-3333-3333-3333-333333333333', 'Nurul Aini, S.Si., M.Sc.', 'nurul.aini@institusi.sch.id', 'educator', 'Biologi', 'Guru Pengampu', 'Aktif'),
  ('44444444-4444-4444-4444-444444444444', 'Annisa Nurul Hidayah', 'annisa.n@siswa.institusi.sch.id', 'student', 'Siswa', 'XII MIPA 1', 'Aktif'),
  ('55555555-5555-5555-5555-555555555555', 'Ahmad Fauzi', 'ahmad.f@siswa.institusi.sch.id', 'student', 'Siswa', 'XII MIPA 1', 'Aktif')
ON CONFLICT (id) DO NOTHING;

-- 2. Course Contoh
INSERT INTO public.courses (id, title, description, author_id, author_name, status, cover_gradient)
VALUES 
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Fisika Kuantum & Dinamika Gerak Interaktif', 'Pemahaman konsep dasar fisika gerak dan mekanika melalui simulasi interaktif untuk kelas XII.', '22222222-2222-2222-2222-222222222222', 'Dr. Syarif Hidayat, M.Pd.', 'Aktif', 'linear-gradient(135deg, #1e3a5f 0%, #14b8a6 100%)'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Biologi Sel & Sintesis Protein', 'Eksplorasi struktur organel sel, replikasi DNA, dan tahapan translasi protein dengan visual 3D.', '22222222-2222-2222-2222-222222222222', 'Dr. Syarif Hidayat, M.Pd.', 'Aktif', 'linear-gradient(135deg, #0f766e 0%, #2a3a4f 100%)')
ON CONFLICT (id) DO NOTHING;

-- 3. Unit Konten
INSERT INTO public.course_contents (course_id, title, type, duration, order_index, embed_url, content_body)
VALUES 
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '1. Pengantar Mekanika Kuantum', 'Materi', '15 Menit', 1, NULL, '<h3>Konsep Gelombang Partikel</h3><p>Mekanika kuantum menjelaskan perilaku materi dan energi pada skala atomik dan subatomik. Dualitas gelombang-partikel menyatakan bahwa partikel seperti elektron dapat menunjukkan sifat gelombang.</p><div style="margin-top:1.5rem; padding:1.25rem; background:#f8fafc; border-left:4px solid #14b8a6; border-radius:8px;"><strong>Fakta Kunci:</strong> Teori kuantum pertama kali dirumuskan oleh Max Planck pada tahun 1900 melalui kuantisasi radiasi benda hitam.</div>'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2. Video Eksperimen Celah Ganda', 'Video', '12 Menit', 2, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', '<p>Video demonstrasi pola interferensi elektron saat melewati dua celah sempit, membuktikan sifat gelombang partikel kuantum.</p>'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '3. Kaidah & Hukum Ketidakpastian Heisenberg', 'Kaidah', '10 Menit', 3, NULL, '<h3>Prinsip Ketidakpastian</h3><p>Secara matematis dirumuskan sebagai: <code>Δx · Δp ≥ ℏ/2</code></p><p>Artinya, posisi dan momentum sebuah partikel kuantum tidak dapat diukur secara serentak dengan kepastian yang tak terbatas.</p>'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '4. Latihan Soal Probabilitas Gelombang', 'Latihan', '20 Menit', 4, NULL, '<h3>Latihan Mandiri</h3><p>Hitunglah panjang gelombang de Broglie untuk sebuah elektron yang bergerak dengan kecepatan 2.0 × 10^6 m/s!</p><textarea class="form-control" rows="4" placeholder="Tuliskan langkah pengerjaan Anda di sini..."></textarea>'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '5. Kuis Evaluasi Pemahaman Modul 1', 'Kuis', '25 Menit', 5, NULL, '<h3>Kuis Evaluasi Akhir</h3><p>Pilihlah satu jawaban yang paling tepat dari pertanyaan berikut.</p><div style="margin-top:1rem;"><label style="display:block; margin-bottom:0.5rem;"><input type="radio" name="q1" value="a"> A. Elektron selalu berbentuk gelombang murni</label><label style="display:block; margin-bottom:0.5rem;"><input type="radio" name="q1" value="b"> B. Partikel memiliki panjang gelombang terkait massanya</label></div>')
ON CONFLICT DO NOTHING;
