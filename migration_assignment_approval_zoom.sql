-- ==============================================================================
-- CourseHub LMS - Migrasi Penugasan Google Drive, Sesi Zoom & Persetujuan Tutor
-- File: migration_assignment_approval_zoom.sql
-- ==============================================================================
-- Script ini menambahkan fitur profesional:
-- 1. Penambahan kolom kontak telepon/WhatsApp pada tabel profiles
-- 2. Pembuatan tabel public.assignment_submissions (Tugas Drive & Sesi Zoom)
-- 3. Dukungan tipe unit konten baru: tugas_drive dan tugas_zoom
-- 4. Row Level Security (RLS) untuk assignment_submissions
-- 5. Data awal (Seed) tugas kelulusan tema bertingkat & nomor WhatsApp tutor
-- ==============================================================================

-- 1. Tambahkan kolom kontak telepon & WhatsApp pada tabel profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp TEXT;

-- Perbarui kontak WhatsApp untuk Tutor & Siswa Demo
UPDATE public.profiles
SET 
  phone = '081298765432',
  whatsapp = '6281298765432'
WHERE email = 'syarif@institusi.sch.id';

UPDATE public.profiles
SET 
  phone = '081234567890',
  whatsapp = '6281234567890'
WHERE email = 'nurul.aini@institusi.sch.id';

UPDATE public.profiles
SET 
  phone = '085712345678',
  whatsapp = '6285712345678'
WHERE email = 'annisa.n@siswa.institusi.sch.id';

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

-- 5. Seed Data Contoh: Penugasan Gerbang Tema pada Course Akuntansi
-- Pastikan Bab 1 memiliki tugas link Google Drive yang menjadi syarat kelulusan ke Bab 2
INSERT INTO public.course_contents (
  id, course_id, module_id, section_name, title, type, duration, order_index, content_body, passing_score
) VALUES 
  -- Tugas Gerbang Bab 1: Pengumpulan Lembar Kerja Siklus Akuntansi (Link Google Drive)
  ('c1000000-0000-0000-0000-000000000021',
   'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'd1111111-1111-1111-1111-111111111111',
   'Akuntansi Dasar',
   'Tugas Tema 1: Pengumpulan Lembar Kerja Akuntansi (Google Drive)',
   'tugas_drive',
   '30 Menit',
   9,
   '<h3>Instruksi Tugas Akhir Tema 1</h3><p>Sebagai syarat kelulusan Tema 1 dan membuka Tema 2 (Laporan Keuangan Perusahaan), Anda wajib mengerjakan lembar kerja siklus akuntansi transaksi UD Sumber Makmur pada Google Spreadsheet.</p><div class="lms-box-tip">💡 <strong>Petunjuk Pengumpulan:</strong><br>1. Buat salinan (copy) lembar kerja transaksi ke Google Drive Anda.<br>2. Kerjakan jurnal umum, buku besar, dan neraca saldo.<br>3. Atur izin berbagi link menjadi <em>\"Siapa saja yang memiliki link dapat melihat\"</em>.<br>4. Tempelkan link Google Drive Anda pada formulir di bawah ini dan klik tombol Kirim Tugas.</div>',
   75
  ),
  
  -- Unit Materi di Bab 2: Laporan Keuangan Perusahaan
  ('c1000000-0000-0000-0000-000000000022',
   'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'd2222222-2222-2222-2222-222222222222',
   'Laporan Keuangan Perusahaan',
   'Struktur & Komponen Laporan Laba Rugi',
   'materi',
   '10 Menit',
   10,
   '<h3>Struktur Laporan Laba Rugi Komprehensif</h3><p>Laporan Laba Rugi menyajikan pendapatan dan beban entitas selama satu periode tertentu untuk menilai kinerja profitabilitas bisnis.</p>',
   NULL
  ),
  
  -- Tugas Gerbang Bab 2: Sesi Mentoring & Evaluasi Zoom Meeting Tatap Muka
  ('c1000000-0000-0000-0000-000000000023',
   'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'd2222222-2222-2222-2222-222222222222',
   'Laporan Keuangan Perusahaan',
   'Tugas Tema 2: Sesi Evaluasi Tatap Muka (Zoom Meeting)',
   'tugas_zoom',
   '45 Menit',
   11,
   '<h3>Sesi Evaluasi Tatap Muka Virtual via Zoom</h3><p>Pada tema ini, evaluasi kelulusan dilaksanakan secara langsung (live 1-on-1 / kelompok kecil) dengan Tutor Pengampu melalui platform Zoom Meeting.</p><div class="lms-box-info">🎯 <strong>Mekanisme Sesi Zoom:</strong><br>1. <strong>Peserta menyediakan Link Zoom</strong> (buat meeting room Zoom baru dan salin link join).<br>2. <strong>Pilih usulan tanggal & jam pertemuan</strong> yang Anda inginkan.<br>3. <strong>Konfirmasikan jadwal ke WhatsApp Tutor</strong> melalui tombol yang tersedia agar tutor dapat menyetujui jadwal.<br>4. Masuk ke ruang Zoom pada waktu yang disepakati. Tutor akan memberikan penilaian langsung dan meng-approve kelulusan tema Anda.</div>',
   80
  ),
  
  -- Unit Materi di Bab 3: Pencatatan Transaksi
  ('c1000000-0000-0000-0000-000000000024',
   'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'd3333333-3333-3333-3333-333333333333',
   'Pencatatan Transaksi',
   'Teknik Penjurnalan Transaksi Kompleks',
   'materi',
   '15 Menit',
   12,
   '<h3>Praktik Penjurnalan Kasus Lanjutan</h3><p>Selamat telah menyelesaikan Tema 1 dan Tema 2! Di tema ini, kita akan memperdalam pencatatan penyesuaian persediaan dan depresiasi aktiva tetap.</p>',
   NULL
  )
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  type = EXCLUDED.type,
  duration = EXCLUDED.duration,
  content_body = EXCLUDED.content_body,
  order_index = EXCLUDED.order_index;

-- 6. Contoh Seed Submisi Tugas untuk Siswa Annisa (Sebagai Data Demo Awal)
INSERT INTO public.assignment_submissions (
  id, course_id, module_id, content_id, student_id, tutor_id, type, drive_url, student_notes, approval_status, tutor_feedback, submitted_at
) VALUES (
  'e1111111-1111-1111-1111-111111111111',
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'd1111111-1111-1111-1111-111111111111',
  'c1000000-0000-0000-0000-000000000021',
  '44444444-4444-4444-4444-444444444444',
  '22222222-2222-2222-2222-222222222222',
  'drive',
  'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit?usp=sharing',
  'Berikut link lembar kerja jurnal umum dan neraca saldo UD Sumber Makmur yang telah saya selesaikan. Mohon peninjauannya Coach Syarif.',
  'pending',
  NULL,
  NOW() - INTERVAL '2 hours'
)
ON CONFLICT (student_id, content_id) DO NOTHING;
