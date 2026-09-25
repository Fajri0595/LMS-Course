-- ==============================================================================
-- CourseHub LMS - Migrasi Hierarki Modul & Kuis Interaktif (Pretest/Posttest)
-- File: migration_hierarchical_curriculum.sql
-- ==============================================================================
-- Script ini meng-upgrade struktur database untuk mendukung:
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

-- ==============================================================================
-- 5. SEED DATA CONTOH: Sesuai Gambar Referensi (Akuntansi Dasar & Pre-Exam)
-- ==============================================================================

-- Buat Course Contoh Baru: Akuntansi Dasar & Keuangan Bisnis
INSERT INTO public.courses (id, title, description, author_id, author_name, status, cover_gradient)
VALUES 
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 
   'Dasar-Dasar Akuntansi & Keuangan Perusahaan', 
   'Pelajari siklus akuntansi dari penjurnalan hingga penyusunan laporan keuangan dengan metode interaktif berjenjang.', 
   '22222222-2222-2222-2222-222222222222', 
   'Dr. Syarif Hidayat, M.Pd.', 
   'Aktif', 
   'linear-gradient(135deg, #1e3a5f 0%, #14b8a6 100%)')
ON CONFLICT (id) DO UPDATE SET 
  title = EXCLUDED.title,
  description = EXCLUDED.description;

