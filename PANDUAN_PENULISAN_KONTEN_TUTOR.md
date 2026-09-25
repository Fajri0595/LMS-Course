# 📖 Panduan Lengkap Penulisan Konten Modul LMS (Untuk Tutor & Guru)

> **Panduan Praktis Format Konten Interaktif untuk Orang Awam (Tanpa Perlu Latar Belakang IT/Coding)**  
> *Sistem: CourseHub LMS Interaktif*

---

## 🌟 1. Prinsip Utama: Metode "Salin, Tempel, & Ganti Teks"

Sebagai Tutor/Guru, Anda **TIDAK PERLU** menghafal kode komputer. 

Kolom **"Isi Teks / Panduan Belajar / Narasi Modul"** di LMS ini dirancang fleksibel:
1. **Pilih template desain** yang Anda sukai dari buku panduan ini.
2. **Salin (*Copy*)** kotak kode yang sudah kami siapkan.
3. **Tempel (*Paste*)** ke kolom materi di LMS.
4. **Ganti tulisan di dalamnya** dengan materi pelajaran Anda.
5. Klik tombol **"Simpan Perubahan"** — tampilan materi siswa akan langsung otomatis berubah menjadi rapi, bergradasi warna, dan profesional!

---

## 🔤 2. Kamus Kode Dasar (Sangat Sederhana)

Jika Anda ingin menambahkan variasi tulisan sendiri, berikut adalah 6 kode dasar yang paling sering digunakan:

| Kode yang Diketik | Fungsi | Contoh Hasil Tampilan |
| :--- | :--- | :--- |
| `<h3>Judul Topik</h3>` | Membuat Judul Bab Tebal | **Judul Topik** (Ukuran Besar & Rapi) |
| `<h4>Sub Judul</h4>` | Membuat Sub-topik | **Sub Judul** (Ukuran Sedang) |
| `<p>Kalimat Anda...</p>` | Paragraf kalimat normal | Kalimat paragraf biasa dengan jarak spasi yang nyaman dibaca. |
| `<strong>Kata Penting</strong>` | Menebalkan kata | **Kata Penting** |
| `<em>Istilah Asing</em>` | Memiringkan kata | *Istilah Asing* |
| `<br>` | Menurunkan baris (Enter) | Pindah ke baris baru di bawahnya. |

---

## 🎨 3. Koleksi Kotak Sorotan (*Highlight / Callout Box*)

Gunakan kotak-kotak ini agar materi tidak membosankan dan poin penting langsung menarik perhatian siswa:

### A. Kotak Tujuan Pembelajaran (Warna Hijau Toska Lembut)
*Cocok untuk: Tujuan bab, capaian belajar, atau pembuka materi.*

```html
<div class="lms-box-info">
  <strong>🎯 Tujuan Pembelajaran:</strong>
  Setelah menyelesaikan modul ini, peserta didik mampu mengidentifikasi akun aktiva dan pasiva dengan tepat.
</div>
```

---

### B. Kotak Tips & Petunjuk Belajar (Warna Biru Edukasi)
*Cocok untuk: Tips belajar, cara mudah menghafal, rumus praktis, atau petunjuk tugas.*

```html
<div class="lms-box-tip">
  💡 <strong>Tips Belajar:</strong>
  Gunakan jembatan keledai untuk mengingat urutan siklus, dan pastikan mencatat latihan di buku tulis Anda.
</div>
```

---

### C. Kotak Peringatan / Hal Kritis (Warna Kuning Emas)
*Cocok untuk: Kesalahan umum siswa, peringatan batas waktu, atau syarat kelulusan.*

```html
<div class="lms-box-warning">
  ⚠️ <strong>Penting untuk Diperhatikan:</strong>
  Jumlah kolom Debit dan Kredit pada Neraca Saldo WAJIB seimbang (balance) sebelum lanjut ke jurnal penyesuaian.
</div>
```

---

## 📝 4. Membuat Daftar Poin (*Bullet Points* & Nomor)

### A. Daftar Poin Titik (*Bullet Points*)
```html
<p>Karakteristik penting yang harus dipahami:</p>
<ul>
  <li>Prinsip entitas ekonomi mandiri.</li>
  <li>Satuan moneter yang dapat diukur dengan nilai uang.</li>
  <li>Kelangsungan usaha (*going concern*).</li>
</ul>
```

