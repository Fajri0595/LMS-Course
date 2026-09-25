/**
   * CourseHub LMS — Full-Stack Application Logic
   * Backend: Supabase (PostgreSQL + Auth)
   * 
   * Arsitektur:
   * - Auth Layer: Supabase Auth (email + password)
   * - Data Layer: Realtime CRUD ke Supabase via JS SDK
   * - UI Layer: Vanilla JS rendering berdasarkan role dari tabel profiles
   */

  /* =========================================================
   * APP STATE — hanya menyimpan state UI, bukan data master
   * ========================================================= */
  const AppState = {
    currentRole: null,        // 'admin' | 'educator' | 'student'
    currentView: null,
    user: null,               // { id, name, email, role, subject, class_name }
    authUser: null,           // Supabase auth.user object
    // Cache data (diisi dari Supabase, bukan hardcoded)
    courses: [],
    students: [],
    educators: [],
    enrollments: {},          // { courseId: count }
    progressMap: {},          // { contentId: true/false }
    progressData: {},         // { contentId: { score, correct_answers, wrong_answers, time_spent_seconds, notes } }
    // Player & Hierarchical Curriculum state
    activeCoursePlayer: null,
    activeUnitIndex: 0,
    expandedChapters: {},     // { [chapterTitle]: boolean }
    activeQuizAnswers: {},    // { [questionId]: optionIdx }
    activeQuizStartTime: null,
    quizReviewMode: {},       // { [unitId]: boolean }
    // Demo mode (untuk presentasi IFP tanpa login)
    isDemoMode: false,
    demoProfiles: {
      admin:   { id: '11111111-1111-1111-1111-111111111111', name: 'Administrator Institusi', email: 'admin@institusi.sch.id', role: 'admin', subject: 'Super Admin', class_name: 'Pusat' },
      educator:{ id: '22222222-2222-2222-2222-222222222222', name: 'Dr. Syarif Hidayat, M.Pd.', email: 'syarif@institusi.sch.id', role: 'educator', subject: 'Fisika & Sains', class_name: 'Guru Pengampu' },
      student: { id: '44444444-4444-4444-4444-444444444444', name: 'Annisa Nurul Hidayah', email: 'annisa.n@siswa.institusi.sch.id', role: 'student', subject: 'Siswa', class_name: 'XII MIPA 1' }
    }
  };

  /* =========================================================
   * BOOTSTRAP — entry point saat halaman dimuat
   * ========================================================= */
  window.addEventListener('load', async () => {
    const sb = typeof getSupabase === 'function' ? getSupabase() : null;

    if (!sb) {
      // Supabase tidak terkonfigurasi — langsung demo mode
      console.warn('⚠️ Supabase tidak terkonfigurasi. Berjalan dalam mode demo.');
      enterDemoMode('educator');
      return;
    }

    // Setup auth state listener — reaktif terhadap login/logout
    sb.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        await handleSessionStart(session.user);
      } else if (event === 'SIGNED_OUT') {
        renderLoginPage();
      }
    });

    // Cek session aktif saat pertama load
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      await handleSessionStart(session.user);
    } else {
      renderLoginPage();
    }
  });

  /* =========================================================
   * AUTH — Login, Logout, Session
   * ========================================================= */

  function renderLoginPage() {
    AppState.user = null;
    AppState.authUser = null;
    AppState.isDemoMode = false;
    document.getElementById('app-root').style.display = 'none';

    let loginEl = document.getElementById('login-overlay');
    if (!loginEl) {
      loginEl = document.createElement('div');
      loginEl.id = 'login-overlay';
      document.body.appendChild(loginEl);
    }

    loginEl.innerHTML = `
      <div class="login-page">
        <div class="login-card">
          <div class="login-brand">
            <div class="brand-logo">C</div>
            <div>
              <h1 class="brand-title">CourseHub LMS</h1>
              <p class="brand-subtitle">Platform Manajemen Pembelajaran Interaktif</p>
            </div>
          </div>

          <!-- Tab Switcher: Peserta Didik vs Tutor -->
          <div class="auth-tabs">
            <button type="button" class="auth-tab-btn active" id="tab-btn-peserta" onclick="switchLoginRole('peserta')">
              <span style="margin-right:.375rem;">🎓</span> Peserta Didik
            </button>
            <button type="button" class="auth-tab-btn" id="tab-btn-tutor" onclick="switchLoginRole('tutor')">
              <span style="margin-right:.375rem;">👨‍🏫</span> Tutor
            </button>
          </div>

          <div id="login-error" class="login-error" style="display:none;"></div>
          <div id="login-success" class="login-success" style="display:none;"></div>

          <!-- FORM LOGIN (Peserta Didik & Tutor — dibedakan secara visual) -->
          <form id="form-login" onsubmit="handleLogin(event)">
            <div class="form-group">
              <label class="form-label" id="login-email-label">Email Peserta Didik</label>
              <input type="email" id="login-email" class="form-control" placeholder="contoh: nama@peserta.sch.id" required autocomplete="email">
            </div>
            <div class="form-group">
              <label class="form-label">Password</label>
              <div style="position:relative;">
                <input type="password" id="login-password" class="form-control" placeholder="Masukkan password" required autocomplete="current-password" style="padding-right:3rem;">
                <button type="button" onclick="togglePasswordVis('login-password')" style="position:absolute;right:.75rem;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--tertiary);">👁️</button>
              </div>
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%;margin-top:.75rem;" id="login-submit-btn">
              <span id="login-btn-icon" style="margin-right:.375rem;">🎓</span>
              <span id="login-btn-text">Masuk sebagai Peserta Didik</span>
            </button>
            <p id="login-hint-text" style="text-align:center;font-size:.8125rem;color:var(--tertiary);margin-top:1.25rem;line-height:1.4;">
              Akun peserta didik didaftarkan oleh tutor pengampu masing-masing kelas.
            </p>
          </form>

        </div>
      </div>
    `;
    loginEl.style.display = 'flex';
  }

  function switchLoginRole(role) {
    const isPeserta = role === 'peserta' || role === 'mahasiswa';
    const tabPeserta = document.getElementById('tab-btn-peserta') || document.getElementById('tab-btn-mahasiswa');
    const tabTutor = document.getElementById('tab-btn-tutor') || document.getElementById('tab-btn-dosen');
    const errEl = document.getElementById('login-error');
    const succEl = document.getElementById('login-success');
    const emailLabel = document.getElementById('login-email-label');
    const emailInput = document.getElementById('login-email');
    const btnIcon = document.getElementById('login-btn-icon');
    const btnText = document.getElementById('login-btn-text');
    const hintText = document.getElementById('login-hint-text');

    if (errEl) errEl.style.display = 'none';
    if (succEl) succEl.style.display = 'none';

    if (isPeserta) {
      if (tabPeserta) tabPeserta.classList.add('active');
      if (tabTutor) tabTutor.classList.remove('active');
      if (emailLabel) emailLabel.textContent = 'Email Peserta Didik';
      if (emailInput) emailInput.placeholder = 'contoh: nama@peserta.sch.id';
      if (btnIcon) btnIcon.textContent = '🎓';
      if (btnText) btnText.textContent = 'Masuk sebagai Peserta Didik';
      if (hintText) hintText.textContent = 'Akun peserta didik didaftarkan oleh tutor pengampu masing-masing kelas.';
    } else {
      if (tabPeserta) tabPeserta.classList.remove('active');
      if (tabTutor) tabTutor.classList.add('active');
      if (emailLabel) emailLabel.textContent = 'Email Tutor';
      if (emailInput) emailInput.placeholder = 'contoh: tutor@institusi.sch.id';
      if (btnIcon) btnIcon.textContent = '👨‍🏫';
      if (btnText) btnText.textContent = 'Masuk sebagai Tutor';
      if (hintText) hintText.textContent = 'Gunakan email dan password tutor yang sudah terdaftar di sistem.';
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const btn = document.getElementById('login-submit-btn');
    const errEl = document.getElementById('login-error');
    const loginBtnOriginal = btn.innerHTML;

    btn.disabled = true;
    btn.textContent = 'Memverifikasi...';
    if (errEl) errEl.style.display = 'none';

    const sb = getSupabase();
    if (!sb) {
      showLoginError('Koneksi Supabase tidak tersedia.');
      btn.disabled = false;
      btn.innerHTML = loginBtnOriginal;
      return;
    }

    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      showLoginError('Email atau password salah. ' + (error.message || ''));
      btn.disabled = false;
      btn.innerHTML = loginBtnOriginal;
    }
    // Jika berhasil, onAuthStateChange akan memicu handleSessionStart()
  }

  async function handleSessionStart(authUser) {
    AppState.authUser = authUser;
    AppState.isDemoMode = false;

    // Ambil profil dari tabel profiles berdasarkan auth_user_id
    const sb = getSupabase();
    const { data: profile, error } = await sb
      .from('profiles')
      .select('*')
      .eq('auth_user_id', authUser.id)
      .single();

    if (error || !profile) {
      // Profil tidak ditemukan — coba cocokkan via email
      const { data: profileByEmail } = await sb
        .from('profiles')
        .select('*')
        .eq('email', authUser.email)
        .single();

      if (profileByEmail) {
        // Link auth_user_id ke profil yang ada
        await sb.from('profiles').update({ auth_user_id: authUser.id }).eq('id', profileByEmail.id);
        AppState.user = profileByEmail;
      } else {
        showLoginError('Profil pengguna tidak ditemukan di database. Hubungi administrator.');
        await getSupabase().auth.signOut();
        return;
      }
    } else {
      AppState.user = profile;
    }

    hideLoginPage();
    await initApp();
  }

  async function enterDemoMode(role) {
    AppState.isDemoMode = true;
    AppState.user = { ...AppState.demoProfiles[role] };
    hideLoginPage();
    await initApp();
  }

  function hideLoginPage() {
    const loginEl = document.getElementById('login-overlay');
    if (loginEl) loginEl.style.display = 'none';
    document.getElementById('app-root').style.display = 'flex';
  }

  function showLoginError(msg) {
    const el = document.getElementById('login-error');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
  }

  function togglePasswordVis(inputId = 'login-password') {
    const pw = document.getElementById(inputId);
    if (pw) pw.type = pw.type === 'password' ? 'text' : 'password';
  }

  async function handleLogout() {
    const sb = typeof getSupabase === 'function' ? getSupabase() : null;
    if (sb && !AppState.isDemoMode) {
      await sb.auth.signOut();
    } else {
      renderLoginPage();
    }
  }

  /* =========================================================
   * TOPBAR ROLE BADGE — Tampilkan hanya peran akun yang aktif
   * ========================================================= */
  function updateTopbarRoleBadge(role) {
    const badge = document.getElementById('topbar-role-badge');
    const label = document.getElementById('topbar-role-label');
    if (!badge || !label) return;

    const roleConfigs = {
      admin:    { label: 'Administrator', class: 'role-admin' },
      educator: { label: 'Tutor', class: 'role-educator' },
      student:  { label: 'Peserta Didik', class: 'role-student' }
    };

    const cfg = roleConfigs[role] || { label: role, class: '' };
    badge.className = `user-role-pill ${cfg.class}`;
    label.textContent = cfg.label;
  }

  /* =========================================================
   * APP INIT — setup role, sidebar, awal render
   * ========================================================= */
  async function initApp() {
    const role = AppState.user.role;
    AppState.currentRole = role;

    // Update sidebar user info
    const initials = AppState.user.name.split(' ').slice(0,2).map(w => w[0]).join('').toUpperCase();
    document.getElementById('user-avatar-text').textContent = initials;
    document.getElementById('user-display-name').textContent = AppState.user.name;
    const roleLabels = { admin: 'Super Administrator', educator: 'Tutor Pengampu', student: 'Peserta Didik' };
    document.getElementById('user-display-role').textContent = roleLabels[role] || role;

    // Update role badge di pojok kanan atas
    updateTopbarRoleBadge(role);

    // Bangun sidebar sesuai role
    if (role === 'admin') buildSidebarForAdmin();
    else if (role === 'educator') buildSidebarForEducator();
    else buildSidebarForStudent();

    // Muat data awal dari Supabase
    showLoadingState();
    await loadInitialData();

    // Navigasi ke dashboard sesuai role
    if (role === 'admin') navigateTo('admin-dashboard');
    else if (role === 'educator') navigateTo('educator-dashboard');
    else navigateTo('student-dashboard');
  }

  function showLoadingState() {
    document.getElementById('view-container').innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:60vh;flex-direction:column;gap:1rem;">
        <div class="spinner"></div>
        <p style="color:var(--tertiary);">Memuat data dari Supabase...</p>
      </div>
    `;
  }

  /* =========================================================
   * DATA LAYER — semua fetch dari Supabase
   * ========================================================= */

  async function loadInitialData() {
    const sb = typeof getSupabase === 'function' ? getSupabase() : null;
    if (!sb) {
      // mode demo: load data mock minimal
      AppState.courses = [];
      AppState.students = [];
      AppState.educators = [];
      return;
    }

    try {
      await Promise.all([
        loadCourses(sb),
        loadProfiles(sb)
      ]);
      // Muat enrollment counts setelah courses tersedia
      await loadEnrollmentCounts(sb);
      // Jika student, muat progress
      if (AppState.currentRole === 'student') {
        await loadStudentProgress(sb);
      }
      console.log('✅ Data berhasil dimuat dari Supabase.');
    } catch (err) {
      console.error('❌ Gagal memuat data:', err);
      showToast('Gagal memuat data dari Supabase: ' + err.message, 'error');
    }
  }

  async function loadCourses(sb) {
    let query = sb.from('courses').select(`
      id, title, description, author_id, author_name, status, cover_gradient, created_at,
      modules:course_modules(id, title, order_index),
      contents:course_contents(id, title, type, duration, embed_url, content_body, order_index, module_id, section_name, quiz_data, passing_score)
    `).order('created_at', { ascending: false });

    // Educator hanya lihat course miliknya sendiri (kecuali admin & demo)
    if (AppState.currentRole === 'educator' && !AppState.isDemoMode && AppState.user) {
      query = query.eq('author_id', AppState.user.id);
    }

    let { data, error } = await query;
    if (error) {
      console.warn('Query courses dengan modules gagal, mencoba query kompatibilitas:', error);
      const fallback = await sb.from('courses').select(`
        id, title, description, author_id, author_name, status, cover_gradient, created_at,
        contents:course_contents(id, title, type, duration, embed_url, content_body, order_index, module_id, section_name, quiz_data, passing_score)
      `).order('created_at', { ascending: false });
      if (fallback.data) data = fallback.data;
      else throw error;
    }

    AppState.courses = (data || []).map(c => ({
      id: c.id,
      title: c.title,
      description: c.description,
      authorId: c.author_id,
      authorName: c.author_name,
      status: c.status,
      createdAt: (c.created_at || '').split('T')[0],
      coverGradient: c.cover_gradient || 'linear-gradient(135deg, #1e3a5f 0%, #14b8a6 100%)',
      enrolledStudents: 0, // akan diisi loadEnrollmentCounts
      modules: ((c.modules || []).sort((a, b) => (a.order_index || 0) - (b.order_index || 0))),
      contents: ((c.contents || [])
        .sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
        .map(cnt => ({
          id: cnt.id,
          moduleId: cnt.module_id,
          sectionName: cnt.section_name || '',
          title: cnt.title,
          type: cnt.type,
          duration: cnt.duration || '5 Menit',
          embedUrl: cnt.embed_url || '',
          contentBody: cnt.content_body || '',
          quizData: cnt.quiz_data || null,
          passingScore: cnt.passing_score || 70,
          completed: false // akan diisi loadStudentProgress
        })))
    }));
  }

  async function loadProfiles(sb) {
    const { data, error } = await sb.from('profiles').select('*').order('name');
    if (error) throw error;

    AppState.educators = (data || [])
      .filter(p => p.role === 'educator' || p.role === 'admin')
      .map(e => ({
        id: e.id,
        name: e.name,
        email: e.email,
        subject: e.subject || 'Umum',
        status: e.status || 'Aktif',
        totalCourses: AppState.courses.filter(c => c.authorId === e.id).length
      }));

    AppState.students = (data || [])
      .filter(p => p.role === 'student')
      .map(s => ({
        id: s.id,
        name: s.name,
        email: s.email,
        class: s.class_name || 'XII MIPA 1',
        status: s.status || 'Aktif',
        progress: 0,
        completedCourses: 0
      }));
  }

  async function loadEnrollmentCounts(sb) {
    const { data, error } = await sb.from('enrollments').select('course_id');
    if (error) return;
    const counts = {};
    (data || []).forEach(e => { counts[e.course_id] = (counts[e.course_id] || 0) + 1; });
    AppState.courses.forEach(c => { c.enrolledStudents = counts[c.id] || 0; });
    AppState.enrollments = counts;
  }

  async function loadStudentProgress(sb) {
    const studentId = AppState.user?.id;
    if (!studentId) return;
    const { data, error } = await sb
      .from('progress')
      .select('content_id, score, correct_answers, wrong_answers, time_spent_seconds, notes')
      .eq('student_id', studentId);
    if (error) return;
    const map = {};
    const progressData = {};
    (data || []).forEach(p => { 
      map[p.content_id] = true;
      progressData[p.content_id] = p;
    });
    AppState.progressMap = map;
    AppState.progressData = progressData;
    // Mark units sebagai completed
    AppState.courses.forEach(c => {
      c.contents.forEach(u => { u.completed = !!map[u.id]; });
      c.completedUnits = c.contents.filter(u => u.completed).length;
      c.totalUnits = c.contents.length;
    });
  }

  async function loadEnrolledCourses(sb) {
    // Untuk student: dapatkan hanya course yang di-enroll
    const studentId = AppState.user?.id;
    if (!studentId) return AppState.courses;
    const { data, error } = await sb
      .from('enrollments')
      .select('course_id')
      .eq('student_id', studentId);
    if (error) return AppState.courses;
    const enrolledIds = new Set((data || []).map(e => e.course_id));
    return AppState.courses.filter(c => enrolledIds.has(c.id));
  }

  async function loadProgressReport(sb) {
    // Admin/Educator: ambil semua progress dengan join ke profiles dan contents
    const { data, error } = await sb
      .from('progress')
      .select(`
        student_id, content_id, course_id, score, completed_at,
        student:profiles!progress_student_id_fkey(name, class_name, email),
        content:course_contents!progress_content_id_fkey(title, course_id),
        course:courses!progress_course_id_fkey(title)
      `);
    if (error) throw error;
    return data || [];
  }

  /* =========================================================
   * CRUD OPERATIONS — semua write ke Supabase
   * ========================================================= */

  async function dbCreateCourse({ title, description, authorName, authorId }) {
    const sb = getSupabase();
    if (!sb) throw new Error('Supabase tidak tersedia');
    const { data, error } = await sb.from('courses').insert([{
      title,
      description,
      author_name: authorName,
      author_id: authorId || null,
      status: 'Aktif'
    }]).select().single();
    if (error) throw error;
    return data;
  }

  async function dbUpdateCourse(courseId, { title, description, coverGradient }) {
    const sb = getSupabase();
    if (!sb) throw new Error('Supabase tidak tersedia');
    const updatePayload = { title, description };
    if (coverGradient) updatePayload.cover_gradient = coverGradient;
    const { error } = await sb.from('courses').update(updatePayload).eq('id', courseId);
    if (error) throw error;
  }

  async function dbDeleteCourse(courseId) {
    const sb = getSupabase();
    if (!sb) throw new Error('Supabase tidak tersedia');
    const { error } = await sb.from('courses').delete().eq('id', courseId);
    if (error) throw error;
  }

  async function dbAddContent({ courseId, title, type, duration, embedUrl, contentBody, orderIndex }) {
    const sb = getSupabase();
    if (!sb) throw new Error('Supabase tidak tersedia');
    const { data, error } = await sb.from('course_contents').insert([{
      course_id: courseId,
      title,
      type,
      duration: duration || '15 Menit',
      embed_url: embedUrl || null,
      content_body: contentBody || '',
      order_index: orderIndex || 1
    }]).select().single();
    if (error) throw error;
    return data;
  }

  async function dbEditContent(contentId, { title, type, duration, embedUrl, contentBody }) {
    const sb = getSupabase();
    if (!sb) throw new Error('Supabase tidak tersedia');
    const { error } = await sb.from('course_contents').update({
      title, type,
      duration: duration || '15 Menit',
      embed_url: embedUrl || null,
      content_body: contentBody || ''
    }).eq('id', contentId);
    if (error) throw error;
  }

  async function dbDeleteContent(contentId) {
    const sb = getSupabase();
    if (!sb) throw new Error('Supabase tidak tersedia');
    const { error } = await sb.from('course_contents').delete().eq('id', contentId);
    if (error) throw error;
  }

  async function dbAddProfile({ name, email, role, subject, className }) {
    const sb = getSupabase();
    if (!sb) throw new Error('Supabase tidak tersedia');
    const { data, error } = await sb.from('profiles').insert([{
      name,
      email,
      role,
      subject: subject || 'Umum',
      class_name: className || 'XII MIPA 1',
      status: 'Aktif'
    }]).select().single();
    if (error) throw error;
    return data;
  }

  async function dbEnrollStudent(courseId, studentId) {
    const sb = getSupabase();
    if (!sb) throw new Error('Supabase tidak tersedia');
    const { error } = await sb.from('enrollments').insert([{ course_id: courseId, student_id: studentId }]);
    if (error && !error.message.includes('duplicate')) throw error;
  }

  async function dbMarkContentComplete(contentId, courseId) {
    const sb = getSupabase();
    const studentId = AppState.user?.id;
    if (!sb || !studentId) return;
    const { error } = await sb.from('progress').upsert([{
      student_id: studentId,
      content_id: contentId,
      course_id: courseId,
      status: 'Selesai',
      score: 100,
      completed_at: new Date().toISOString()
    }], { onConflict: 'student_id,content_id' });
    if (error) throw error;
  }

  async function dbSubmitQuizResult({ contentId, courseId, score, correctAnswers, wrongAnswers, timeSpentSeconds, notes }) {
    const sb = getSupabase();
    const studentId = AppState.user?.id;
    if (!sb || !studentId) return;
    const { error } = await sb.from('progress').upsert([{
      student_id: studentId,
      content_id: contentId,
      course_id: courseId,
      status: 'Selesai',
      score,
      correct_answers: correctAnswers,
      wrong_answers: wrongAnswers,
      time_spent_seconds: timeSpentSeconds,
      notes,
      completed_at: new Date().toISOString()
    }], { onConflict: 'student_id,content_id' });
    if (error) throw error;
  }

  /* =========================================================
   * NAVIGATION & ROUTING
   * ========================================================= */
  function navigateTo(viewId, param = null) {
    AppState.currentView = viewId;
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.getAttribute('data-view') === viewId);
    });

    // Tutup sidebar drawer di mobile jika sedang terbuka
    const sidebar = document.querySelector('.sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    if (sidebar) sidebar.classList.remove('open');
    if (backdrop) backdrop.classList.remove('active');

    const container = document.getElementById('view-container');
    const titleEl = document.getElementById('page-title');

    switch (viewId) {
      case 'admin-dashboard':
        titleEl.textContent = 'Dasbor Utama Administrator';
        renderAdminDashboard(container);
        break;
      case 'educator-dashboard':
        titleEl.textContent = 'Katalog Course & Modul Ajar';
        renderEducatorDashboard(container);
        break;
      case 'student-dashboard':
        titleEl.textContent = 'Ruang Belajar Mandiri Siswa';
        renderStudentDashboard(container);
        break;
      case 'student-management':
        titleEl.textContent = 'Manajemen Rombel & Peserta Didik';
        renderStudentManagement(container);
        break;
      case 'course-editor':
        titleEl.textContent = param ? 'Edit Struktur Kurikulum & Konten' : 'Penyusunan Materi Course Baru';
        renderCourseEditor(container, param);
        break;
      case 'course-player':
        titleEl.textContent = 'Player Interaktif Pembelajaran';
        if (AppState.courses.length > 0) {
          const targetId = param || AppState.courses[0].id;
          renderCoursePlayer(container, targetId);
        } else {
          container.innerHTML = '<div style="padding:3rem;text-align:center;"><p>Belum ada course tersedia.</p></div>';
        }
        break;
      case 'progress-report':
        titleEl.textContent = 'Laporan Capaian Belajar & Ekspor PDF';
        renderProgressReport(container);
        break;
      case 'enroll-management':
        titleEl.textContent = 'Manajemen Enrollment Siswa';
        renderEnrollManagement(container, param);
        break;
      default:
        renderEducatorDashboard(container);
    }
  }

  /* =========================================================
   * DEMO MODE — Role Switcher (untuk presentasi IFP)
   * ========================================================= */
  async function setRole(role) {
    // Jika sudah login sungguhan, role switcher hanya untuk demo/preview
    if (!AppState.isDemoMode && AppState.authUser) {
      const confirmed = confirm('Role Switcher ini untuk mode demo/presentasi. Akun login Anda tetap aktif. Lanjutkan?');
      if (!confirmed) return;
    }
    AppState.isDemoMode = true;
    AppState.user = { ...AppState.demoProfiles[role] };
    AppState.currentRole = role;

    updateTopbarRoleBadge(role);

    const initials = AppState.user.name.split(' ').slice(0,2).map(w => w[0]).join('').toUpperCase();
    document.getElementById('user-avatar-text').textContent = initials;
    document.getElementById('user-display-name').textContent = AppState.user.name;
    const roleLabels = { admin: 'Super Administrator', educator: 'Tutor Pengampu', student: 'Peserta Didik' };
    document.getElementById('user-display-role').textContent = roleLabels[role];

    showLoadingState();
    await loadInitialData();

    if (role === 'admin') { buildSidebarForAdmin(); navigateTo('admin-dashboard'); }
    else if (role === 'educator') { buildSidebarForEducator(); navigateTo('educator-dashboard'); }
    else { buildSidebarForStudent(); navigateTo('student-dashboard'); }

    showToast(`Mode Demo: ${roleLabels[role]}`, 'success');
  }

  /* =========================================================
   * SIDEBAR BUILDERS
   * ========================================================= */
  function buildSidebarForAdmin() {
    const nav = document.getElementById('sidebar-nav-container');
    const logoutHtml = buildLogoutButton();
    nav.innerHTML = `
      <div class="nav-group-title">SUPER ADMIN</div>
      <a class="nav-item active" data-view="admin-dashboard" onclick="navigateTo('admin-dashboard')">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
        <span>Ikhtisar Sistem & Guru</span>
      </a>
      <a class="nav-item" data-view="educator-dashboard" onclick="navigateTo('educator-dashboard')">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
        <span>Kelola Semua Course</span>
      </a>
      <a class="nav-item" data-view="student-management" onclick="navigateTo('student-management')">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
        <span>Kelola Semua Siswa</span>
      </a>
      <a class="nav-item" data-view="progress-report" onclick="navigateTo('progress-report')">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
        <span>Audit Capaian & PDF</span>
      </a>
      <div class="nav-group-title">SIMULASI & PRESENTASI</div>
      <a class="nav-item" data-view="course-player" onclick="navigateTo('course-player', AppState.courses[0]?.id)">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
        <span>Mode Putar IFP Kelas</span>
      </a>
      ${logoutHtml}
    `;
  }

  function buildSidebarForEducator() {
    const nav = document.getElementById('sidebar-nav-container');
    const logoutHtml = buildLogoutButton();
    nav.innerHTML = `
      <div class="nav-group-title">RUANG KERJA PENDIDIK</div>
      <a class="nav-item active" data-view="educator-dashboard" onclick="navigateTo('educator-dashboard')">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
        <span>Katalog Course Saya</span>
      </a>
      <a class="nav-item" data-view="student-management" onclick="navigateTo('student-management')">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
        <span>Kelola Peserta Didik</span>
      </a>
      <a class="nav-item" data-view="progress-report" onclick="navigateTo('progress-report')">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
        <span>Laporan & Ekspor PDF</span>
      </a>
      <div class="nav-group-title">SIMULASI KELAS</div>
      <a class="nav-item" data-view="course-player" onclick="navigateTo('course-player', AppState.courses[0]?.id)">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
        <span>Mode Presentasi IFP</span>
      </a>
      ${logoutHtml}
    `;
  }

  function buildSidebarForStudent() {
    const nav = document.getElementById('sidebar-nav-container');
    const logoutHtml = buildLogoutButton();
    nav.innerHTML = `
      <div class="nav-group-title">PEMBELAJARAN</div>
      <a class="nav-item active" data-view="student-dashboard" onclick="navigateTo('student-dashboard')">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
        <span>Course Terdaftar</span>
      </a>
      <a class="nav-item" data-view="progress-report" onclick="navigateTo('progress-report')">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
        <span>Capaian Belajar Saya</span>
      </a>
      ${logoutHtml}
    `;
  }

  function buildLogoutButton() {
    return `
      <div class="nav-group-title">AKUN</div>
      <a class="nav-item" onclick="handleLogout()" style="color:var(--error);">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
        <span>${AppState.isDemoMode ? 'Kembali ke Login' : 'Keluar (Logout)'}</span>
      </a>
    `;
  }

  /* =========================================================
   * VIEW RENDERERS
   * ========================================================= */

  // 1. Educator Dashboard
  function renderEducatorDashboard(container) {
    if (AppState.courses.length === 0) {
      container.innerHTML = `
        <div style="text-align:center;padding:4rem 2rem;">
          <div style="font-size:3rem;margin-bottom:1rem;">📚</div>
          <h2 style="margin-bottom:.5rem;">Belum Ada Course</h2>
          <p style="color:var(--tertiary);margin-bottom:1.5rem;">Buat course pertama Anda untuk mulai berbagi materi pembelajaran.</p>
          <button class="btn btn-authoritative" onclick="openModalCreateCourse()">
            + Buat Course Pertama
          </button>
        </div>
      `;
      return;
    }

    const coursesHtml = AppState.courses.map(c => `
      <div class="card card-hover" style="display:flex;flex-direction:column;justify-content:space-between;">
        <div>
          <div style="height:100px;border-radius:8px;background:${c.coverGradient};margin-bottom:1rem;padding:1rem;color:#fff;display:flex;flex-direction:column;justify-content:space-between;">
            <span class="badge badge-success" style="align-self:flex-start;background:rgba(255,255,255,0.25);color:#fff;backdrop-filter:blur(4px);">${c.status}</span>
            <small style="opacity:.9;">${c.contents.length} Unit Konten</small>
          </div>
          <h3 style="font-size:1.125rem;margin-bottom:.5rem;line-height:1.4;">${escHtml(c.title)}</h3>
          <p style="font-size:.8125rem;line-height:1.5;margin-bottom:1.25rem;">${escHtml(c.description || '')}</p>
        </div>
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;font-size:.75rem;color:var(--tertiary);">
            <span>👥 ${c.enrolledStudents} Siswa Terdaftar</span>
            <span>📅 ${c.createdAt}</span>
          </div>
          <div style="display:flex;gap:.5rem;flex-wrap:wrap;">
            <button class="btn btn-outline btn-sm" style="flex:1;min-width:120px;" onclick="navigateTo('course-editor','${c.id}')">
              📚 Kelola Modul
            </button>
            <button class="btn btn-outline btn-sm" onclick="openModalEditCourse('${c.id}')" title="Edit Informasi Course">
              ✏️ Edit
            </button>
            <button class="btn btn-primary btn-sm" onclick="navigateTo('course-player','${c.id}')">
              ▶ Putar di IFP
            </button>
            <button class="btn btn-ghost btn-sm" onclick="openEnrollModal('${c.id}')" title="Kelola Enrollment" style="color:var(--secondary);">
              👥
            </button>
            <button class="btn btn-ghost btn-sm" onclick="confirmDeleteCourse('${c.id}')" title="Hapus Course" style="color:var(--error);">
              🗑️
            </button>
          </div>
        </div>
      </div>
    `).join('');

    const totalUnits = AppState.courses.reduce((s, c) => s + c.contents.length, 0);
    const totalStudents = AppState.students.length;

    container.innerHTML = `
      <div class="grid-stats">
        <div class="stat-card">
          <div class="stat-icon" style="background:#dbeafe;color:#1d4ed8;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
          </div>
          <div>
            <div class="stat-value">${AppState.courses.length}</div>
            <div class="stat-label">Total Course Aktif</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:#ccfbf1;color:#0f766e;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle></svg>
          </div>
          <div>
            <div class="stat-value">${totalStudents}</div>
            <div class="stat-label">Peserta Didik Diampu</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:#fef3c7;color:#b45309;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
          </div>
          <div>
            <div class="stat-value">${totalUnits}</div>
            <div class="stat-label">Total Unit Materi</div>
          </div>
        </div>
      </div>

      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem;">
        <div>
          <h2>Tema & Course Pembelajaran</h2>
          <p>Kelola susunan materi ajar, kaidah, dan simulasi interaktif.</p>
        </div>
        <button class="btn btn-authoritative" onclick="openModalCreateCourse()">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          Buat Course Baru
        </button>
      </div>

      <div class="grid-courses">
        ${coursesHtml}
      </div>
    `;
  }

  // 2. Admin Dashboard
  function renderAdminDashboard(container) {
    const educatorsRows = AppState.educators.map(e => `
      <tr>
        <td style="font-weight:600;color:var(--primary);">${escHtml(e.name)}</td>
        <td>${escHtml(e.email)}</td>
        <td><span class="badge badge-materi">${escHtml(e.subject)}</span></td>
        <td>${e.totalCourses} Modul</td>
        <td><span class="badge ${e.status === 'Nonaktif' ? 'badge-materi' : 'badge-success'}">${escHtml(e.status || 'Aktif')}</span></td>
        <td style="display:flex;gap:.375rem;align-items:center;">
          <button class="btn btn-outline btn-sm" onclick="openModalEditEducator('${e.id}','${escHtml(e.name)}','${escHtml(e.subject)}','${escHtml(e.email || '')}','${escHtml(e.status || 'Aktif')}')">Edit</button>
          <button class="btn btn-authoritative btn-sm" onclick="openModalCreateCourse('${e.id}','${escHtml(e.name)}')">+ Course</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--error);" onclick="confirmDeleteEducator('${e.id}','${escHtml(e.name)}')">Hapus</button>
        </td>
      </tr>
    `).join('');

    const allCoursesList = AppState.courses.map(c => `
      <div class="course-admin-item" style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:1rem;margin-bottom:.75rem;display:flex;align-items:center;justify-content:space-between;">
        <div style="display:flex;align-items:center;gap:.75rem;">
          <div style="width:12px;height:12px;border-radius:50%;background:var(--secondary);flex-shrink:0;"></div>
          <div>
            <strong style="font-size:.9375rem;color:var(--primary);">${escHtml(c.title)}</strong>
            <div style="font-size:.75rem;color:var(--tertiary);">Pengampu: <b>${escHtml(c.authorName)}</b> | ${c.contents.length} Unit | ${c.enrolledStudents} Siswa</div>
          </div>
        </div>
        <div class="course-admin-actions" style="display:flex;gap:.5rem;">
          <button class="btn btn-outline btn-sm" onclick="navigateTo('course-editor','${c.id}')">Edit Kurikulum</button>
          <button class="btn btn-outline btn-sm" onclick="openModalEditCourse('${c.id}')">✏️ Edit Info</button>
          <button class="btn btn-primary btn-sm" onclick="navigateTo('course-player','${c.id}')">Inspeksi IFP</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--error);" onclick="confirmDeleteCourse('${c.id}')">Hapus</button>
        </div>
      </div>
    `).join('');

    container.innerHTML = `
      <div class="grid-stats">
        <div class="stat-card">
          <div class="stat-icon" style="background:#e0e7ff;color:#3730a3;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
          </div>
          <div>
            <div class="stat-value">${AppState.educators.length}</div>
            <div class="stat-label">Total Guru / Pendidik</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:#ccfbf1;color:#0f766e;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
          </div>
          <div>
            <div class="stat-value">${AppState.courses.length}</div>
            <div class="stat-label">Total Course Institusi</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:#dbeafe;color:#1d4ed8;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle></svg>
          </div>
          <div>
            <div class="stat-value">${AppState.students.length}</div>
            <div class="stat-label">Total Peserta Didik</div>
          </div>
        </div>
      </div>

      <div class="admin-action-banner" style="background:#fff;border-radius:12px;border:1px solid var(--border);padding:1.25rem;margin-bottom:1.5rem;display:flex;align-items:center;justify-content:space-between;">
        <div>
          <h3 style="font-size:1.125rem;margin-bottom:.25rem;">Akses Penuh Master Administrator</h3>
          <p style="font-size:.8125rem;">Buat course, kelola akun guru, daftarkan siswa, dan edit seluruh kurikulum.</p>
        </div>
        <div class="admin-btn-group" style="display:flex;gap:.5rem;">
          <button class="btn btn-authoritative" onclick="openModalCreateCourse()">+ Buat Course</button>
          <button class="btn btn-outline" onclick="openModalAddStudent()">+ Daftarkan Siswa</button>
          <button class="btn btn-primary" onclick="openModalAddEducator()">+ Tambah Pendidik</button>
        </div>
      </div>

      <div style="margin-bottom:2rem;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;">
          <h3>Daftar Seluruh Course Sekolah</h3>
          <span class="badge badge-success">${AppState.courses.length} Course Aktif</span>
        </div>
        ${allCoursesList || '<p style="color:var(--tertiary);text-align:center;padding:1rem;">Belum ada course. Buat course pertama!</p>'}
      </div>

      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;">
        <h3>Daftar Akun Pendidik & Pengampu</h3>
        <button class="btn btn-outline btn-sm" onclick="openModalAddEducator()">+ Tambah Guru Baru</button>
      </div>
      <div class="table-container">
        <table class="data-table">
          <thead><tr><th>Nama Pendidik</th><th>Email</th><th>Bidang Studi</th><th>Jumlah Course</th><th>Status</th><th>Aksi</th></tr></thead>
          <tbody>${educatorsRows}</tbody>
        </table>
      </div>
    `;
  }

  // 3. Course Editor
  function renderCourseEditor(container, courseId) {
    const course = AppState.courses.find(c => c.id === courseId) || AppState.courses[0];
    if (!course) {
      container.innerHTML = '<div style="padding:3rem;text-align:center;"><p>Course tidak ditemukan.</p></div>';
      return;
    }

    const unitsList = (course.contents || []).map((u, idx) => `
      <div style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:1rem;margin-bottom:.75rem;display:flex;align-items:center;justify-content:space-between;">
        <div style="display:flex;align-items:center;gap:.75rem;">
          <span style="color:var(--tertiary);font-weight:bold;min-width:24px;">${idx + 1}.</span>
          <span class="badge badge-${u.type.toLowerCase()}">${u.type}</span>
          <div>
            <strong style="font-size:.9375rem;color:var(--primary);">${escHtml(u.title)}</strong>
            <div style="font-size:.75rem;color:var(--tertiary);">Estimasi: ${u.duration}</div>
          </div>
        </div>
        <div style="display:flex;gap:.5rem;">
          <button class="btn btn-outline btn-sm" onclick="openModalEditContent('${course.id}','${u.id}')">✏️ Edit</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--error);" onclick="confirmDeleteContent('${u.id}','${course.id}')">🗑️ Hapus</button>
        </div>
      </div>
    `).join('');

    container.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem;flex-wrap:wrap;gap:1rem;">
        <div>
          <button class="btn btn-outline btn-sm" onclick="navigateTo('${AppState.currentRole === 'admin' ? 'admin-dashboard' : 'educator-dashboard'}')" style="margin-bottom:.5rem;">
            ← Kembali ke Katalog
          </button>
          <div style="display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;">
            <h2 style="margin:0;">${escHtml(course.title)}</h2>
            <button class="btn btn-outline btn-sm" onclick="openModalEditCourse('${course.id}')" title="Edit Judul & Info Course">
              ✏️ Edit Info Course
            </button>
          </div>
          <p style="margin-top:.375rem;color:var(--tertiary);">${escHtml(course.description || 'Atur alur pembelajaran, tambahkan materi, video, dan kuis evaluasi.')}</p>
        </div>
        <button class="btn btn-authoritative" onclick="openModalAddContent('${course.id}')">
          + Tambah Unit Konten
        </button>
      </div>

      <div style="background:var(--surface-card);border-radius:12px;border:1px solid var(--border);padding:1.5rem;">
        <h3 style="margin-bottom:1rem;font-size:1.125rem;">Urutan Alur Materi (${course.contents.length} Unit)</h3>
        ${unitsList || '<p style="color:var(--tertiary);text-align:center;padding:2rem;">Belum ada unit konten. Tambahkan unit pertama!</p>'}
      </div>
    `;
  }

  // 4. Student Management
  function renderStudentManagement(container) {
    const rows = AppState.students.map(s => `
      <tr>
        <td style="font-weight:600;color:var(--primary);">${escHtml(s.name)}</td>
        <td>${escHtml(s.email)}</td>
        <td><span class="badge badge-draft">${escHtml(s.class)}</span></td>
        <td><span class="badge badge-success">${escHtml(s.status)}</span></td>
        <td style="display:flex;gap:.375rem;">
          <button class="btn btn-outline btn-sm" onclick="openModalEnrollStudent('${s.id}','${escHtml(s.name)}')">Daftarkan ke Course</button>
          <button class="btn btn-ghost btn-sm" onclick="navigateTo('progress-report')">Lihat Nilai</button>
        </td>
      </tr>
    `).join('');

    container.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem;">
        <div>
          <h2>Daftar Peserta Didik</h2>
          <p>Kelola siswa dan daftarkan mereka ke course yang relevan.</p>
        </div>
        <button class="btn btn-authoritative" onclick="openModalAddStudent()">
          + Tambah Siswa Baru
        </button>
      </div>
      <div class="table-container">
        <table class="data-table">
          <thead><tr><th>Nama Siswa</th><th>Email</th><th>Rombel/Kelas</th><th>Status</th><th>Aksi</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:var(--tertiary);padding:2rem;">Belum ada siswa terdaftar.</td></tr>'}</tbody>
        </table>
      </div>
    `;
  }

  // 5. Student Dashboard (hanya tampilkan course yang di-enroll)
  async function renderStudentDashboard(container) {
    container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:50vh;"><div class="spinner"></div></div>`;

    const sb = typeof getSupabase === 'function' ? getSupabase() : null;
    let enrolledCourses = AppState.courses;

    if (sb && !AppState.isDemoMode && AppState.user?.id) {
      enrolledCourses = await loadEnrolledCourses(sb);
    }

    if (enrolledCourses.length === 0) {
      container.innerHTML = `
        <div style="text-align:center;padding:4rem 2rem;">
          <div style="font-size:3rem;margin-bottom:1rem;">📖</div>
          <h2>Belum Terdaftar di Course Manapun</h2>
          <p style="color:var(--tertiary);margin-top:.5rem;">Hubungi guru pengampu untuk mendaftarkan Anda ke course pembelajaran.</p>
        </div>
      `;
      return;
    }

    const coursesHtml = enrolledCourses.map(c => {
      const completedCount = c.contents.filter(u => u.completed).length;
      const total = c.contents.length;
      const pct = total > 0 ? Math.round((completedCount / total) * 100) : 0;
      return `
        <div class="card card-hover" style="display:flex;flex-direction:column;justify-content:space-between;">
          <div>
            <div style="height:90px;border-radius:8px;background:${c.coverGradient};margin-bottom:1rem;padding:1rem;color:#fff;display:flex;align-items:flex-end;">
              <span class="badge" style="background:rgba(255,255,255,0.3);color:#fff;">${pct === 100 ? '✅ Selesai' : '📖 Sedang Dipelajari'}</span>
            </div>
            <h3 style="font-size:1.125rem;margin-bottom:.5rem;">${escHtml(c.title)}</h3>
            <p style="font-size:.8125rem;margin-bottom:1rem;">Pengampu: ${escHtml(c.authorName)}</p>
            <div style="margin-bottom:1rem;">
              <div style="display:flex;justify-content:space-between;font-size:.75rem;margin-bottom:.375rem;">
                <span>Capaian Materi</span>
                <strong>${completedCount} dari ${total} Unit</strong>
              </div>
              <div class="progress-track">
                <div class="progress-fill" style="width:${pct}%;"></div>
              </div>
            </div>
          </div>
          <button class="btn btn-primary" style="width:100%;" onclick="navigateTo('course-player','${c.id}')">
            ${pct === 100 ? '✅ Lihat Kembali' : 'Lanjutkan Pembelajaran →'}
          </button>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div style="margin-bottom:1.5rem;">
        <h2>Selamat Datang, ${escHtml(AppState.user?.name?.split(' ')[0] || 'Siswa')}! 👋</h2>
        <p>Akses materi, tonton demonstrasi, dan kerjakan latihan interaktif.</p>
      </div>
      <div class="grid-courses">${coursesHtml}</div>
    `;
  }

  // 6. Course Player (Hierarchical Multi-Level Curriculum)
  function renderCoursePlayer(container, courseId) {
    const course = AppState.courses.find(c => c.id === courseId) || AppState.courses[0];
    if (!course) {
      container.innerHTML = '<div style="padding:3rem;text-align:center;"><p>Course tidak ditemukan.</p></div>';
      return;
    }
    AppState.activeCoursePlayer = course;
    if (AppState.activeUnitIndex >= course.contents.length) AppState.activeUnitIndex = 0;

    const currentUnit = course.contents[AppState.activeUnitIndex];
    if (!currentUnit) {
      container.innerHTML = '<div style="padding:3rem;text-align:center;"><p>Unit konten belum tersedia. <button class="btn btn-outline" onclick="navigateTo(\'course-editor\',\''+courseId+'\')">Tambah Konten ↗</button></p></div>';
      return;
    }

    const completedCount = course.contents.filter(u => u.completed).length;
    const progressPercent = course.contents.length > 0 ? Math.round((completedCount / course.contents.length) * 100) : 0;
    const isStudent = AppState.currentRole === 'student';

    // 1. Identifikasi & Pengelompokan Unit (Pre-Exam, Bab Accordion, Post-Course)
    let preExamIdx = course.contents.findIndex(u => (u.type || '').toLowerCase() === 'pre_exam' || u.title.toLowerCase().includes('pre-exam') || u.title.toLowerCase().includes('pretest'));
    
    const postCourseTypes = ['evaluasi', 'post_exam', 'tugas', 'refleksi', 'sertifikat'];
    const postCourseIndices = [];
    const chapters = {};
    const chapterOrder = [];

    course.contents.forEach((u, idx) => {
      if (idx === preExamIdx) return;
      const typeLower = (u.type || '').toLowerCase();
      if (postCourseTypes.includes(typeLower) && idx > course.contents.length / 2) {
        postCourseIndices.push(idx);
        return;
      }

      // Tentukan nama Bab pembungkus
      const chTitle = u.sectionName || (u.moduleId && course.modules?.find(m => m.id === u.moduleId)?.title) || 'Materi Pembelajaran';
      if (!chapters[chTitle]) {
        chapters[chTitle] = [];
        chapterOrder.push(chTitle);
      }
      chapters[chTitle].push({ unit: u, idx });
    });

    // Otomatis buka accordion untuk bab dari unit yang sedang aktif
    const curChTitle = currentUnit.sectionName || (currentUnit.moduleId && course.modules?.find(m => m.id === currentUnit.moduleId)?.title);
    if (curChTitle && AppState.expandedChapters[curChTitle] === undefined) {
      AppState.expandedChapters[curChTitle] = true;
    }
    if (chapterOrder.length > 0 && Object.keys(AppState.expandedChapters).length === 0) {
      AppState.expandedChapters[chapterOrder[0]] = true;
    }

    // 2. Render Sidebar: Pre-Exam Card
    let preExamHtml = '';
    if (preExamIdx !== -1) {
      const u = course.contents[preExamIdx];
      const isLocked = isUnitLocked(preExamIdx, course);
      const isActive = preExamIdx === AppState.activeUnitIndex;
      const statusIcon = u.completed ? '✓' : (isLocked ? '🔒' : '');
      const statusClass = u.completed ? 'completed' : (isLocked ? 'locked' : '');
      
      preExamHtml = `
        <div class="player-standalone-card ${isActive ? 'active' : ''} ${statusClass}"
             onclick="selectPlayerUnit(${preExamIdx})"
             title="${isLocked ? 'Terkunci. Selesaikan sesi sebelumnya.' : escHtml(u.title)}">
          <div class="player-status-circle ${statusClass}">
            ${statusIcon}
          </div>
          <div style="flex:1;">
            <div class="player-standalone-title">📑 Pre-Exam</div>
            <div class="player-standalone-subtext">${escHtml(u.duration || '15 Menit')}</div>
          </div>
        </div>
      `;
    }

    // 3. Render Sidebar: Accordion Bab (Chapters)
    const chaptersHtml = chapterOrder.map(chTitle => {
      const subItems = chapters[chTitle];
      const allCompleted = subItems.every(item => item.unit.completed);
      const firstLocked = isUnitLocked(subItems[0].idx, course);
      const isExpanded = AppState.expandedChapters[chTitle] !== false;
      const hasActive = subItems.some(item => item.idx === AppState.activeUnitIndex);

      let chStatusIcon = '';
      let chStatusClass = '';
      if (allCompleted) {
        chStatusIcon = '✓';
        chStatusClass = 'completed';
      } else if (firstLocked) {
        chStatusIcon = '🔒';
        chStatusClass = 'locked';
      }

      const subItemsHtml = subItems.map(({ unit: u, idx }) => {
        const isLocked = isUnitLocked(idx, course);
        const isActive = idx === AppState.activeUnitIndex;
        let icon = '⚙';
        const typeLower = (u.type || '').toLowerCase();
        if (typeLower === 'video') icon = '▶';
        else if (typeLower === 'kuis_popup' || typeLower === 'kuis' || u.title.toLowerCase().includes('kuis')) icon = '📋';

        const subStatusIcon = u.completed ? '✓' : (isLocked ? '🔒' : '');
        const subStatusClass = u.completed ? 'completed' : (isLocked ? 'locked' : '');

        return `
          <div class="player-subitem ${isActive ? 'active' : ''} ${isLocked ? 'locked' : ''}"
               onclick="selectPlayerUnit(${idx})"
               title="${isLocked ? 'Sesi ini terkunci' : escHtml(u.title)}">
            <div class="player-status-circle ${subStatusClass}" style="width:18px;height:18px;font-size:0.65rem;">
              ${subStatusIcon}
            </div>
            <div style="flex:1;min-width:0;">
              <div class="player-subitem-title">${icon} ${escHtml(u.title)}</div>
              <div class="player-subitem-meta">${escHtml(u.duration || '5 Menit')}</div>
            </div>
          </div>
        `;
      }).join('');

      return `
        <div class="player-chapter-card ${isExpanded ? 'expanded' : ''} ${hasActive ? 'chapter-active' : ''}">
          <div class="player-chapter-header" onclick="toggleChapterAccordion('${escHtml(chTitle)}')">
            <div class="player-status-circle ${chStatusClass}">
              ${chStatusIcon}
            </div>
            <div class="player-chapter-title">${escHtml(chTitle)}</div>
            <div class="player-chapter-chevron">▼</div>
          </div>
          <div class="player-chapter-body">
            ${subItemsHtml}
          </div>
        </div>
      `;
    }).join('');

    // 4. Render Sidebar: Post-Course Standalone Items
    const postCourseHtml = postCourseIndices.map(idx => {
      const u = course.contents[idx];
      const isLocked = isUnitLocked(idx, course);
      const isActive = idx === AppState.activeUnitIndex;
      const statusIcon = u.completed ? '✓' : (isLocked ? '🔒' : '');
      const statusClass = u.completed ? 'completed' : (isLocked ? 'locked' : '');
      
      let icon = '📑';
      let title = u.title;
      let subtext = u.duration || '';
      const typeLower = (u.type || '').toLowerCase();
      if (typeLower === 'evaluasi') icon = '📋';
      else if (typeLower === 'post_exam') icon = '📑';
      else if (typeLower === 'tugas') {
        icon = '✏️';
        subtext = `Status: ${u.completed ? 'Selesai' : 'Belum Selesai'}`;
      } else if (typeLower === 'refleksi') icon = '📓';
      else if (typeLower === 'sertifikat') icon = '📜';

      return `
        <div class="player-standalone-card ${isActive ? 'active' : ''} ${statusClass}"
             onclick="selectPlayerUnit(${idx})"
             title="${isLocked ? 'Terkunci. Selesaikan materi pembelajaran terlebih dahulu.' : escHtml(u.title)}">
          <div class="player-status-circle ${statusClass}">
            ${statusIcon}
          </div>
          <div style="flex:1;">
            <div class="player-standalone-title">${icon} ${escHtml(title)}</div>
            ${subtext ? `<div class="player-standalone-subtext">${escHtml(subtext)}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');

    // 5. Render Area Konten Utama (Kuis / Result Screen / Materi / Video / Tugas / Sertifikat)
    const isCompleted = currentUnit.completed;
    const typeLower = (currentUnit.type || '').toLowerCase();
    const isQuizUnit = ['pre_exam', 'kuis_popup', 'post_exam', 'kuis'].includes(typeLower) || (currentUnit.quizData && currentUnit.quizData.length > 0);

    let contentHtml = '';

    if (isQuizUnit) {
      const isReviewMode = AppState.quizReviewMode && AppState.quizReviewMode[currentUnit.id];
      const showResultScreen = (isCompleted || AppState.progressMap[currentUnit.id]) && !isReviewMode;

      if (showResultScreen) {
        // LAYAR HASIL SKOR (Persis Gambar 1)
        const progress = AppState.progressData[currentUnit.id] || {};
        const questions = getEffectiveQuizData(currentUnit);
        const correctCount = progress.correct_answers !== undefined ? progress.correct_answers : Math.round((progress.score || 70) / 100 * questions.length);
        const wrongCount = progress.wrong_answers !== undefined ? progress.wrong_answers : Math.max(0, questions.length - correctCount);
        const score = progress.score !== undefined ? progress.score : Math.round((correctCount / Math.max(1, questions.length)) * 100);
        const timeSecs = progress.time_spent_seconds || 647; // default 10:47
        const timeStr = formatSecondsToMMSS(timeSecs);
        const cleanTitle = currentUnit.title.replace(/^Pre-Exam:\s*/i, 'Pre-Exam ');

        let notes = progress.notes;
        if (!notes) {
          if (typeLower === 'pre_exam') {
            notes = score < (currentUnit.passingScore || 60)
              ? 'Nilai awal kamu di bawah rata-rata. Perhatikan materi kelas dengan baik untuk tingkatkan pemahaman kamu ya!'
              : 'Pemahaman awal Anda sudah baik. Pelajari modul kelas secara komprehensif untuk penguasaan mendalam.';
          } else {
            notes = score >= (currentUnit.passingScore || 70)
              ? 'Luar biasa! Kamu telah menguasai kompetensi pada unit ini dengan sangat baik. Pertahankan prestasimu!'
              : 'Nilai kamu masih di bawah batas kelulusan. Pelajari kembali materi dan gunakan tombol Kerjakan Ulang untuk meningkatkan nilai.';
          }
        }

        contentHtml = `
          <div class="exam-result-box">
            <div class="exam-illustration-badge">
              <div class="exam-thumbsup-circle">
                👍
                <span class="exam-thumbsup-check">✓</span>
              </div>
            </div>

            <h2 class="exam-result-title">Selamat! Kamu telah menyelesaikan ${escHtml(cleanTitle)} kelas ini</h2>

            <div class="exam-score-table-card">
              <div class="exam-score-columns">
                <div>
                  <div class="exam-stat-label">Benar</div>
                  <div class="exam-stat-value">${correctCount}</div>
                </div>
                <div>
                  <div class="exam-stat-label">Salah</div>
                  <div class="exam-stat-value">${wrongCount}</div>
                </div>
                <div>
                  <div class="exam-stat-label">Waktu</div>
                  <div class="exam-stat-value">${timeStr}</div>
                </div>
                <div>
                  <div class="exam-stat-label">Nilai</div>
                  <div class="exam-stat-value score-teal">${score}</div>
                </div>
              </div>
              
              <div class="exam-stat-divider"></div>
              
              <p class="exam-stat-notes">
                <strong>Catatan:</strong> ${escHtml(notes)}
              </p>
            </div>

            <div style="margin-top:1rem;display:flex;gap:.75rem;">
              <button class="btn btn-outline btn-sm" onclick="retakeQuiz(${AppState.activeUnitIndex})">
                🔄 Kerjakan Ulang
              </button>
            </div>
          </div>
        `;
      } else {
        // FORM PENGERJAAN KUIS / EXAM
        const questions = getEffectiveQuizData(currentUnit);
        if (!AppState.activeQuizStartTime) AppState.activeQuizStartTime = Date.now();
        const answers = AppState.activeQuizAnswers || {};

        const questionsHtml = questions.map((q, qIdx) => {
          const selectedOpt = answers[q.id];
          const optionsHtml = q.options.map((opt, optIdx) => `
            <div class="exam-option-card ${selectedOpt === optIdx ? 'selected' : ''}" 
                 onclick="selectQuizOption(${q.id}, ${optIdx})">
              <input type="radio" name="q_${q.id}" value="${optIdx}" ${selectedOpt === optIdx ? 'checked' : ''}>
              <span style="font-size:0.875rem;color:#334155;line-height:1.4;">${escHtml(opt)}</span>
            </div>
          `).join('');

          return `
            <div class="exam-question-item" id="quiz-q-${q.id}">
              <div class="exam-question-text"><strong>${qIdx + 1}.</strong> ${escHtml(q.question)}</div>
              <div>${optionsHtml}</div>
            </div>
          `;
        }).join('');

        contentHtml = `
          <div class="exam-container">
            <div class="exam-intro-card">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem;">
                <span class="badge badge-primary">${currentUnit.type === 'pre_exam' ? 'Pra-Pembelajaran' : 'Uji Pemahaman'}</span>
                <span style="font-size:0.8125rem;color:var(--tertiary);font-weight:600;">⏱️ Estimasi: ${escHtml(currentUnit.duration || '15 Menit')}</span>
              </div>
              <h3 style="margin-bottom:.5rem;">${escHtml(currentUnit.title)}</h3>
              <p style="color:var(--tertiary);font-size:0.875rem;line-height:1.5;">
                Pilihlah salah satu jawaban yang paling tepat untuk setiap pertanyaan di bawah ini.
              </p>
            </div>

            ${questionsHtml}

            <div style="text-align:center;margin-top:1.5rem;padding-bottom:2rem;">
              <button class="btn btn-primary" style="padding:0.75rem 2.5rem;font-size:1rem;" onclick="submitActiveQuiz(${AppState.activeUnitIndex})">
                🚀 Kumpulkan & Periksa Jawaban
              </button>
            </div>
          </div>
        `;
      }
    } else if (typeLower === 'tugas') {
      // UNJUK KETERAMPILAN
      contentHtml = `
        <div style="max-width:700px;margin:0 auto;line-height:1.7;">
          <div style="padding:1.5rem;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:1.5rem;">
            <h3>Instruksi Unjuk Keterampilan</h3>
            ${currentUnit.contentBody || '<p>Selesaikan tugas studi kasus praktis sesuai panduan yang tertera.</p>'}
          </div>
          <div style="border:2px dashed #cbd5e1;border-radius:12px;padding:2rem;text-align:center;background:#fff;margin-bottom:1.5rem;">
            <div style="font-size:2.5rem;margin-bottom:.5rem;">📁</div>
            <h4 style="margin-bottom:.5rem;">Unggah Lembar Kerja Praktik</h4>
            <p style="color:var(--tertiary);font-size:.8125rem;margin-bottom:1rem;">Format PDF, XLS, atau DOCX (Maksimal 10MB)</p>
            <button class="btn btn-outline" onclick="showToast('✅ Berkas studi kasus berhasil diunggah! Status: Selesai', 'success'); markUnitComplete('${currentUnit.id}', '${course.id}');">
              Pilih Berkas Tugas
            </button>
          </div>
        </div>
      `;
    } else if (typeLower === 'refleksi') {
      // REFLECTIVE JOURNAL
      contentHtml = `
        <div style="max-width:700px;margin:0 auto;line-height:1.7;">
          <div style="padding:1.5rem;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:1.5rem;">
            <h3>Jurnal Refleksi Pembelajaran</h3>
            <p>Tuliskan ringkasan wawasan baru dan bagaimana Anda akan mengaplikasikannya di dunia nyata.</p>
          </div>
          <div class="form-group">
            <textarea class="form-control" rows="6" placeholder="Tuliskan catatan refleksi Anda di sini..."></textarea>
          </div>
          <button class="btn btn-primary" onclick="showToast('✅ Refleksi berhasil disimpan!', 'success'); markUnitComplete('${currentUnit.id}', '${course.id}');">
            Simpan Refleksi
          </button>
        </div>
      `;
    } else if (typeLower === 'sertifikat') {
      // LIHAT SERTIFIKAT
      const studentName = AppState.user?.name || 'Peserta Didik';
      contentHtml = `
        <div style="max-width:680px;margin:0 auto;text-align:center;padding:1.5rem 0;">
          <div style="padding:2.5rem 2rem;border:3px double #14b8a6;border-radius:16px;background:#f0fdfa;box-shadow:var(--shadow-2);margin-bottom:1.5rem;">
            <div style="font-size:3rem;margin-bottom:1rem;">🎓</div>
            <h2 style="font-family:'Noto Serif',serif;font-size:1.75rem;color:#1e3a5f;margin-bottom:.5rem;">SERTIFIKAT KELULUSAN</h2>
            <p style="color:#0f766e;font-weight:600;margin-bottom:1.5rem;">Diberikan dengan bangga kepada:</p>
            <h3 style="font-size:1.5rem;color:#0f172a;text-decoration:underline;margin-bottom:1rem;">${escHtml(studentName)}</h3>
            <p style="color:#475569;font-size:0.9375rem;line-height:1.6;margin-bottom:1.5rem;">
              Telah berhasil menyelesaikan seluruh rangkaian materi, kuis berkala, dan evaluasi kelulusan pada pelatihan:
              <br><strong>${escHtml(course.title)}</strong>
            </p>
            <div style="display:inline-block;padding:0.35rem 1rem;background:#ffffff;border:1px solid #99f6e4;border-radius:20px;font-size:0.75rem;color:#0d9488;">
              ID Terverifikasi: CH-LMS-${Math.abs(course.id.split('-')[0].hashCode?.() || 892341)}
            </div>
          </div>
          <button class="btn btn-primary" onclick="exportPDF('${escHtml(studentName)}')">
            📄 Unduh Sertifikat (PDF)
          </button>
        </div>
      `;
    } else {
      // MATERI TEKS / VIDEO
      if (currentUnit.embedUrl) {
        const isDirectVideo = currentUnit.embedUrl.endsWith('.mp4') || currentUnit.embedUrl.endsWith('.webm') || currentUnit.embedUrl.includes('/storage/v1/object/public/') || currentUnit.type === 'Video';
        const isYoutube = currentUnit.embedUrl.includes('youtube') || currentUnit.embedUrl.includes('youtu.be');

        if (isDirectVideo && !isYoutube) {
          contentHtml = `
            <div class="video-player-container">
              <div class="video-lock-badge">🔒 Kecepatan Terkunci (1.0x Normal)</div>
              <video id="lms-custom-video" controls controlsList="nodownload noplaybackrate" disablePictureInPicture src="${currentUnit.embedUrl}">
                Browser Anda tidak mendukung tag video HTML5.
              </video>
            </div>
            ${currentUnit.contentBody ? `<div style="line-height:1.8;font-size:1rem;">${currentUnit.contentBody}</div>` : ''}
          `;
        } else if (isYoutube) {
          const embedSrc = currentUnit.embedUrl.replace('watch?v=', 'embed/').replace('youtu.be/', 'www.youtube-nocookie.com/embed/');
          contentHtml = `
            <div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:12px;margin-bottom:1.5rem;background:#000;">
              <iframe src="${embedSrc}" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" allowfullscreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe>
            </div>
            ${currentUnit.contentBody ? `<div style="line-height:1.8;font-size:1rem;">${currentUnit.contentBody}</div>` : ''}
          `;
        }
      } else {
        contentHtml = `<div style="line-height:1.8;font-size:1rem;">${currentUnit.contentBody || '<p style="color:var(--tertiary);">Konten belum tersedia.</p>'}</div>`;
      }
    }

    // Timer badge untuk materi teks / video
    let timerWidgetHtml = '';
    const isVideoUnit = typeLower === 'video' || (currentUnit.embedUrl && (currentUnit.embedUrl.endsWith('.mp4') || currentUnit.embedUrl.includes('/storage/v1/object/public/')));
    const parseDurationSeconds = (durStr) => {
      if (!durStr) return 60;
      const match = durStr.match(/\d+/);
      const val = match ? parseInt(match[0], 10) : 5;
      return Math.max(30, val * 60);
    };
    const targetSeconds = parseDurationSeconds(currentUnit.duration);

    if (isStudent && !isCompleted && !isQuizUnit) {
      if (isVideoUnit) {
        timerWidgetHtml = `
          <div class="study-timer-badge" id="study-timer-display" title="Tonton video hingga selesai untuk membuka sesi berikutnya">
            <span>📺</span>
            <span id="study-timer-text">Tonton hingga selesai</span>
          </div>
        `;
      } else {
        timerWidgetHtml = `
          <div class="study-timer-badge" id="study-timer-display" title="Mempelajari materi ini untuk membuka sesi berikutnya">
            <span>⏱️</span>
            <div class="study-timer-bar"><div class="study-timer-fill" id="study-timer-progress" style="width:0%;"></div></div>
            <span id="study-timer-text">Menghitung...</span>
          </div>
        `;
      }
    } else if (isCompleted && !isQuizUnit) {
      timerWidgetHtml = `
        <div class="study-timer-badge completed">
          <span>✓</span>
          <span>Selesai Dipelajari</span>
        </div>
      `;
    }

    // 6. RENDER KESELURUHAN PLAYER KE DOM
    container.innerHTML = `
      <div class="player-container">
        <!-- Sidebar Konten Kelas (Hierarki Berjenjang) -->
        <div class="player-sidebar">
          <div class="player-sidebar-header">
            <div class="player-sidebar-header-top">
              <h3 class="player-sidebar-title">Konten Kelas</h3>
              <span class="player-online-badge">🎥 ${course.contents.length} Konten online</span>
            </div>
            <div class="progress-wrapper">
              <div class="progress-track">
                <div class="progress-fill" style="width:${progressPercent}%;"></div>
              </div>
              <span class="progress-text">${progressPercent}%</span>
            </div>
          </div>
          <div class="player-sidebar-list">
            ${preExamHtml}
            ${chaptersHtml}
            ${postCourseHtml}
          </div>
        </div>

        <!-- Area Konten & Layar Ujian -->
        <div class="player-content-area">
          <div class="player-content-header">
            <div style="display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;">
              <span class="badge badge-${(currentUnit.type || 'materi').toLowerCase()}">${currentUnit.type}</span>
              <h2 style="font-size:1.2rem;margin:0;">${escHtml(currentUnit.title)}</h2>
              ${timerWidgetHtml}
            </div>
            <button class="btn btn-outline btn-sm" onclick="toggleIFPMode()" id="ifp-toggle-btn" title="Mode Layar Penuh IFP">
              🖥️ Mode IFP
            </button>
          </div>

          <div class="player-content-body" id="player-body">
            ${contentHtml}
          </div>

          <!-- Footer Bersih (Persis Gambar 1: Tombol Selanjutnya) -->
          <div class="player-content-footer-clean">
            <div style="display:flex;align-items:center;justify-content:space-between;width:100%;">
              <button class="btn btn-outline btn-sm" onclick="prevPlayerUnit()" ${AppState.activeUnitIndex === 0 ? 'disabled style="opacity:.4;"' : ''}>
                ← Sebelumnya
              </button>
              <button class="btn-next-action" onclick="onNextButtonClicked()" id="btn-player-next" 
                      ${isStudent && isUnitLocked(AppState.activeUnitIndex + 1, course) && !currentUnit.completed ? 'disabled' : ''}>
                Selanjutnya
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    // Pasang listener penguncian video dan timer belajar otomatis jika bukan kuis
    if (!isQuizUnit) {
      initUnitInteractions(currentUnit, course, targetSeconds, isVideoUnit);
    }
  }

  // 7. Progress Report (data dari Supabase)
  async function renderProgressReport(container) {
    container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:50vh;"><div class="spinner"></div></div>`;

    const sb = typeof getSupabase === 'function' ? getSupabase() : null;

    if (!sb || AppState.isDemoMode) {
      // Demo mode: tampilkan berdasarkan data lokal
      renderProgressReportStatic(container);
      return;
    }

    try {
      if (AppState.currentRole === 'student') {
        // Laporan personal siswa
        const studentId = AppState.user?.id;
        const { data: progressData } = await sb
          .from('progress')
          .select('content_id, course_id, score, completed_at, content:course_contents(title, type), course:courses(title)')
          .eq('student_id', studentId)
          .order('completed_at', { ascending: false });

        const rows = (progressData || []).map(p => `
          <tr>
            <td style="color:var(--primary);font-weight:600;">${escHtml(p.course?.title || '-')}</td>
            <td>${escHtml(p.content?.title || '-')}</td>
            <td><span class="badge badge-${(p.content?.type||'materi').toLowerCase()}">${p.content?.type || '-'}</span></td>
            <td><span class="badge badge-success">✅ Selesai</span></td>
            <td>${new Date(p.completed_at).toLocaleDateString('id-ID')}</td>
          </tr>
        `).join('');

        container.innerHTML = `
          <div style="margin-bottom:1.5rem;">
            <h2>Capaian Belajar Saya</h2>
            <p>Riwayat unit materi yang telah diselesaikan.</p>
          </div>
          <div class="table-container">
            <table class="data-table">
              <thead><tr><th>Course</th><th>Unit Materi</th><th>Jenis</th><th>Status</th><th>Diselesaikan</th></tr></thead>
              <tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:var(--tertiary);padding:2rem;">Belum ada unit yang diselesaikan.</td></tr>'}</tbody>
            </table>
          </div>
        `;
      } else {
        // Admin/Educator: laporan semua siswa
        const { data: progressData } = await sb
          .from('progress')
          .select(`
            student_id, content_id, course_id, completed_at,
            student:profiles!progress_student_id_fkey(name, class_name),
            course:courses!progress_course_id_fkey(title)
          `);

        // Agregasi: hitung progress per siswa per course
        const byStudentCourse = {};
        (progressData || []).forEach(p => {
          const key = `${p.student_id}::${p.course_id}`;
          if (!byStudentCourse[key]) {
            byStudentCourse[key] = {
              studentName: p.student?.name || '-',
              className: p.student?.class_name || '-',
              courseTitle: p.course?.title || '-',
              courseId: p.course_id,
              studentId: p.student_id,
              count: 0
            };
          }
          byStudentCourse[key].count++;
        });

        const rows = Object.values(byStudentCourse).map(row => {
          const course = AppState.courses.find(c => c.id === row.courseId);
          const total = course ? course.contents.length : '?';
          const pct = total > 0 ? Math.round((row.count / total) * 100) : 0;
          return `
            <tr>
              <td style="font-weight:600;color:var(--primary);">${escHtml(row.studentName)}</td>
              <td><span class="badge badge-draft">${escHtml(row.className)}</span></td>
              <td>${escHtml(row.courseTitle)}</td>
              <td>${row.count} / ${total} Unit</td>
              <td style="width:180px;">
                <div class="progress-wrapper">
                  <div class="progress-track"><div class="progress-fill" style="width:${pct}%;"></div></div>
                  <span class="progress-text">${pct}%</span>
                </div>
              </td>
              <td>
                <button class="btn btn-outline btn-sm" onclick="exportPDF('${escHtml(row.studentName)}')">📄 PDF</button>
              </td>
            </tr>
          `;
        }).join('');

        container.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem;">
            <div>
              <h2>Laporan Capaian Belajar</h2>
              <p>Rekap progress nyata dari Supabase — ${Object.keys(byStudentCourse).length} entri progress.</p>
            </div>
            <button class="btn btn-primary" onclick="exportBatchPDF()">📄 Ekspor PDF Semua</button>
          </div>
          <div class="table-container">
            <table class="data-table">
              <thead><tr><th>Nama Siswa</th><th>Rombel</th><th>Course</th><th>Unit Selesai</th><th>Persentase</th><th>Ekspor</th></tr></thead>
              <tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:var(--tertiary);padding:2rem;">Belum ada data progress siswa.</td></tr>'}</tbody>
            </table>
          </div>
        `;
      }
    } catch (err) {
      console.error('Gagal load progress:', err);
      renderProgressReportStatic(container);
    }
  }

  function renderProgressReportStatic(container) {
    container.innerHTML = `
      <div style="text-align:center;padding:3rem;">
        <div style="font-size:2rem;margin-bottom:1rem;">📊</div>
        <h3>Data Laporan</h3>
        <p style="color:var(--tertiary);">Koneksi ke Supabase diperlukan untuk melihat data progress nyata.</p>
      </div>
    `;
  }

  /* =========================================================
   * PLAYER FUNCTIONS & HIERARCHICAL INTERACTION
   * ========================================================= */
  function formatSecondsToMMSS(seconds) {
    const s = Math.max(0, parseInt(seconds || 0, 10));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${rem < 10 ? '0' : ''}${rem}`;
  }

  function isUnitLocked(idx, course) {
    if (!course || !course.contents) return false;
    // Pendidik dan admin bebas akses
    if (AppState.currentRole !== 'student') return false;
    // Unit pertama (Pre-Exam) selalu terbuka
    if (idx <= 0) return false;
    // Terkunci jika unit sebelumnya belum berstatus selesai
    return !course.contents[idx - 1].completed;
  }

  function toggleChapterAccordion(chTitle) {
    AppState.expandedChapters[chTitle] = !AppState.expandedChapters[chTitle];
    renderCoursePlayer(document.getElementById('view-container'), AppState.activeCoursePlayer.id);
  }

  function selectQuizOption(qId, optIdx) {
    if (!AppState.activeQuizAnswers) AppState.activeQuizAnswers = {};
    AppState.activeQuizAnswers[qId] = optIdx;

    const qEl = document.getElementById(`quiz-q-${qId}`);
    if (qEl) {
      qEl.querySelectorAll('.exam-option-card').forEach((card, idx) => {
        card.classList.toggle('selected', idx === optIdx);
        const radio = card.querySelector('input[type="radio"]');
        if (radio) radio.checked = (idx === optIdx);
      });
    }
  }

  function getEffectiveQuizData(unit) {
    if (unit.quizData && Array.isArray(unit.quizData) && unit.quizData.length > 0) {
      return unit.quizData;
    }
    // Fallback default questions jika kuis belum diisi
    return [
      {
        id: 1,
        question: `Konsep utama yang dipelajari pada sesi "${unit.title}" berfokus pada...`,
        options: [
          'Prinsip keteraturan, akurasi, dan konsistensi sistematis',
          'Pencatatan spekulatif tanpa bukti transaksi',
          'Pengabaian standar akuntansi yang berlaku',
          'Penundaan pelaporan periode berjalan'
        ],
        answerIndex: 0,
        explanation: 'Prinsip keteraturan dan konsistensi adalah fondasi utama materi ini.'
      },
      {
        id: 2,
        question: 'Tindakan yang paling tepat sesuai kaidah profesional adalah...',
        options: [
          'Memvalidasi data sebelum melakukan rekonsiliasi akhir',
          'Mengubah saldo tanpa otorisasi penanggung jawab',
          'Menghilangkan bukti transaksi lama',
          'Membuat estimasi tanpa dasar perhitungan yang sah'
        ],
        answerIndex: 0,
        explanation: 'Validasi data sebelum rekonsiliasi merupakan prosedur standar.'
      },
      {
        id: 3,
        question: 'Tujuan utama evaluasi berkala pada akhir modul adalah...',
        options: [
          'Memastikan penguasaan kompetensi dan peningkatan pemahaman',
          'Menambah beban administratif peserta didik',
          'Menghentikan proses belajar secara sepihak',
          'Menyederhanakan materi tanpa penilaian terukur'
        ],
        answerIndex: 0,
        explanation: 'Evaluasi berkala menjamin pencapaian target kompetensi peserta.'
      }
    ];
  }

  async function submitActiveQuiz(unitIdx) {
    const course = AppState.activeCoursePlayer;
    if (!course) return;
    const unit = course.contents[unitIdx];
    const questions = getEffectiveQuizData(unit);
    const answers = AppState.activeQuizAnswers || {};

    const unanswered = questions.filter(q => answers[q.id] === undefined);
    if (unanswered.length > 0) {
      showToast(`⚠️ Harap jawab seluruh pertanyaan (${questions.length - unanswered.length}/${questions.length} terjawab).`, 'warning');
      return;
    }

    let correct = 0;
    questions.forEach(q => {
      if (answers[q.id] === q.answerIndex) correct++;
    });
    const wrong = questions.length - correct;
    const score = Math.round((correct / questions.length) * 100);
    const passingScore = unit.passingScore || 60;

    const now = Date.now();
    const start = AppState.activeQuizStartTime || (now - (correct * 90 + wrong * 50) * 1000);
    const elapsedSecs = Math.max(45, Math.round((now - start) / 1000));

    const isPreExam = (unit.type || '').toLowerCase() === 'pre_exam' || unit.title.toLowerCase().includes('pre-exam');
    let notes = '';
    if (isPreExam) {
      notes = score < passingScore
        ? 'Nilai awal kamu di bawah rata-rata. Perhatikan materi kelas dengan baik untuk tingkatkan pemahaman kamu ya!'
        : 'Pemahaman awal Anda sudah baik. Pelajari modul kelas secara komprehensif untuk penguasaan mendalam.';
    } else {
      notes = score >= passingScore
        ? 'Luar biasa! Kamu telah menguasai kompetensi pada unit ini dengan sangat baik. Pertahankan prestasimu!'
        : 'Nilai kamu masih di bawah batas kelulusan. Pelajari kembali materi dan gunakan tombol Kerjakan Ulang untuk meningkatkan nilai.';
    }

    const progressItem = {
      score,
      correct_answers: correct,
      wrong_answers: wrong,
      time_spent_seconds: elapsedSecs,
      notes
    };
    if (!AppState.progressData) AppState.progressData = {};
    AppState.progressData[unit.id] = progressItem;
    AppState.progressMap[unit.id] = true;
    unit.completed = true;

    if (!AppState.quizReviewMode) AppState.quizReviewMode = {};
    AppState.quizReviewMode[unit.id] = false;

    try {
      await dbSubmitQuizResult({
        contentId: unit.id,
        courseId: course.id,
        score,
        correctAnswers: correct,
        wrongAnswers: wrong,
        timeSpentSeconds: elapsedSecs,
        notes
      });
      showToast('🎉 Ujian selesai & nilai tersimpan!', 'success');
    } catch (err) {
      console.warn('Simpan kuis lokal:', err);
    }

    renderCoursePlayer(document.getElementById('view-container'), course.id);
  }

  function retakeQuiz(unitIdx) {
    const course = AppState.activeCoursePlayer;
    if (!course) return;
    const unit = course.contents[unitIdx];
    if (!AppState.quizReviewMode) AppState.quizReviewMode = {};
    AppState.quizReviewMode[unit.id] = true;
    AppState.activeQuizAnswers = {};
    AppState.activeQuizStartTime = Date.now();
    renderCoursePlayer(document.getElementById('view-container'), course.id);
  }

  async function onNextButtonClicked() {
    const course = AppState.activeCoursePlayer;
    if (!course) return;
    const currentUnit = course.contents[AppState.activeUnitIndex];
    if (!currentUnit) return;

    const isQuiz = ['pre_exam', 'kuis_popup', 'post_exam', 'kuis'].includes((currentUnit.type || '').toLowerCase());
    if (!currentUnit.completed && !isQuiz) {
      await markUnitComplete(currentUnit.id, course.id);
    }

    if (!currentUnit.completed && isQuiz) {
      showToast('⚠️ Harap kumpulkan jawaban kuis/ujian terlebih dahulu sebelum melanjutkan.', 'warning');
      return;
    }

    nextPlayerUnit();
  }

  function selectPlayerUnit(idx) {
    const course = AppState.activeCoursePlayer;
    if (isUnitLocked(idx, course)) {
      const prevTitle = course.contents[idx - 1]?.title || 'sesi sebelumnya';
      showToast(`🔒 Sesi ini terkunci! Selesaikan "${prevTitle}" terlebih dahulu.`, 'warning');
      return;
    }
    AppState.activeUnitIndex = idx;
    const currentUnit = course.contents[idx];
    const chName = currentUnit?.sectionName || (currentUnit?.moduleId && course.modules?.find(m => m.id === currentUnit.moduleId)?.title);
    if (chName) AppState.expandedChapters[chName] = true;

    renderCoursePlayer(document.getElementById('view-container'), AppState.activeCoursePlayer.id);
  }

  function nextPlayerUnit() {
    const course = AppState.activeCoursePlayer;
    if (!course) return;
    const nextIdx = AppState.activeUnitIndex + 1;
    if (nextIdx < course.contents.length) {
      if (isUnitLocked(nextIdx, course)) {
        showToast('🔒 Selesaikan sesi saat ini terlebih dahulu untuk melanjutkan.', 'warning');
        return;
      }
      AppState.activeUnitIndex = nextIdx;
      const nextUnit = course.contents[nextIdx];
      const chName = nextUnit?.sectionName || (nextUnit?.moduleId && course.modules?.find(m => m.id === nextUnit.moduleId)?.title);
      if (chName) AppState.expandedChapters[chName] = true;
      renderCoursePlayer(document.getElementById('view-container'), course.id);
    }
  }

  function prevPlayerUnit() {
    if (AppState.activeUnitIndex > 0) {
      AppState.activeUnitIndex--;
      const prevUnit = AppState.activeCoursePlayer?.contents[AppState.activeUnitIndex];
      const chName = prevUnit?.sectionName || (prevUnit?.moduleId && AppState.activeCoursePlayer?.modules?.find(m => m.id === prevUnit.moduleId)?.title);
      if (chName) AppState.expandedChapters[chName] = true;
      renderCoursePlayer(document.getElementById('view-container'), AppState.activeCoursePlayer.id);
    }
  }

  // Pengatur Timer Belajar dan Penguncian Video
  let activeStudyInterval = null;

  function clearActiveStudyTimer() {
    if (activeStudyInterval) {
      clearInterval(activeStudyInterval);
      activeStudyInterval = null;
    }
  }

  function initUnitInteractions(currentUnit, course, targetSeconds, isVideoUnit) {
    clearActiveStudyTimer();

    // Jika bukan siswa atau unit sudah selesai, tidak perlu menghitung / mengunci
    if (AppState.currentRole !== 'student' || currentUnit.completed) return;

    const videoEl = document.getElementById('lms-custom-video');

    // 1. Penguncian Video Player (Opsi 1: Direct HTML5 / Supabase Video)
    if (videoEl) {
      let maxWatchedTime = 0;

      // Kunci kecepatan video permanen ke 1.0x (Normal)
      videoEl.playbackRate = 1.0;
      videoEl.addEventListener('ratechange', () => {
        if (videoEl.playbackRate !== 1.0) {
          videoEl.playbackRate = 1.0;
          showToast('🔒 Kecepatan video dikunci pada 1.0x normal.', 'warning');
        }
      });

      // Cegah percepat / lompat maju (Anti-Skip Forward)
      videoEl.addEventListener('timeupdate', () => {
        if (videoEl.currentTime > maxWatchedTime + 2.5) {
          // Lompat ke depan terdeteksi
          videoEl.currentTime = maxWatchedTime;
          showToast('🔒 Anda tidak dapat melompati bagian video yang belum ditonton.', 'warning');
        } else {
          maxWatchedTime = Math.max(maxWatchedTime, videoEl.currentTime);
        }

        // Tampilkan waktu tonton di badge
        const timerText = document.getElementById('study-timer-text');
        if (timerText && videoEl.duration) {
          const curM = Math.floor(videoEl.currentTime / 60);
          const curS = Math.floor(videoEl.currentTime % 60);
          const durM = Math.floor(videoEl.duration / 60);
          const durS = Math.floor(videoEl.duration % 60);
          timerText.textContent = `${curM}:${curS < 10 ? '0' : ''}${curS} / ${durM}:${durS < 10 ? '0' : ''}${durS}`;
        }
      });

      // Video selesai ditonton sampai tamat -> Otomatis Selesai!
      videoEl.addEventListener('ended', () => {
        showToast('🎉 Selamat! Anda telah menyelesaikan sesi video pembelajaran ini.', 'success');
        markUnitComplete(currentUnit.id, course.id);
      });

      return;
    }

    // 2. Timer Belajar Otomatis untuk Materi Teks / Kaidah / Latihan
    let elapsedSeconds = 0;
    const timerText = document.getElementById('study-timer-text');
    const timerBar = document.getElementById('study-timer-progress');
    const timerBadge = document.getElementById('study-timer-display');

    const updateTimerDisplay = () => {
      const remaining = Math.max(0, targetSeconds - elapsedSeconds);
      const remM = Math.floor(remaining / 60);
      const remS = remaining % 60;
      const percent = Math.min(100, Math.round((elapsedSeconds / targetSeconds) * 100));

      if (timerText) {
        timerText.textContent = `${remM}:${remS < 10 ? '0' : ''}${remS}`;
      }
      if (timerBar) {
        timerBar.style.width = `${percent}%`;
      }
    };

    updateTimerDisplay();

    activeStudyInterval = setInterval(() => {
      // Hanya menghitung jika tab browser sedang aktif dibuka oleh siswa
      if (document.hidden) {
        if (timerBadge && !timerBadge.classList.contains('paused')) {
          timerBadge.classList.add('paused');
          if (timerText) timerText.textContent = 'Jeda (Tab Tidak Aktif)';
        }
        return;
      }

      if (timerBadge && timerBadge.classList.contains('paused')) {
        timerBadge.classList.remove('paused');
      }

      elapsedSeconds++;
      updateTimerDisplay();

      // Waktu belajar minimum tercapai -> Otomatis Tandai Selesai!
      if (elapsedSeconds >= targetSeconds) {
        clearActiveStudyTimer();
        showToast('🎉 Waktu belajar sesi ini telah terpenuhi! Sesi berikutnya telah terbuka.', 'success');
        markUnitComplete(currentUnit.id, course.id);
      }
    }, 1000);
  }

  async function markUnitComplete(contentId, courseId) {
    clearActiveStudyTimer();

    // Update lokal terlebih dahulu
    const course = AppState.activeCoursePlayer;
    const unit = course.contents.find(u => u.id === contentId) || course.contents[AppState.activeUnitIndex];
    if (unit) unit.completed = true;
    AppState.progressMap[contentId] = true;

    // Simpan ke Supabase
    try {
      await dbMarkContentComplete(contentId, courseId);
      showToast('✅ Capaian sesi berhasil disimpan!', 'success');
    } catch (err) {
      console.error('Gagal simpan progress:', err);
    }

    renderCoursePlayer(document.getElementById('view-container'), course.id);
  }

  async function toggleIFPMode() {
    const isCurrentlyIFP = document.body.classList.contains('ifp-mode');

    if (!isCurrentlyIFP) {
      // Masuk Mode IFP
      document.body.classList.add('ifp-mode');
      const btn = document.getElementById('ifp-toggle-btn');
      if (btn) btn.innerHTML = '🗗 Keluar Mode IFP';

      // Request browser fullscreen jika diizinkan
      try {
        if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
        }
      } catch (err) {
        console.log('Fullscreen request was blocked or not allowed:', err);
      }

      showToast('🖥️ Mode Layar Penuh IFP Aktif (Sidebar disembunyikan untuk layar sentuh)', 'success');
    } else {
      // Keluar dari Mode IFP
      document.body.classList.remove('ifp-mode');
      const btn = document.getElementById('ifp-toggle-btn');
      if (btn) btn.innerHTML = '🖥️ Mode IFP (Layar Penuh)';

      // Exit fullscreen jika sedang fullscreen
      try {
        if (document.fullscreenElement && document.exitFullscreen) {
          await document.exitFullscreen();
        }
      } catch (err) {
        console.log('Exit fullscreen error:', err);
      }

      showToast('Tampilan kembali ke mode standar', 'info');
    }
  }

  // Listener tombol keyboard ESC atau exit fullscreen bawaan browser
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && document.body.classList.contains('ifp-mode')) {
      // Jika user menekan ESC pada keyboard, sinkronkan class dan teks tombol
      document.body.classList.remove('ifp-mode');
      const btn = document.getElementById('ifp-toggle-btn');
      if (btn) btn.innerHTML = '🖥️ Mode IFP (Layar Penuh)';
    }
  });

  /* =========================================================
   * MODAL HANDLERS
   * ========================================================= */

  // --- Create/Edit Course ---
  function openModalCreateCourse(authorId, authorName) {
    const eduOptions = AppState.educators.map(e =>
      `<option value="${e.id}" data-name="${escHtml(e.name)}" ${authorId === e.id ? 'selected' : ''}>${escHtml(e.name)} (${escHtml(e.subject)})</option>`
    ).join('');

    document.getElementById('modal-title').textContent = 'Buat Tema / Course Baru';
    document.getElementById('modal-content').innerHTML = `
      <form id="form-create-course" onsubmit="handleCreateCourse(event)">
        <div class="form-group">
          <label class="form-label">Judul Course</label>
          <input type="text" id="course-title" class="form-control" placeholder="Contoh: Termodinamika & Hukum Gas Ideal" required>
        </div>
        ${AppState.currentRole === 'admin' ? `
        <div class="form-group">
          <label class="form-label">Tugaskan ke Pendidik</label>
          <select id="course-educator-select" class="form-control">
            ${eduOptions}
          </select>
        </div>` : ''}
        <div class="form-group">
          <label class="form-label">Deskripsi Pembelajaran</label>
          <textarea id="course-desc" class="form-control" rows="3" placeholder="Ringkasan kompetensi dan tujuan pembelajaran..." required></textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Warna Sampul</label>
          <select id="course-gradient" class="form-control">
            <option value="linear-gradient(135deg, #1e3a5f 0%, #14b8a6 100%)">🔵 Biru Teal (Default)</option>
            <option value="linear-gradient(135deg, #0f766e 0%, #2a3a4f 100%)">🟢 Hijau Gelap</option>
            <option value="linear-gradient(135deg, #6b21a8 0%, #1e3a5f 100%)">🟣 Ungu</option>
            <option value="linear-gradient(135deg, #b45309 0%, #1e3a5f 100%)">🟠 Amber</option>
            <option value="linear-gradient(135deg, #be123c 0%, #1e3a5f 100%)">🔴 Merah</option>
          </select>
        </div>
      </form>
    `;
    document.getElementById('modal-action-btn').textContent = 'Simpan Course';
    document.getElementById('modal-action-btn').onclick = () => document.getElementById('form-create-course').requestSubmit();
    document.getElementById('global-modal').classList.add('active');
  }

  async function handleCreateCourse(e) {
    e.preventDefault();
    const title = document.getElementById('course-title').value.trim();
    const desc = document.getElementById('course-desc').value.trim();
    const gradient = document.getElementById('course-gradient')?.value || 'linear-gradient(135deg, #1e3a5f 0%, #14b8a6 100%)';
    const eduSelect = document.getElementById('course-educator-select');

    let authorId = AppState.user?.id || null;
    let authorName = AppState.user?.name || 'Pendidik';

    if (eduSelect) {
      authorId = eduSelect.value;
      const selectedOpt = eduSelect.options[eduSelect.selectedIndex];
      authorName = selectedOpt?.dataset?.name || selectedOpt?.text?.split(' (')[0] || authorName;
    }

    setModalLoading(true, 'Menyimpan...');

    try {
      const sb = getSupabase();
      if (sb && !AppState.isDemoMode) {
        const { data, error } = await sb.from('courses').insert([{
          title, description: desc,
          author_name: authorName,
          author_id: authorId,
          status: 'Aktif',
          cover_gradient: gradient
        }]).select().single();
        if (error) throw error;

        AppState.courses.unshift({
          id: data.id, title, description: desc,
          authorId, authorName, status: 'Aktif',
          createdAt: new Date().toISOString().split('T')[0],
          coverGradient: gradient, enrolledStudents: 0, contents: []
        });
        showToast(`✅ Course "${title}" berhasil disimpan ke Supabase!`, 'success');
      } else {
        // Demo mode: tambah lokal
        AppState.courses.unshift({
          id: 'DEMO-' + Date.now(), title, description: desc,
          authorId, authorName, status: 'Aktif',
          createdAt: new Date().toISOString().split('T')[0],
          coverGradient: gradient, enrolledStudents: 0, contents: []
        });
        showToast(`✅ Course "${title}" ditambahkan (mode demo).`, 'success');
      }

      closeModal();
      if (AppState.currentRole === 'admin') renderAdminDashboard(document.getElementById('view-container'));
      else navigateTo('educator-dashboard');
    } catch (err) {
      showToast('❌ Gagal menyimpan course: ' + err.message, 'error');
    } finally {
      setModalLoading(false, 'Simpan Course');
    }
  }

  function openModalEditCourse(courseId) {
    const course = AppState.courses.find(c => c.id === courseId);
    if (!course) {
      showToast('Course tidak ditemukan.', 'error');
      return;
    }

    const gradientOptions = [
      { val: 'linear-gradient(135deg, #1e3a5f 0%, #14b8a6 100%)', label: '🔵 Biru Teal (Default)' },
      { val: 'linear-gradient(135deg, #0f766e 0%, #2a3a4f 100%)', label: '🟢 Hijau Gelap' },
      { val: 'linear-gradient(135deg, #6b21a8 0%, #1e3a5f 100%)', label: '🟣 Ungu' },
      { val: 'linear-gradient(135deg, #b45309 0%, #1e3a5f 100%)', label: '🟠 Amber' },
      { val: 'linear-gradient(135deg, #be123c 0%, #1e3a5f 100%)', label: '🔴 Merah' }
    ].map(g => `<option value="${g.val}" ${course.coverGradient === g.val ? 'selected' : ''}>${g.label}</option>`).join('');

    document.getElementById('modal-title').textContent = 'Edit Informasi Course';
    document.getElementById('modal-content').innerHTML = `
      <form id="form-edit-course" onsubmit="handleEditCourse(event, '${course.id}')">
        <div class="form-group">
          <label class="form-label">Judul Course</label>
          <input type="text" id="edit-course-title" class="form-control" value="${escHtml(course.title)}" required>
        </div>
        <div class="form-group">
          <label class="form-label">Deskripsi Pembelajaran</label>
          <textarea id="edit-course-desc" class="form-control" rows="3" required>${escHtml(course.description || '')}</textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Warna Sampul</label>
          <select id="edit-course-gradient" class="form-control">
            ${gradientOptions}
          </select>
        </div>
      </form>
    `;
    document.getElementById('modal-action-btn').textContent = 'Simpan Perubahan';
    document.getElementById('modal-action-btn').onclick = () => document.getElementById('form-edit-course').requestSubmit();
    document.getElementById('global-modal').classList.add('active');
  }

  async function handleEditCourse(e, courseId) {
    e.preventDefault();
    const title = document.getElementById('edit-course-title').value.trim();
    const desc = document.getElementById('edit-course-desc').value.trim();
    const gradient = document.getElementById('edit-course-gradient')?.value || 'linear-gradient(135deg, #1e3a5f 0%, #14b8a6 100%)';

    const course = AppState.courses.find(c => c.id === courseId);
    if (!course) return;

    setModalLoading(true, 'Menyimpan...');

    try {
      const sb = getSupabase();
      if (sb && !AppState.isDemoMode) {
        await dbUpdateCourse(courseId, { title, description: desc, coverGradient: gradient });
      }

      // Update state lokal
      course.title = title;
      course.description = desc;
      course.coverGradient = gradient;

      showToast(`✅ Course "${title}" berhasil diperbarui!`, 'success');
      closeModal();

      // Refresh view aktif
      const container = document.getElementById('view-container');
      if (AppState.currentView === 'course-editor') {
        renderCourseEditor(container, courseId);
      } else if (AppState.currentRole === 'admin') {
        renderAdminDashboard(container);
      } else {
        renderEducatorDashboard(container);
      }
    } catch (err) {
      showToast('❌ Gagal memperbarui course: ' + err.message, 'error');
    } finally {
      setModalLoading(false, 'Simpan Perubahan');
    }
  }

  // --- Add/Edit Content ---
  function openModalAddContent(courseId) {
    document.getElementById('modal-title').textContent = 'Tambah Unit Konten Pembelajaran';
    document.getElementById('modal-content').innerHTML = buildContentForm(courseId);
    document.getElementById('modal-action-btn').textContent = 'Tambahkan Unit';
    document.getElementById('modal-action-btn').onclick = () => document.getElementById('form-add-unit').requestSubmit();
    document.getElementById('global-modal').classList.add('active');
  }

  function openModalEditContent(courseId, contentId, unitJson) {
    let unit = unitJson;
    const course = AppState.courses.find(c => c.id === courseId);
    if (!unit && course && course.contents) {
      unit = course.contents.find(u => u.id === contentId);
    }
    if (typeof unit === 'string') {
      try { unit = JSON.parse(unit.replace(/&apos;/g, "'")); } catch(e) { unit = {}; }
    }
    unit = unit || {};
    document.getElementById('modal-title').textContent = 'Edit Unit Konten';
    document.getElementById('modal-content').innerHTML = buildContentForm(courseId, unit, contentId);
    document.getElementById('modal-action-btn').textContent = 'Simpan Perubahan';
    document.getElementById('modal-action-btn').onclick = () => document.getElementById('form-add-unit').requestSubmit();
    document.getElementById('global-modal').classList.add('active');
  }

  function buildContentForm(courseId, unit = {}, editId = null) {
    return `
      <form id="form-add-unit" onsubmit="handleSaveContent(event,'${courseId}','${editId || ''}')">
        <div class="form-group">
          <label class="form-label">Judul Unit</label>
          <input type="text" id="unit-title" class="form-control" value="${escHtml(unit.title || '')}" placeholder="Contoh: Video Percobaan Kalorimeter" required>
        </div>
        <div class="form-group">
          <label class="form-label">Jenis Konten</label>
          <select id="unit-type" class="form-control">
            ${['Materi','Video','Kaidah','Latihan','Kuis'].map(t => `<option value="${t}" ${unit.type===t?'selected':''}>${t}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Estimasi Durasi</label>
          <select id="unit-duration" class="form-control">
            ${['10 Menit','15 Menit','20 Menit','25 Menit','30 Menit','45 Menit','60 Menit'].map(d => `<option value="${d}" ${unit.duration===d?'selected':''}>${d}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">URL Video Langsung / Supabase Storage / YouTube</label>
          <input type="url" id="unit-url" class="form-control" value="${unit.embedUrl || ''}" placeholder="https://...supabase.co/storage/.../video.mp4 atau https://youtube.com/...">
          <small style="color:var(--tertiary);display:block;margin-top:0.25rem;">
            💡 <strong>Rekomendasi Video:</strong> Gunakan URL file MP4 langsung (Supabase Storage) untuk mengaktifkan <em>Penguncian Kecepatan Normal (1.0x)</em> &amp; proteksi anti-skip.
          </small>
        </div>
        <div class="form-group">
          <label class="form-label">Isi Teks / Panduan Belajar</label>
          <textarea id="unit-body" class="form-control" rows="5" placeholder="Ketikkan teks materi, soal latihan, atau instruksi...">${unit.contentBody || ''}</textarea>
        </div>
      </form>
    `;
  }

  async function handleSaveContent(e, courseId, editId) {
    e.preventDefault();
    const title = document.getElementById('unit-title').value.trim();
    const type = document.getElementById('unit-type').value;
    const duration = document.getElementById('unit-duration').value;
    const embedUrl = document.getElementById('unit-url').value.trim();
    const contentBody = document.getElementById('unit-body').value;

    const course = AppState.courses.find(c => c.id === courseId) || AppState.courses[0];
    setModalLoading(true, 'Menyimpan...');

    try {
      const sb = getSupabase();
      if (sb && !AppState.isDemoMode) {
        if (editId && editId !== 'null' && editId !== '') {
          // Edit existing
          await dbEditContent(editId, { title, type, duration, embedUrl, contentBody });
          const unit = course.contents.find(u => u.id === editId);
          if (unit) { unit.title = title; unit.type = type; unit.duration = duration; unit.embedUrl = embedUrl; unit.contentBody = contentBody; }
          showToast('✅ Unit berhasil diperbarui!', 'success');
        } else {
          // Add new
          const orderIndex = course.contents.length + 1;
          const data = await dbAddContent({ courseId, title, type, duration, embedUrl, contentBody, orderIndex });
          course.contents.push({ id: data.id, title, type, duration, embedUrl, contentBody, completed: false });
          showToast('✅ Unit baru tersimpan ke Supabase!', 'success');
        }
      } else {
        // Demo mode
        if (editId && editId !== '') {
          const unit = course.contents.find(u => u.id === editId);
          if (unit) { unit.title = title; unit.type = type; unit.duration = duration; unit.embedUrl = embedUrl; unit.contentBody = contentBody; }
        } else {
          course.contents.push({ id: 'DEMO-' + Date.now(), title, type, duration, embedUrl, contentBody, completed: false });
        }
        showToast('✅ Unit disimpan (mode demo).', 'success');
      }

      closeModal();
      renderCourseEditor(document.getElementById('view-container'), courseId);
    } catch (err) {
      showToast('❌ Gagal menyimpan unit: ' + err.message, 'error');
    } finally {
      setModalLoading(false, 'Simpan Perubahan');
    }
  }

  async function confirmDeleteContent(contentId, courseId) {
    if (!confirm('Hapus unit konten ini? Tindakan ini tidak dapat dibatalkan.')) return;

    try {
      const sb = getSupabase();
      if (sb && !AppState.isDemoMode) {
        await dbDeleteContent(contentId);
        showToast('✅ Unit berhasil dihapus dari Supabase.', 'success');
      } else {
        showToast('Unit dihapus (mode demo).', 'success');
      }
      const course = AppState.courses.find(c => c.id === courseId);
      if (course) course.contents = course.contents.filter(u => u.id !== contentId);
      renderCourseEditor(document.getElementById('view-container'), courseId);
    } catch (err) {
      showToast('❌ Gagal hapus unit: ' + err.message, 'error');
    }
  }

  // --- Add Student ---
  function openModalAddStudent() {
    const courseOptions = AppState.courses.map(c => `<option value="${c.id}">${escHtml(c.title)}</option>`).join('');
    document.getElementById('modal-title').textContent = 'Tambah Peserta Didik Baru';
    document.getElementById('modal-content').innerHTML = `
      <form id="form-add-student" onsubmit="handleAddStudent(event)">
        <div class="form-group">
          <label class="form-label">Nama Lengkap Siswa</label>
          <input type="text" id="std-name" class="form-control" placeholder="contoh: Muhammad Farhan" required>
        </div>
        <div class="form-group">
          <label class="form-label">Email Siswa (untuk Login)</label>
          <input type="email" id="std-email" class="form-control" placeholder="contoh: farhan@siswa.sch.id / farhan@gmail.com" required>
        </div>
        <div class="form-group">
          <label class="form-label">Password Awal Siswa (min. 6 karakter)</label>
          <input type="text" id="std-password" class="form-control" value="Siswa123!" minlength="6" required>
          <small style="font-size:0.75rem;color:var(--tertiary);margin-top:0.25rem;">Berikan password ini ke siswa untuk masuk ke akunnya.</small>
        </div>
        <div class="form-group">
          <label class="form-label">Kelas / Rombel</label>
          <input type="text" id="std-class" class="form-control" value="XII MIPA 1" required>
        </div>
        ${courseOptions ? `
        <div class="form-group">
          <label class="form-label">Daftarkan ke Course (Opsional)</label>
          <select id="std-course" class="form-control">
            <option value="">— Tidak Didaftarkan Sekarang —</option>
            ${courseOptions}
          </select>
        </div>` : ''}
      </form>
    `;
    document.getElementById('modal-action-btn').textContent = 'Daftarkan Siswa';
    document.getElementById('modal-action-btn').onclick = () => document.getElementById('form-add-student').requestSubmit();
    document.getElementById('global-modal').classList.add('active');
  }

  async function handleAddStudent(e) {
    e.preventDefault();
    const name = document.getElementById('std-name').value.trim();
    const email = document.getElementById('std-email').value.trim();
    const password = document.getElementById('std-password').value.trim();
    const cls = document.getElementById('std-class').value.trim();
    const courseId = document.getElementById('std-course')?.value || '';

    setModalLoading(true, 'Menyimpan...');
    try {
      const sb = getSupabase();
      let newStudentId = 'DEMO-' + Date.now();

      if (sb && !AppState.isDemoMode) {
        // 1. Buatkan akun login di Supabase Auth untuk siswa ini
        let authUserId = null;
        try {
          const { data: authData, error: authErr } = await sb.auth.signUp({
            email,
            password,
            options: {
              data: { name, role: 'student', class_name: cls }
            }
          });
          if (authData?.user) authUserId = authData.user.id;
        } catch (authEx) {
          console.warn('Auth create warning for student:', authEx);
        }

        // 2. Simpan profil ke public.profiles
        const studentProfileId = authUserId || createUUID();
        const profilePayload = {
          id: studentProfileId,
          name,
          email,
          role: 'student',
          subject: 'Siswa',
          class_name: cls,
          status: 'Aktif'
        };
        if (authUserId) profilePayload.auth_user_id = authUserId;

        const { data, error } = await sb.from('profiles').insert([profilePayload]).select().single();

        if (error) throw error;
        newStudentId = data.id;

        // 3. Daftarkan ke course jika dipilih
        if (courseId) await dbEnrollStudent(courseId, newStudentId);
        showToast(`✅ Akun siswa "${name}" berhasil dibuat! Password: ${password}`, 'success');
      } else {
        showToast(`✅ Siswa "${name}" ditambahkan (mode demo).`, 'success');
      }

      AppState.students.push({ id: newStudentId, name, email, class: cls, status: 'Aktif', progress: 0, completedCourses: 0 });
      if (courseId) AppState.enrollments[courseId] = (AppState.enrollments[courseId] || 0) + 1;

      closeModal();
      renderStudentManagement(document.getElementById('view-container'));
    } catch (err) {
      showToast('❌ Gagal tambah siswa: ' + err.message, 'error');
    } finally {
      setModalLoading(false, 'Daftarkan Siswa');
    }
  }

  // --- Enroll Student ke Course ---
  function openModalEnrollStudent(studentId, studentName) {
    const courseOptions = AppState.courses.map(c => `<option value="${c.id}">${escHtml(c.title)}</option>`).join('');
    document.getElementById('modal-title').textContent = `Daftarkan ${studentName} ke Course`;
    document.getElementById('modal-content').innerHTML = `
      <form id="form-enroll" onsubmit="handleEnrollStudent(event,'${studentId}','${escHtml(studentName)}')">
        <div class="form-group">
          <label class="form-label">Pilih Course</label>
          <select id="enroll-course" class="form-control" required>
            <option value="">— Pilih Course —</option>
            ${courseOptions}
          </select>
        </div>
      </form>
    `;
    document.getElementById('modal-action-btn').textContent = 'Daftarkan';
    document.getElementById('modal-action-btn').onclick = () => document.getElementById('form-enroll').requestSubmit();
    document.getElementById('global-modal').classList.add('active');
  }

  async function handleEnrollStudent(e, studentId, studentName) {
    e.preventDefault();
    const courseId = document.getElementById('enroll-course').value;
    if (!courseId) return;

    setModalLoading(true, 'Mendaftarkan...');
    try {
      const sb = getSupabase();
      if (sb && !AppState.isDemoMode) {
        await dbEnrollStudent(courseId, studentId);
        showToast(`✅ ${studentName} berhasil didaftarkan ke course!`, 'success');
      } else {
        showToast(`✅ ${studentName} didaftarkan (mode demo).`, 'success');
      }
      AppState.enrollments[courseId] = (AppState.enrollments[courseId] || 0) + 1;
      const course = AppState.courses.find(c => c.id === courseId);
      if (course) course.enrolledStudents = AppState.enrollments[courseId];
      closeModal();
    } catch (err) {
      showToast('❌ Gagal daftarkan siswa: ' + err.message, 'error');
    } finally {
      setModalLoading(false, 'Daftarkan');
    }
  }

  // --- Add Educator ---
  function openModalAddEducator() {
    document.getElementById('modal-title').textContent = 'Tambah Akun Pendidik (Guru)';
    document.getElementById('modal-content').innerHTML = `
      <form id="form-add-edu" onsubmit="handleAddEducator(event)">
        <div class="form-group">
          <label class="form-label">Nama Lengkap & Gelar</label>
          <input type="text" id="edu-name" class="form-control" placeholder="Contoh: Dr. Budi Santoso, M.Pd." required>
        </div>
        <div class="form-group">
          <label class="form-label">Email Institusi</label>
          <input type="email" id="edu-email" class="form-control" placeholder="nama@sekolah.sch.id" required>
        </div>
        <div class="form-group">
          <label class="form-label">Password Akun Pendidik</label>
          <div style="position:relative;">
            <input type="password" id="edu-password" class="form-control" value="Guru123!" minlength="6" required style="padding-right:2.5rem;">
            <button type="button" onclick="togglePasswordVis('edu-password')" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;font-size:1rem;color:var(--tertiary);">👁️</button>
          </div>
          <small style="color:var(--tertiary);font-size:0.75rem;margin-top:0.25rem;display:block;">Minimal 6 karakter. Guru dapat login menggunakan email dan password ini.</small>
        </div>
        <div class="form-group">
          <label class="form-label">Bidang Studi / Mata Pelajaran</label>
          <input type="text" id="edu-subj" class="form-control" placeholder="Contoh: Fisika & Sains" required>
        </div>
      </form>
    `;
    document.getElementById('modal-action-btn').textContent = 'Buat Akun Pendidik';
    document.getElementById('modal-action-btn').onclick = () => document.getElementById('form-add-edu').requestSubmit();
    document.getElementById('global-modal').classList.add('active');
  }

  async function handleAddEducator(e) {
    e.preventDefault();
    const name = document.getElementById('edu-name').value.trim();
    const email = document.getElementById('edu-email').value.trim();
    const password = document.getElementById('edu-password').value.trim();
    const subject = document.getElementById('edu-subj').value.trim();

    setModalLoading(true, 'Menyimpan...');
    try {
      const sb = getSupabase();
      let newId = 'DEMO-' + Date.now();

      if (sb && !AppState.isDemoMode) {
        // 1. Coba buatkan akun login di Supabase Auth untuk pendidik ini
        let authUserId = null;
        let authSuccess = false;
        try {
          const { data: authData, error: authErr } = await sb.auth.signUp({
            email,
            password,
            options: {
              data: { name, role: 'educator', subject }
            }
          });
          if (!authErr && authData?.user?.id) {
            authUserId = authData.user.id;
            authSuccess = true;
          } else if (authErr) {
            console.warn('Supabase Auth signUp info:', authErr.message);
          }
        } catch (authEx) {
          console.warn('Supabase Auth signUp exception:', authEx);
        }

        // 2. Simpan profil ke public.profiles
        // Gunakan authUserId jika ada, atau generate UUID baru agar kolom 'id' terisi valid
        const educatorProfileId = authUserId || createUUID();
        const profilePayload = {
          id: educatorProfileId,
          name,
          email,
          role: 'educator',
          subject,
          class_name: 'Guru Pengampu',
          status: 'Aktif'
        };
        if (authUserId) profilePayload.auth_user_id = authUserId;

        const { data, error } = await sb.from('profiles').insert([profilePayload]).select().single();

        if (error) throw error;
        newId = data.id;

        if (authSuccess) {
          showToast(`✅ Akun pendidik "${name}" berhasil dibuat! Password: ${password}`, 'success');
        } else {
          showToast(`✅ Data pendidik "${name}" berhasil disimpan ke database!`, 'success');
        }
      } else {
        showToast(`✅ Pendidik "${name}" ditambahkan (mode demo).`, 'success');
      }

      AppState.educators.push({ id: newId, name, email, subject, status: 'Aktif', totalCourses: 0 });
      closeModal();
      renderAdminDashboard(document.getElementById('view-container'));
    } catch (err) {
      showToast('❌ Gagal tambah pendidik: ' + err.message, 'error');
    } finally {
      setModalLoading(false, 'Buat Akun Pendidik');
    }
  }

  function openModalEditEducator(id, name, subject, email = '', status = 'Aktif') {
    document.getElementById('modal-title').textContent = 'Edit Profil Pendidik';
    document.getElementById('modal-content').innerHTML = `
      <form id="form-edit-edu" onsubmit="handleEditEducator(event,'${id}')">
        <div class="form-group">
          <label class="form-label">Nama Lengkap & Gelar</label>
          <input type="text" id="edu-edit-name" class="form-control" value="${escHtml(name)}" required>
        </div>
        <div class="form-group">
          <label class="form-label">Email Institusi</label>
          <input type="email" id="edu-edit-email" class="form-control" value="${escHtml(email)}" required>
        </div>
        <div class="form-group">
          <label class="form-label">Bidang Studi / Mata Pelajaran</label>
          <input type="text" id="edu-edit-subj" class="form-control" value="${escHtml(subject)}" required>
        </div>
        <div class="form-group">
          <label class="form-label">Status Keaktifan</label>
          <select id="edu-edit-status" class="form-control">
            <option value="Aktif" ${status === 'Aktif' ? 'selected' : ''}>Aktif (Masih Mengajar)</option>
            <option value="Nonaktif" ${status === 'Nonaktif' ? 'selected' : ''}>Nonaktif (Tidak Mengajar)</option>
          </select>
        </div>
      </form>
    `;
    document.getElementById('modal-action-btn').textContent = 'Simpan Perubahan';
    document.getElementById('modal-action-btn').onclick = () => document.getElementById('form-edit-edu').requestSubmit();
    document.getElementById('global-modal').classList.add('active');
  }

  async function handleEditEducator(e, id) {
    e.preventDefault();
    const name = document.getElementById('edu-edit-name').value.trim();
    const email = document.getElementById('edu-edit-email').value.trim();
    const subject = document.getElementById('edu-edit-subj').value.trim();
    const status = document.getElementById('edu-edit-status').value;

    setModalLoading(true, 'Menyimpan...');
    try {
      const sb = getSupabase();
      if (sb && !AppState.isDemoMode) {
        const { error } = await sb.from('profiles').update({ name, email, subject, status }).eq('id', id);
        if (error) throw error;
        showToast('✅ Profil pendidik diperbarui!', 'success');
      } else {
        showToast('✅ Profil pendidik diperbarui (mode demo).', 'success');
      }
      const edu = AppState.educators.find(e => e.id === id);
      if (edu) {
        edu.name = name;
        edu.email = email;
        edu.subject = subject;
        edu.status = status;
      }
      closeModal();
      renderAdminDashboard(document.getElementById('view-container'));
    } catch (err) {
      showToast('❌ Gagal update: ' + err.message, 'error');
    } finally {
      setModalLoading(false, 'Simpan Perubahan');
    }
  }

  // --- Delete Educator ---
  async function confirmDeleteEducator(id, name) {
    const assignedCourses = AppState.courses.filter(c => c.authorId === id);
    let confirmMsg = `Apakah Anda yakin ingin menghapus akun pendidik "${name}"?`;
    if (assignedCourses.length > 0) {
      confirmMsg += `\n\n⚠️ Pendidik ini tercatat mengampu ${assignedCourses.length} course. Data course tidak akan terhapus, namun akun pengampu ini akan dilepas.`;
    }
    confirmMsg += '\n\nTindakan ini permanen. Lanjutkan?';

    if (!confirm(confirmMsg)) return;

    try {
      const sb = getSupabase();
      if (sb && !AppState.isDemoMode) {
        const { error } = await sb.from('profiles').delete().eq('id', id);
        if (error) throw error;
        showToast(`✅ Akun pendidik "${name}" berhasil dihapus.`, 'success');
      } else {
        showToast(`✅ Akun pendidik "${name}" dihapus (mode demo).`, 'success');
      }

      AppState.educators = AppState.educators.filter(e => e.id !== id);
      renderAdminDashboard(document.getElementById('view-container'));
    } catch (err) {
      showToast('❌ Gagal menghapus pendidik: ' + err.message, 'error');
    }
  }

  // --- Delete Course ---
  async function confirmDeleteCourse(courseId) {
    const course = AppState.courses.find(c => c.id === courseId);
    if (!confirm(`Hapus course "${course?.title || ''}"? Semua unit konten dan data enrollment akan terhapus.`)) return;

    try {
      const sb = getSupabase();
      if (sb && !AppState.isDemoMode) {
        await dbDeleteCourse(courseId);
        showToast('✅ Course berhasil dihapus dari Supabase.', 'success');
      } else {
        showToast('Course dihapus (mode demo).', 'success');
      }
      AppState.courses = AppState.courses.filter(c => c.id !== courseId);
      if (AppState.currentRole === 'admin') renderAdminDashboard(document.getElementById('view-container'));
      else renderEducatorDashboard(document.getElementById('view-container'));
    } catch (err) {
      showToast('❌ Gagal hapus course: ' + err.message, 'error');
    }
  }

  // --- Enrollment View ---
  function openEnrollModal(courseId) {
    const course = AppState.courses.find(c => c.id === courseId);
    const studentOptions = AppState.students.map(s =>
      `<option value="${s.id}">${escHtml(s.name)} (${escHtml(s.class)})</option>`
    ).join('');

    document.getElementById('modal-title').textContent = `Enrollment: ${course?.title || ''}`;
    document.getElementById('modal-content').innerHTML = `
      <p style="margin-bottom:1rem;color:var(--tertiary);">Daftarkan siswa ke course ini secara langsung.</p>
      <div class="form-group">
        <label class="form-label">Pilih Siswa</label>
        <select id="enroll-student-select" class="form-control">
          <option value="">— Pilih Siswa —</option>
          ${studentOptions}
        </select>
      </div>
      <p style="margin-top:.75rem;font-size:.8125rem;color:var(--tertiary);">Saat ini: <strong>${course?.enrolledStudents || 0} siswa</strong> terdaftar</p>
    `;
    document.getElementById('modal-action-btn').textContent = 'Daftarkan ke Course';
    document.getElementById('modal-action-btn').onclick = async () => {
      const studentId = document.getElementById('enroll-student-select').value;
      const student = AppState.students.find(s => s.id === studentId);
      if (studentId && student) {
        await handleEnrollStudent({ preventDefault: () => {} }, studentId, student.name);
        // Fake submit — patch select value
        const el = document.getElementById('enroll-course');
        if (!el) {
          // Direct enroll without sub-form
          try {
            const sb = getSupabase();
            if (sb && !AppState.isDemoMode) await dbEnrollStudent(courseId, studentId);
            AppState.enrollments[courseId] = (AppState.enrollments[courseId] || 0) + 1;
            if (course) course.enrolledStudents = AppState.enrollments[courseId];
            showToast(`✅ ${student.name} didaftarkan!`, 'success');
          } catch(err) { showToast('Gagal: ' + err.message, 'error'); }
          closeModal();
        }
      } else {
        showToast('Pilih siswa terlebih dahulu.', 'error');
      }
    };
    document.getElementById('global-modal').classList.add('active');
  }

  /* =========================================================
   * PURGE / RESET DEMO DATA
   * ========================================================= */
  async function confirmPurgeDemoData() {
    const confirmed = confirm(
      '⚠️ PERINGATAN: Anda akan menghapus SELURUH data contoh/demo:\\n\\n' +
      '• Semua Course & Unit Konten materi contoh\\n' +
      '• Semua Data Progres & Nilai siswa\\n' +
      '• Semua Pendaftaran (Enrollments)\\n' +
      '• Profil Guru & Siswa contoh (Akun login Admin Anda tetap aman)\\n\\n' +
      'Tindakan ini permanen. Lanjutkan?'
    );
    if (!confirmed) return;

    try {
      showToast('Sedang membersihkan seluruh data demo...', 'success');
      const sb = getSupabase();
      if (sb && !AppState.isDemoMode) {
        // Hapus data berelasi dari Supabase
        await sb.from('progress').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        await sb.from('enrollments').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        await sb.from('course_contents').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        await sb.from('courses').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        
        // Hapus profiles demo kecuali akun admin saat ini
        if (AppState.user?.email) {
          await sb.from('profiles').delete().neq('email', AppState.user.email);
        } else {
          await sb.from('profiles').delete().not('email', 'in', '("admin@institusi.sch.id","syarif@institusi.sch.id")');
        }
      }

      // Kosongkan state di aplikasi
      AppState.courses = [];
      AppState.enrollments = {};
      if (AppState.user) {
        AppState.educators = AppState.user.role === 'educator' || AppState.user.role === 'admin' ? [AppState.user] : [];
        AppState.students = AppState.user.role === 'student' ? [AppState.user] : [];
      } else {
        AppState.educators = [];
        AppState.students = [];
      }

      showToast('✨ Seluruh data demo berhasil dibersihkan! Dashboard siap diisi data asli.', 'success');
      navigateTo('admin-dashboard');
    } catch (err) {
      console.error('Error purging demo data:', err);
      showToast('Gagal membersihkan data: ' + (err.message || 'Terjadi kesalahan'), 'error');
    }
  }

  /* =========================================================
   * UTILITY FUNCTIONS
   * ========================================================= */

  function createUUID() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function closeModal() {
    document.getElementById('global-modal').classList.remove('active');
  }

  function setModalLoading(loading, defaultText) {
    const btn = document.getElementById('modal-action-btn');
    if (!btn) return;
    btn.disabled = loading;
    btn.textContent = loading ? 'Menyimpan...' : defaultText;
  }

  function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${message}</span>`;
    document.getElementById('toast-container').appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }

  function toggleMobileSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    if (sidebar) sidebar.classList.toggle('open');
    if (backdrop) backdrop.classList.toggle('active');
  }

  function escHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function exportPDF(studentName) {
    showToast(`Membuat laporan PDF untuk ${studentName}...`, 'success');
    // PDF export via browser print
    window.print();
  }

  function exportBatchPDF() {
    showToast('Mengompilasi laporan kelas dalam PDF...', 'success');
    window.print();
  }