-- Buat Bab / Modul Utama (Accordion)
INSERT INTO public.course_modules (id, course_id, title, order_index)
VALUES 
  ('d1111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Akuntansi Dasar', 1),
  ('d2222222-2222-2222-2222-222222222222', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Laporan Keuangan Perusahaan', 2),
  ('d3333333-3333-3333-3333-333333333333', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Pencatatan Transaksi', 3),
  ('d4444444-4444-4444-4444-444444444444', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Jurnal Penyesuaian dan Penutup', 4),
  ('d5555555-5555-5555-5555-555555555555', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Laporan Keuangan Pemerintah Daerah', 5)
ON CONFLICT (id) DO UPDATE SET 
  title = EXCLUDED.title,
  order_index = EXCLUDED.order_index;

-- Isi Konten Lengkap: Pre-Exam, Sub-Materi & Kuis Pop-Up, Post-Exam, Tugas, Sertifikat
INSERT INTO public.course_contents (
  id, course_id, module_id, section_name, title, type, duration, order_index, content_body, quiz_data, passing_score
) VALUES 
  -- 1. Pre-Exam (Standalone di awal sebelum materi)
  ('c1000000-0000-0000-0000-000000000001', 
   'cccccccc-cccc-cccc-cccc-cccccccccccc', 
   NULL, 
   'Pra-Pembelajaran', 
   'Pre-Exam: Kemampuan Awal Akuntansi', 
   'pre_exam', 
   '15 Menit', 
   1, 
   '<p>Pre-Exam ini dirancang untuk mengukur pemahaman awal Anda sebelum memulai materi kelas. Kerjakan seluruh soal dengan jujur.</p>',
   '[
     {"id": 1, "question": "Persamaan dasar akuntansi yang benar adalah...", "options": ["Aset = Liabilitas + Ekuitas", "Aset = Liabilitas - Ekuitas", "Ekuitas = Aset + Liabilitas", "Liabilitas = Aset + Ekuitas"], "answerIndex": 0, "explanation": "Persamaan dasar akuntansi adalah Aset = Kewajiban (Liabilitas) + Modal (Ekuitas)."},
     {"id": 2, "question": "Laporan yang menunjukkan posisi keuangan (aset, utang, modal) pada tanggal tertentu adalah...", "options": ["Laporan Laba Rugi", "Neraca (Laporan Posisi Keuangan)", "Laporan Arus Kas", "Laporan Perubahan Modal"], "answerIndex": 1, "explanation": "Neraca menggambarkan posisi aset, liabilitas, dan ekuitas pada periode tertentu."},
     {"id": 3, "question": "Pencatatan debit dilakukan ketika...", "options": ["Aset berkurang", "Liabilitas bertambah", "Aset bertambah atau beban bertambah", "Pendapatan bertambah"], "answerIndex": 2, "explanation": "Aset dan Beban bertambah di sisi Debit."}
   ]'::jsonb,
   60
  ),

  -- 2. Sub-Materi di Bab 1: Akuntansi Dasar
  ('c1000000-0000-0000-0000-000000000002', 
   'cccccccc-cccc-cccc-cccc-cccccccccccc', 
   'd1111111-1111-1111-1111-111111111111', 
   'Akuntansi Dasar', 
   'Pembuka', 
   'materi', 
   '10 Menit', 
   2, 
   '<h3>Selamat Datang di Modul Akuntansi Dasar</h3><p>Modul ini akan membimbing Anda memahami fondasi akuntansi modern, prinsip entitas ekonomi, serta siklus pembukuan sistematis.</p><div style="padding:1rem;background:#f0fdfa;border-left:4px solid #14b8a6;border-radius:6px;margin:1rem 0;"><strong>Tujuan Pembelajaran:</strong> Memahami definisi akuntansi, pihak pengguna laporan, dan prinsip etika profesi akuntan.</div>',
   NULL, 
   NULL
  ),
  ('c1000000-0000-0000-0000-000000000003', 
   'cccccccc-cccc-cccc-cccc-cccccccccccc', 
   'd1111111-1111-1111-1111-111111111111', 
   'Akuntansi Dasar', 
   'Commit & Mindset Pembelajar', 
   'materi', 
   '5 Menit', 
   3, 
   '<h3>Komitmen Belajar Mandiri</h3><p>Konsistensi dan ketelitian adalah kunci utama seorang praktisi akuntansi. Luangkan waktu teratur untuk menyimak materi dan menyelesaikan latihan studi kasus di tiap unit.</p>',
   NULL, 
   NULL
  ),
  ('c1000000-0000-0000-0000-000000000004', 
   'cccccccc-cccc-cccc-cccc-cccccccccccc', 
   'd1111111-1111-1111-1111-111111111111', 
   'Akuntansi Dasar', 
   'Kuis Pop-Up: Commit', 
   'kuis_popup', 
   '5 Menit', 
   4, 
   '<p>Kuis singkat 1 soal untuk memastikan pemahaman dasar komitmen belajar.</p>',
   '[
     {"id": 1, "question": "Karakter utama yang paling esensial dalam praktik akuntansi dan pelaporan keuangan adalah...", "options": ["Kecepatan spekulasi", "Integritas, objektivitas, dan ketelitian", "Menyembunyikan kerugian", "Pencatatan tanpa bukti"], "answerIndex": 1, "explanation": "Prinsip etika akuntan mencakup integritas, objektivitas, dan kehati-hatian profesional."}
   ]'::jsonb,
   100
  ),
  ('c1000000-0000-0000-0000-000000000005', 
   'cccccccc-cccc-cccc-cccc-cccccccccccc', 
   'd1111111-1111-1111-1111-111111111111', 
   'Akuntansi Dasar', 
   'Sejarah Perkembangan Akuntansi', 
   'materi', 
   '4 Menit', 
   5, 
   '<h3>Sejarah Sistem Berpasangan (Double Entry)</h3><p>Sistem pembukuan berpasangan diperkenalkan oleh Luca Pacioli pada tahun 1494 di Venesia, Italia. Prinsip ini memastikan setiap debit memiliki pasangan kredit yang seimbang.</p>',
   NULL, 
   NULL
  ),
  ('c1000000-0000-0000-0000-000000000006', 
   'cccccccc-cccc-cccc-cccc-cccccccccccc', 
   'd1111111-1111-1111-1111-111111111111', 
   'Akuntansi Dasar', 
   'Kuis Pop-Up: Sejarah Perkembangan Akuntansi', 
   'kuis_popup', 
   '5 Menit', 
   6, 
   '<p>Uji pemahaman Anda tentang sejarah sistem pencatatan akuntansi.</p>',
   '[
     {"id": 1, "question": "Siapakah tokoh yang dikenal sebagai Bapak Akuntansi Dunia?", "options": ["Adam Smith", "Luca Pacioli", "John Maynard Keynes", "David Ricardo"], "answerIndex": 1, "explanation": "Luca Pacioli menerbitkan karya Summa de Arithmetica pada tahun 1494."}
   ]'::jsonb,
   100
  ),
  ('c1000000-0000-0000-0000-000000000007', 
   'cccccccc-cccc-cccc-cccc-cccccccccccc', 
   'd1111111-1111-1111-1111-111111111111', 
   'Akuntansi Dasar', 
   'Akuntansi dan Operasi Bisnis', 
   'video', 
   '6 Menit', 
   7, 
   '<p>Video ilustrasi bagaimana transaksi operasional perusahaan dicatat dan dirangkum menjadi informasi pengambil keputusan.</p>',
   NULL, 
   NULL
  ),
  ('c1000000-0000-0000-0000-000000000008', 
   'cccccccc-cccc-cccc-cccc-cccccccccccc', 
   'd1111111-1111-1111-1111-111111111111', 
   'Akuntansi Dasar', 
   'Kuis Pop-Up: Akuntansi dan Operasi Bisnis', 
   'kuis_popup', 
   '5 Menit', 
   8, 
   '<p>Kuis pemahaman hubungan akuntansi dengan keputusan bisnis.</p>',
   '[
     {"id": 1, "question": "Manakah yang merupakan pengguna internal laporan keuangan?", "options": ["Kreditor bank", "Investor publik", "Manajer operasional perusahaan", "Kantor pajak"], "answerIndex": 2, "explanation": "Manajer operasional adalah pengguna internal untuk perencanaan operasional."}
   ]'::jsonb,
   100
  ),

  -- 3. Bagian Evaluasi & Penutup Kelas (Sesuai Gambar 2)
  ('c1000000-0000-0000-0000-000000000009', 
   'cccccccc-cccc-cccc-cccc-cccccccccccc', 
   NULL, 
   'Evaluasi & Ujian Akhir', 
   'Evaluasi Pembelajaran', 
   'evaluasi', 
   '10 Menit', 
   9, 
   '<h3>Kuesioner Evaluasi Modul</h3><p>Berikan penilaian dan umpan balik Anda terhadap materi, tutor, dan pengalaman belajar.</p>',
   NULL, 
   NULL
  ),
  ('c1000000-0000-0000-0000-000000000010', 
   'cccccccc-cccc-cccc-cccc-cccccccccccc', 
   NULL, 
   'Evaluasi & Ujian Akhir', 
   'Post-Exam: Uji Kelulusan Modul', 
   'post_exam', 
   '25 Menit', 
   10, 
   '<p>Post-Exam mengukur capaian akhir kompetensi Anda setelah mempelajari seluruh materi. Nilai kelulusan minimal 70.</p>',
   '[
     {"id": 1, "question": "Jurnal pembelian perlengkapan secara tunai adalah...", "options": ["Perlengkapan (D), Kas (K)", "Kas (D), Perlengkapan (K)", "Beban Perlengkapan (D), Utang (K)", "Perlengkapan (D), Modal (K)"], "answerIndex": 0, "explanation": "Perlengkapan bertambah (Debit) dan Kas berkurang (Kredit)."},
     {"id": 2, "question": "Pada akhir periode, akun pendapatan ditutup ke akun...", "options": ["Kas", "Ikhtisar Laba Rugi", "Modal Pemilik langsung", "Prive"], "answerIndex": 1, "explanation": "Pendapatan dan beban ditutup ke akun sementara Ikhtisar Laba Rugi."}
   ]'::jsonb,
   70
  ),
  ('c1000000-0000-0000-0000-000000000011', 
   'cccccccc-cccc-cccc-cccc-cccccccccccc', 
   NULL, 
   'Tugas Akhir & Refleksi', 
   'Unjuk Keterampilan: Praktik Siklus Akuntansi', 
   'tugas', 
   '45 Menit', 
   11, 
   '<h3>Studi Kasus Praktik Mandiri</h3><p>Unduh lembar kerja transaksi UD Sumber Makmur, susun jurnal umum, buku besar, dan neraca saldo. Unggah file hasil pengerjaan Anda.</p>',
   NULL, 
   NULL
  ),
  ('c1000000-0000-0000-0000-000000000012', 
   'cccccccc-cccc-cccc-cccc-cccccccccccc', 
   NULL, 
   'Tugas Akhir & Refleksi', 
   'Reflective Journal', 
   'refleksi', 
   '15 Menit', 
   12, 
   '<h3>Jurnal Refleksi Diri</h3><p>Tuliskan ringkasan wawasan baru yang Anda dapatkan dan bagaimana Anda akan menerapkannya.</p>',
   NULL, 
   NULL
  ),
  ('c1000000-0000-0000-0000-000000000013', 
   'cccccccc-cccc-cccc-cccc-cccccccccccc', 
   NULL, 
   'Sertifikat', 
   'Lihat Sertifikat Kelulusan', 
   'sertifikat', 
   'Unduh', 
   13, 
   '<h3>Selamat atas Kelulusan Anda!</h3><p>Sertifikat kompetensi Anda telah terbit dan dapat diunduh dalam format digital (PDF).</p>',
   NULL, 
   NULL
  )
ON CONFLICT (id) DO UPDATE SET 
  title = EXCLUDED.title,
  type = EXCLUDED.type,
  section_name = EXCLUDED.section_name,
  quiz_data = EXCLUDED.quiz_data,
  passing_score = EXCLUDED.passing_score;

-- Enroll Siswa Annisa ke Course Akuntansi ini untuk pengujian langsung
INSERT INTO public.enrollments (course_id, student_id)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', '44444444-4444-4444-4444-444444444444')
ON CONFLICT DO NOTHING;