### B. Daftar Urutan Nomor (1, 2, 3...)
```html
<p>Tahapan pengerjaan tugas mandiri:</p>
<ol>
  <li>Unduh file lembar kerja studi kasus.</li>
  <li>Kerjakan analisis transaksi pada buku besar.</li>
  <li>Kumpulkan hasil dalam bentuk PDF di akhir sesi.</li>
</ol>
```

---

## 🕌 5. Penulisan Karakter Arab, Ayat Al-Qur'an, & Hadits

LMS ini sudah dilengkapi font Arab resmi **Amiri** dan deteksi otomatis arah kanan-ke-kiri (*RTL*). Harakat lengkap (*fathah, kasrah, dhammah, tanwin, tasydid, sukun*) akan tampil tajam dan tidak bertumpuk.

### A. Teks Arab Penuh (Satu Paragraf / Ayat)
```html
<div class="arabic-text">
  بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
</div>
```

### B. Ayat / Hadits Beserta Terjemahan Bahasa Indonesia
```html
<h3>Dalil & Landasan Hukum</h3>

<div class="arabic-text">
  يَا أَيُّهَا الَّذِينَ آمَنُوا اتَّقُوا اللَّهَ وَقُولُوا قَوْلًا سَدِيدًا
</div>

<p><em>"Wahai orang-orang yang beriman! Bertakwalah kamu kepada Allah dan ucapkanlah perkataan yang benar." (QS. Al-Ahzab: 70)</em></p>
```

### C. Menyisipkan Kata Arab di Tengah Kalimat Latin
```html
<p>Dalam tata bahasa Arab, kata benda dikenal dengan istilah <span class="arabic-inline">اِسْمٌ</span> (Isim), sedangkan kata kerja dinamakan <span class="arabic-inline">فِعْلٌ</span> (Fi'il).</p>
```

---

## 🖼️ 6. Menyisipkan Gambar / Infografis / Foto Diagram

Jika Anda memiliki gambar modul (dari Supabase Storage, Google Drive public, atau internet):

```html
<div style="text-align:center;margin:1.5rem 0;">
  <img src="https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=800" alt="Bagan Siklus Keuangan" style="max-width:100%;border-radius:10px;box-shadow:0 3px 10px rgba(0,0,0,0.1);">
  <p style="font-size:0.85rem;color:#64748b;margin-top:0.5rem;"><em>Gambar 1: Ilustrasi Pencatatan Dokumen Finansial</em></p>
</div>
```

---

## 📊 7. Membuat Tabel Data / Perbandingan Konsep

Gunakan kode tabel ini untuk membuat perbandingan dua konsep atau data ringkas:

```html
<table class="lms-table">
  <thead>
    <tr>
      <th>Komponen Akun</th>
      <th>Kenaikan (Debit/Kredit)</th>
      <th>Penurunan (Debit/Kredit)</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Aset / Harta</td>
      <td><strong>Debit</strong></td>
      <td>Kredit</td>
    </tr>
    <tr>
      <td>Kewajiban / Utang</td>
      <td>Kredit</td>
      <td><strong>Debit</strong></td>
    </tr>
    <tr>
      <td>Modal / Ekuitas</td>
      <td>Kredit</td>
      <td><strong>Debit</strong></td>
    </tr>
  </tbody>
</table>
```

---

## 📦 8. Template Lengkap Siap Pakai (Tinggal Salin Sepaket)

Pilihlah salah satu dari template di bawah ini sesuai kebutuhan modul Anda:

### 📑 Template A: Modul Teori Umum & Pembuka Bab
*(Salin seluruh teks di bawah ini ke kolom textarea)*

```html
<h3>Selamat Datang di Modul Pembelajaran</h3>

<p>Selamat mempelajari topik kali ini. Pada sesi ini kita akan membedah konsep dasar secara runtut, mulai dari landasan teoritis hingga aplikasi praktis dalam kehidupan sehari-hari.</p>

<div class="lms-box-info">
  <strong>🎯 Sasaran Belajar:</strong>
  Memahami definisi pokok, mengenal ruang lingkup bahasan, dan mampu membedakan prinsip-prinsip utamanya.
</div>

<h4>Uraian Materi</h4>
<p>Setiap ilmu memiliki fondasi yang kokoh. Dalam mempelajari disiplin ini, Anda diharapkan aktif mencatat poin-poin krusial yang dijelaskan pada uraian berikut.</p>

<ul>
  <li><strong>Poin Pertama:</strong> Konsep awal dan sejarah perkembangan.</li>
  <li><strong>Poin Kedua:</strong> Penerapan aturan baku dan standar operasional.</li>
  <li><strong>Poin Ketiga:</strong> Evaluasi hasil dan tindak lanjut.</li>
</ul>

<div class="lms-box-tip">
  💡 <strong>Tips:</strong> Setelah membaca modul ini, silakan klik tombol <strong>"Selanjutnya"</strong> di sudut kanan bawah untuk menguji pemahaman Anda pada kuis interaktif.
</div>
```

