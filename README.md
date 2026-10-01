# CourseHub LMS — Platform Manajemen Pembelajaran & Mentoring Interaktif

CourseHub LMS adalah aplikasi Learning Management System (LMS) berbasis **Modern Web SPA (Single Page Application)** dengan backend **Supabase (PostgreSQL + Auth + Storage)**. Dirancang khusus untuk pembelajaran mandiri terstruktur dan presentasi interaktif pada Interactive Flat Panel (IFP).

---

## 🌟 Fitur Utama

1. **Kurikulum Berjenjang (Hierarchical Chapters & Units)**:
   - Pengorganisasian materi ke dalam **Bab/Tema utama** dan **Sub-tema materi**.
   - Navigasi accordion dengan indikator progres dan status kelulusan.

2. **Tutor Khusus per Course**:
   - Setiap course diasosiasikan dengan profil tutor pengampu (nama lengkap, kontak WhatsApp, email, dan bidang kepakaran).

3. **Gerbang Persetujuan Tema (Gatekeeper Approval System)**:
   - **Tugas Google Drive**: Peserta wajib mengunggah lembar kerja tugas (Google Docs / Spreadsheet / Drive link) untuk dapat melanjutkan dari satu tema ke tema berikutnya.
   - **Pusat Persetujuan Tutor**: Tutor memeriksa berkas tugas, memberikan skor evaluasi (0–100), dan masukan/feedback.
   - **Mekanisme Kelulusan Otomatis**: Jika disetujui, bab berikutnya otomatis terbuka. Jika perlu revisi, bab berikutnya tetap terkunci dan peserta wajib mengulang pengerjaan.

4. **Sesi Mentoring Zoom Terpadu**:
   - Peserta menyediakan link ruang Zoom pribadi dan mengusulkan jadwal temu virtual.
   - Persetujuan jadwal oleh kedua belah pihak (Konfirmasi / Jadwal Ulang).
   - Tombol langsung *"Masuk Ruang Zoom"* di dashboard peserta dan tutor.

5. **Integrasi WhatsApp Tutor Langsung**:
   - Tombol resmi WhatsApp untuk konfirmasi jadwal temu virtual.
   - Tombol pengingat waktu Zoom (*"⏰ Sudah Waktunya Zoom! Beritahu Tutor"*).
   - Kemudahan tutor untuk menghubungi siswa secara personal.

6. **Penyusun Kuis & Ujian Interaktif (Quiz & Exam Builder)**:
   - Pre-Exam, Latihan Pemahaman Pop-Up, Post-Exam kelulusan.
   - Editor Visual WYSIWYG untuk materi modul teks dan integrasi video langsung.

---

## 🏗️ Arsitektur Teknologi

- **Frontend**: Pure Vanilla HTML5, Modern CSS3, dan Vanilla JavaScript (ES6+).
- **Backend**: Supabase (PostgreSQL, Supabase Auth, Row Level Security).
- **Hosting / Deployment**: GitHub Pages / Vercel / Netlify / Static Web Server.
- *Catatan: Aplikasi ini 100% independen dan tidak lagi menggunakan Google Apps Script.*

---

## 📁 Struktur Berkas

```text
├── index.html                           # Halaman utama aplikasi (SPA)
├── app.js                               # Logika bisnis, state manajemen, dan UI rendering
├── supabaseClient.js                    # Inisialisasi Supabase JS Client Bridge
├── supabase_schema.sql                  # Skema database lengkap PostgreSQL (Fresh Deploy)
├── migration_assignment_approval_zoom.sql # Skrip migrasi penugasan Drive & Zoom
├── migration_hierarchical_curriculum.sql# Skrip migrasi kurikulum berjenjang
├── setup_auth_users.sql                 # Skrip SQL untuk bootstrap user auth
├── panduan_tutor_cetak.html             # Template cetak panduan pengampu
├── PANDUAN_PENULISAN_KONTEN_TUTOR.md    # Buku panduan penulisan modul LMS format Markdown
└── PANDUAN_PENULISAN_KONTEN_TUTOR.pdf   # Buku panduan penulisan modul LMS format PDF
```

---

## 🚀 Panduan Menjalankan

### A. Melalui GitHub Pages (Online)
1. Buka repositori di **Settings > Pages**.
2. Pilih **Deploy from a branch** -> Branch: `main`, Folder: `/(root)`.
3. Klik **Save**. Web app akan otomatis aktif di `https://<username>.github.io/<repo-name>/`.

### B. Menjalankan Lokal
Gunakan web server statis sederhana (contoh dengan Node.js):
```bash
npx serve .
# Atau
python -m http.server 3000
```
Buka browser di `http://localhost:3000`.

---

## 🗄️ Konfigurasi Basis Data Supabase

1. Buat proyek baru di [Supabase Console](https://supabase.com).
2. Buka menu **SQL Editor**, salin dan jalankan seluruh isi file `supabase_schema.sql`.
3. Perbarui `supabaseUrl` dan `supabaseAnonKey` pada file `supabaseClient.js` sesuai kredensial proyek Supabase Anda.