---

### 📑 Template B: Modul Eksakta / Rumus & Contoh Kasus
*(Salin seluruh teks di bawah ini ke kolom textarea)*

```html
<h3>Rumus Dasar & Contoh Soal</h3>

<p>Perhatikan formula matematis di bawah ini dengan saksama:</p>

<div class="lms-box-info">
  <strong>Persamaan Keseimbangan:</strong><br>
  <span style="font-size:1.2rem;font-weight:bold;color:#0f766e;">Aset = Liabilitas + Ekuitas</span>
</div>

<h4>Contoh Studi Kasus:</h4>
<p>Sebuah perusahaan menerima modal tunai sebesar <strong>Rp 50.000.000</strong> dan membeli perlengkapan kantor secara kredit sebesar <strong>Rp 10.000.000</strong>.</p>

<table class="lms-table">
  <thead>
    <tr>
      <th>Keterangan Transaksi</th>
      <th>Pengaruh pada Aset</th>
      <th>Pengaruh pada Pasiva</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Penyetoran Modal</td>
      <td>Kas bertambah (+50 Juta)</td>
      <td>Modal bertambah (+50 Juta)</td>
    </tr>
    <tr>
      <td>Pembelian Kredit</td>
      <td>Perlengkapan bertambah (+10 Juta)</td>
      <td>Utang Usaha bertambah (+10 Juta)</td>
    </tr>
  </tbody>
</table>

<div class="lms-box-warning">
  ⚠️ <strong>Periksa Ulang:</strong> Total Aset (60 Juta) = Total Pasiva (Utang 10 Juta + Modal 50 Juta). Neraca seimbang!
</div>
```

---

### 📑 Template C: Modul Bahasa Arab / Pendidikan Agama Islam
*(Salin seluruh teks di bawah ini ke kolom textarea)*

```html
<h3>Materi: Pembagian Kata dalam Bahasa Arab (أَقْسَامُ الْكَلَامِ)</h3>

<p>Kalam dalam bahasa Arab tersusun atas tiga unsur pokok sebagaimana kaidah berikut:</p>

<div class="arabic-text">
  وَأَقْسَامُهُ ثَلَاثَةٌ: اِسْمٌ، وَفِعْلٌ، وَحَرْفٌ جَاءَ لِمَعْنًى
</div>

<div class="lms-box-info">
  <strong>📌 Rincian 3 Jenis Kata:</strong>
  <ol>
    <li><span class="arabic-inline">اِسْمٌ</span> (Isim): Kata benda, orang, sifat, atau tempat yang tidak terikat waktu.</li>
    <li><span class="arabic-inline">فِعْلٌ</span> (Fi'il): Kata kerja yang terikat dengan dimensi waktu (lampau, sekarang, atau masa depan).</li>
    <li><span class="arabic-inline">حَرْفٌ</span> (Huruf): Kata tugas/penghubung yang baru memiliki makna sempurna saat dirangkai dengan kata lain.</li>
  </ol>
</div>

<div class="lms-box-tip">
  💡 <strong>Latihan Mandiri:</strong> Sebutkan masing-masing 2 contoh Isim dan Fi'il pada buku catatan Anda sebelum mengerjakan latihan di sesi berikutnya.
</div>
```

---

## 🚫 9. Tiga Kesalahan Umum yang Perlu Dihindari

1. **Lupa Menutup Tag**:  
   Jika membuka tag `<strong>`, pastikan ditutup dengan `</strong>`. Jangan biarkan terbuka agar kata setelahnya tidak ikut menjadi tebal.
2. **Mengetik URL Gambar yang Rusak**:  
   Pastikan link gambar dapat diakses secara publik (berawalan `https://` dan berakhiran format gambar seperti `.png`, `.jpg`, atau `.webp`).
3. **Mengisi Karakter Khusus di Luar HTML**:  
   Jika ingin membuat simbol kurang dari `<` atau lebih dari `>`, gunakan tanda spasi atau tulis kata *"kurang dari"*, agar tidak dianggap sebagai kode oleh sistem peramban.

---

*Selamat menyusun modul pembelajaran interaktif yang inspiratif dan memukau bagi peserta didik!*
