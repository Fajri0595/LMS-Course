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
    user: null,               // { id, name, email, role, subject, class_name, phone, whatsapp }
    authUser: null,           // Supabase auth.user object
    // Cache data (diisi dari Supabase, bukan hardcoded)
    courses: [],
    students: [],
    educators: [],
    enrollments: {},          // { courseId: count }
    progressMap: {},          // { contentId: true/false }
    progressData: {},         // { contentId: { score, correct_answers, wrong_answers, time_spent_seconds, notes } }
    // Submisi Tugas Google Drive & Booking Sesi Zoom
    submissions: [],          // [ { id, course_id, module_id, content_id, student_id, student_name, tutor_id, tutor_name, type, drive_url, student_notes, zoom_url, zoom_meeting_time, schedule_status, approval_status, score, tutor_feedback, submitted_at, reviewed_at } ]
    activeApprovalTab: 'all', // 'all' | 'drive' | 'zoom'
    activeLoginTab: 'student',// 'student' | 'educator' | 'admin'
    // Player & Hierarchical Curriculum state
    activeCoursePlayer: null,
    activeUnitIndex: 0,
    expandedChapters: {},     // { [chapterTitle]: boolean }
    activeQuizAnswers: {},    // { [questionId]: optionIdx }
    activeQuizStartTime: null,
    quizReviewMode: {},       // { [unitId]: boolean }
    unitStudyElapsed: {},     // { [unitId]: seconds }
    unitVideoElapsed: {},     // { [unitId]: seconds }
    forceTestAntiSkip: {},    // { [unitId]: boolean }
    isDemoMode: false
  };


  /* =========================================================
   * BOOTSTRAP — entry point saat halaman dimuat
   * ========================================================= */
  window.addEventListener('load', async () => {
    const sb = typeof getSupabase === 'function' ? getSupabase() : null;

    if (!sb) {
      console.warn('⚠️ Supabase tidak terkonfigurasi.');
      renderLoginPage();
      return;
    }

    // Periksa apakah URL mengindikasikan alur pemulihan kata sandi (password recovery)
    const initHash = window.location.hash || '';
    const initSearch = window.location.search || '';
    if (initHash.includes('type=recovery') || initSearch.includes('type=recovery')) {
      try { sessionStorage.setItem('coursehub_recovery_mode', '1'); } catch (_) {}
      AppState.isPasswordRecovery = true;
      AppState.loginScreen = 'reset-password';
    }

    // Periksa apakah ada error callback OAuth di URL
    if (initHash && initHash.includes('error=')) {
      const params = new URLSearchParams(initHash.substring(1));
      const errorDesc = params.get('error_description') || params.get('error');
      renderLoginPage();
      if (errorDesc) {
        setTimeout(() => {
          showLoginError('Autentikasi Google gagal: ' + decodeURIComponent(errorDesc).replace(/\+/g, ' '));
        }, 200);
      }
      return;
    }

    let isStartingSession = false;

    // Setup auth state listener — reaktif terhadap login/logout & callback OAuth
    sb.auth.onAuthStateChange(async (event, session) => {
      // 1. Tangkap event eksplisit pemulihan kata sandi dari Supabase
      if (event === 'PASSWORD_RECOVERY') {
        try { sessionStorage.setItem('coursehub_recovery_mode', '1'); } catch (_) {}
        AppState.isPasswordRecovery = true;
        AppState.loginScreen = 'reset-password';
        renderLoginPage();
        return;
      }

      // 2. Proteksi recovery: Jika sedang dalam pemulihan password, jangan biarkan SIGNED_IN masuk ke dashboard!
      let inRecovery = false;
      try {
        inRecovery = AppState.isPasswordRecovery || 
                     sessionStorage.getItem('coursehub_recovery_mode') === '1' ||
                     (window.location.hash && window.location.hash.includes('type=recovery')) ||
                     (window.location.search && window.location.search.includes('type=recovery'));
      } catch (_) {}

      if (inRecovery) {
        AppState.isPasswordRecovery = true;
        AppState.loginScreen = 'reset-password';
        renderLoginPage();
        return;
      }

      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session) {
        if (isStartingSession) return;
        isStartingSession = true;
        try {
          await handleSessionStart(session.user);
        } finally {
          isStartingSession = false;
        }
      } else if (event === 'SIGNED_OUT') {
        renderLoginPage();
      }
    });

    // Cek mode recovery sebelum getSession() pada pertama kali dimuat
    let inRecoveryInit = false;
    try {
      inRecoveryInit = AppState.isPasswordRecovery || 
                       sessionStorage.getItem('coursehub_recovery_mode') === '1' ||
                       (window.location.hash && window.location.hash.includes('type=recovery')) ||
                       (window.location.search && window.location.search.includes('type=recovery'));
    } catch (_) {}

    if (inRecoveryInit) {
      AppState.isPasswordRecovery = true;
      AppState.loginScreen = 'reset-password';
      renderLoginPage();
      return;
    }

    // Cek session aktif saat pertama load normal (bukan alur recovery)
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      if (!isStartingSession) {
        isStartingSession = true;
        try {
          await handleSessionStart(session.user);
        } finally {
          isStartingSession = false;
        }
      }
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
    AppState.authMode = 'login';
    if (!AppState.loginScreen) AppState.loginScreen = 'welcome'; // 'welcome' | 'login' | 'register' | 'forgot' | 'reset-password'
    document.getElementById('app-root').style.display = 'none';

    let loginEl = document.getElementById('login-overlay');
    if (!loginEl) {
      loginEl = document.createElement('div');
      loginEl.id = 'login-overlay';
      document.body.appendChild(loginEl);
    }

    renderLoginScreen(loginEl);
  }

  function renderLoginScreen(loginEl) {
    if (!loginEl) loginEl = document.getElementById('login-overlay');
    if (!loginEl) return;

    const screen = AppState.loginScreen || 'welcome';

    if (screen === 'welcome') {
      renderWelcomeScreen(loginEl);
    } else if (screen === 'login') {
      renderLoginFormScreen(loginEl);
    } else if (screen === 'register') {
      renderRegisterFormScreen(loginEl);
    } else if (screen === 'forgot') {
      renderForgotPasswordScreen(loginEl);
    } else if (screen === 'reset-password') {
      renderResetPasswordScreen(loginEl);
    }

    loginEl.style.display = 'flex';
  }

  function buildLoginShowcaseHtml() {
    return `
      <div class="login-showcase-panel">
        <div>
          <div class="showcase-header">
            <img src="favicon.svg" alt="CourseHub Logo" class="brand-logo-img" style="width:48px;height:48px;box-shadow:0 8px 24px rgba(0,0,0,0.35);">
            <div>
              <h2>CourseHub LMS</h2>
              <p>Platform Akademik Interaktif</p>
            </div>
          </div>

          <div class="showcase-features">
            <div class="showcase-feat-item">
              <div class="showcase-feat-icon">🖥️</div>
              <div class="showcase-feat-text">
                <h4>Interactive Flat Panel Ready</h4>
                <p>Dioptimalkan untuk layar sentuh besar di kelas maupun pembelajaran mandiri di perangkat pribadi.</p>
              </div>
            </div>

            <div class="showcase-feat-item">
              <div class="showcase-feat-icon">📚</div>
              <div class="showcase-feat-text">
                <h4>Kurikulum Terstruktur &amp; Modul Dinamis</h4>
                <p>Materi teks kaya, tipografi Arab berharakat, audio, serta penugasan Google Drive &amp; sesi Zoom.</p>
              </div>
            </div>

            <div class="showcase-feat-item">
              <div class="showcase-feat-icon">🎯</div>
              <div class="showcase-feat-text">
                <h4>Evaluasi KKM &amp; Proteksi Remedial</h4>
                <p>Ujian bertenggat waktu, pengacakan butir soal otomatis, dan kunci jawaban aman terjaga.</p>
              </div>
            </div>

            <div class="showcase-feat-item">
              <div class="showcase-feat-icon">📊</div>
              <div class="showcase-feat-text">
                <h4>Audit Capaian &amp; Rekap PDF Standar</h4>
                <p>Pemantauan kelulusan siswa, persetujuan tutor, dan pencetakan laporan nilai resmi A4 siap unduh.</p>
              </div>
            </div>
          </div>
        </div>

        <div class="showcase-footer">
          <div class="showcase-status-badge">
            <span class="showcase-status-dot"></span>
            <span>Sistem Terkoneksi Cloud</span>
          </div>
          <span>Versi 2.4 Enterprise</span>
        </div>
      </div>
    `;
  }

  function renderWelcomeScreen(loginEl) {
    loginEl.innerHTML = `
      <div class="login-page">
        <div class="login-split-card">
          ${buildLoginShowcaseHtml()}
          <div class="login-form-panel">
            <div style="margin-bottom:1.75rem;">
              <h1 style="font-size:1.625rem;font-weight:700;color:var(--primary-dark);margin:0 0 0.5rem;">Selamat Datang!</h1>
              <p style="color:var(--tertiary);font-size:0.875rem;margin:0;line-height:1.5;">
                Silakan masuk dengan akun Anda yang telah terdaftar, atau buat akun baru untuk mulai belajar.
              </p>
            </div>

            <!-- Dua Kartu Pilihan -->
            <div class="login-welcome-choices">
              <button type="button" class="login-choice-card" onclick="goToLoginScreen()">
                <div class="login-choice-icon">🔑</div>
                <div class="login-choice-title">Masuk ke Akun</div>
                <div class="login-choice-desc">Saya sudah memiliki akun</div>
              </button>
              <button type="button" class="login-choice-card login-choice-register" onclick="goToRegisterScreen()">
                <div class="login-choice-icon">✨</div>
                <div class="login-choice-title">Daftar Akun Baru</div>
                <div class="login-choice-desc">Saya belum memiliki akun</div>
              </button>
            </div>

            <div class="login-divider" style="margin:1.75rem 0 1.25rem;">
              <span>atau langsung masuk dengan</span>
            </div>

            <!-- Google OAuth Cepat (langsung sebagai siswa) -->
            <button type="button" class="btn-google-login" id="login-google-btn-welcome" onclick="handleGoogleLoginWelcome()">
              <svg class="google-icon" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
              </svg>
              <span>Masuk / Daftar dengan Google</span>
            </button>

            <p style="text-align:center;font-size:0.75rem;color:var(--tertiary);margin-top:1.5rem;line-height:1.4;">
              Dengan masuk, Anda menyetujui ketentuan akademik dan kebijakan privasi CourseHub LMS.
            </p>
          </div>
        </div>
      </div>
    `;
  }

  function renderLoginFormScreen(loginEl) {
    const target = AppState.activeLoginTab || 'student';
    const rememberedEmail = localStorage.getItem('coursehub_remember_email') || '';
    const labels = {
      student: { email: 'Email Peserta Didik', btn: 'Masuk sebagai Peserta Didik', hint: 'Portal khusus Peserta Didik. Akun Anda didaftarkan oleh tutor pengampu masing-masing kelas.', google: 'Masuk sebagai Siswa dengan Google', placeholder: 'contoh: siswa@institusi.ac.id' },
      educator: { email: 'Email Tutor Pengampu', btn: 'Masuk sebagai Tutor', hint: 'Portal khusus Tutor Pengampu. Masuk untuk mengelola materi, jadwal Zoom, dan verifikasi tugas.', google: 'Masuk sebagai Tutor dengan Google', placeholder: 'contoh: tutor@institusi.ac.id' },
      admin: { email: 'Email Administrator', btn: 'Masuk sebagai Administrator', hint: 'Portal Administrator Pusat Institusi. Akses pengaturan sistem, data pengguna, dan seluruh kurikulum.', google: 'Masuk sebagai Admin dengan Google', placeholder: 'contoh: admin@institusi.ac.id' }
    };
    const l = labels[target];

    loginEl.innerHTML = `
      <div class="login-page">
        <div class="login-split-card">
          ${buildLoginShowcaseHtml()}
          <div class="login-form-panel">
            <div style="margin-bottom:1.5rem;">
              <h1 class="brand-title" style="font-size:1.5rem;font-weight:700;color:var(--primary-dark);margin:0 0 0.35rem;">Masuk ke CourseHub</h1>
              <p class="brand-subtitle" style="font-size:0.8125rem;color:var(--tertiary);margin:0;">Silakan pilih peran dan masukkan kredensial akun Anda</p>
            </div>

            <!-- Tab Switcher: Peserta Didik vs Tutor vs Administrator -->
            <div class="auth-tabs">
              <button type="button" class="auth-tab-btn ${target === 'student' ? 'active' : ''}" id="tab-btn-peserta" onclick="switchLoginRole('student')">
                Peserta Didik
              </button>
              <button type="button" class="auth-tab-btn ${target === 'educator' ? 'active' : ''}" id="tab-btn-tutor" onclick="switchLoginRole('educator')">
                Tutor
              </button>
              <button type="button" class="auth-tab-btn ${target === 'admin' ? 'active' : ''}" id="tab-btn-admin" onclick="switchLoginRole('admin')">
                Admin
              </button>
            </div>

            <div id="login-error" class="login-error" style="display:none;"></div>
            <div id="login-success" class="login-success" style="display:none;"></div>

            <!-- Tombol Masuk Cepat dengan Google OAuth -->
            <button type="button" class="btn-google-login" id="login-google-btn" onclick="handleGoogleLogin()">
              <svg class="google-icon" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
              </svg>
              <span id="login-google-text">${l.google}</span>
            </button>

            <div class="login-divider">
              <span>atau masuk dengan email &amp; password</span>
            </div>

            <!-- FORM LOGIN -->
            <form id="form-login" onsubmit="handleAuthSubmit(event)">
              <div class="form-group">
                <label class="form-label" id="login-email-label">${l.email}</label>
                <input type="email" id="login-email" class="form-control" placeholder="${l.placeholder}" value="${escHtml(rememberedEmail)}" required autocomplete="email">
              </div>

              <div class="form-group">
                <label class="form-label">Password</label>
                <div style="position:relative;">
                  <input type="password" id="login-password" class="form-control" placeholder="Masukkan password" required autocomplete="current-password" style="padding-right:3rem;" onkeyup="handleCapsLockCheck(event, 'caps-warning-login')" onkeydown="handleCapsLockCheck(event, 'caps-warning-login')">
                  <button type="button" onclick="togglePasswordVis('login-password')" style="position:absolute;right:.75rem;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--tertiary);" title="Lihat/Sembunyikan Password">👁️</button>
                </div>
                <div id="caps-warning-login" class="caps-warning" style="display:none;">⚠️ Caps Lock Aktif pada keyboard Anda</div>
              </div>

              <!-- Utilitas: Ingat Saya & Lupa Password -->
              <div class="login-utility-row">
                <label class="remember-me-label">
                  <input type="checkbox" id="login-remember-me" ${rememberedEmail ? 'checked' : ''}>
                  <span>Ingat saya</span>
                </label>
                <a href="javascript:void(0)" class="forgot-pw-link" onclick="goToForgotPasswordScreen()">Lupa Password?</a>
              </div>

              <button type="submit" class="btn btn-primary" style="width:100%;margin-top:.25rem;" id="login-submit-btn">
                <span id="login-btn-text">${l.btn}</span>
              </button>
              <p id="login-hint-text" style="text-align:center;font-size:.8125rem;color:var(--tertiary);margin-top:1.25rem;line-height:1.4;">
                ${l.hint}
              </p>
            </form>

            <!-- Kembali & Daftar -->
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:1.25rem;font-size:0.8125rem;">
              <a href="javascript:void(0)" onclick="goToWelcomeScreen()" style="color:var(--tertiary);text-decoration:none;display:flex;align-items:center;gap:0.25rem;">
                ← Kembali
              </a>
              <span style="color:var(--tertiary);">
                Belum punya akun?
                <a href="javascript:void(0)" onclick="goToRegisterScreen()" style="color:var(--primary);font-weight:600;text-decoration:none;">Daftar di sini</a>
              </span>
            </div>

          </div>
        </div>
      </div>
    `;

    setTimeout(() => {
      const emailInput = document.getElementById('login-email');
      const pwInput = document.getElementById('login-password');
      if (emailInput && !emailInput.value) emailInput.focus();
      else if (pwInput) pwInput.focus();
    }, 50);
  }

  function renderRegisterFormScreen(loginEl) {
    let target = AppState.activeLoginTab || 'student';
    if (target === 'admin') target = 'student';
    const labels = {
      student: { title: 'Daftar Akun Peserta Didik', btn: 'Daftar Akun Peserta Didik', google: 'Daftar dengan Google (Siswa)', placeholder: 'contoh: siswa@institusi.ac.id' },
      educator: { title: 'Daftar Akun Tutor', btn: 'Daftar Akun Tutor', google: 'Daftar dengan Google (Tutor)', placeholder: 'contoh: tutor@institusi.ac.id' }
    };
    const l = labels[target];

    loginEl.innerHTML = `
      <div class="login-page">
        <div class="login-split-card">
          ${buildLoginShowcaseHtml()}
          <div class="login-form-panel">
            <div style="margin-bottom:1.5rem;">
              <h1 class="brand-title" style="font-size:1.5rem;font-weight:700;color:var(--primary-dark);margin:0 0 0.35rem;">Buat Akun Baru</h1>
              <p class="brand-subtitle" style="font-size:0.8125rem;color:var(--tertiary);margin:0;">Lengkapi formulir pendaftaran untuk bergabung di CourseHub LMS</p>
            </div>

            <!-- Tab Switcher Role (Peserta Didik & Tutor) -->
            <div class="auth-tabs">
              <button type="button" class="auth-tab-btn ${target === 'student' ? 'active' : ''}" onclick="switchRegisterRole('student')">
                Peserta Didik
              </button>
              <button type="button" class="auth-tab-btn ${target === 'educator' ? 'active' : ''}" onclick="switchRegisterRole('educator')">
                Tutor
              </button>
            </div>

            <div id="login-error" class="login-error" style="display:none;"></div>
            <div id="login-success" class="login-success" style="display:none;"></div>

            <!-- Google OAuth Daftar -->
            <button type="button" class="btn-google-login" id="login-google-btn" onclick="handleGoogleLogin()">
              <svg class="google-icon" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
              </svg>
              <span id="login-google-text">${l.google}</span>
            </button>

            <div class="login-divider">
              <span>atau daftar manual dengan email</span>
            </div>

            <!-- FORM REGISTER -->
            <form id="form-login" onsubmit="handleAuthSubmit(event)">
              <div class="form-group">
                <label class="form-label">Nama Lengkap <span style="color:var(--error);">*</span></label>
                <input type="text" id="register-name" class="form-control" placeholder="contoh: Muhammad Farhan" required autocomplete="name">
              </div>

              <div class="form-group">
                <label class="form-label">Email <span style="color:var(--error);">*</span></label>
                <input type="email" id="login-email" class="form-control" placeholder="${l.placeholder}" required autocomplete="email">
              </div>

              <div class="form-group">
                <label class="form-label">Password <span style="color:var(--error);">*</span></label>
                <div style="position:relative;">
                  <input type="password" id="login-password" class="form-control" placeholder="Minimal 6 karakter" required autocomplete="new-password" style="padding-right:3rem;" minlength="6" oninput="evaluatePasswordStrength(this.value)" onkeyup="handleCapsLockCheck(event, 'caps-warning-register')" onkeydown="handleCapsLockCheck(event, 'caps-warning-register')">
                  <button type="button" onclick="togglePasswordVis('login-password')" style="position:absolute;right:.75rem;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--tertiary);" title="Lihat/Sembunyikan Password">👁️</button>
                </div>
                <div id="caps-warning-register" class="caps-warning" style="display:none;">⚠️ Caps Lock Aktif pada keyboard Anda</div>

                <!-- Password Strength Meter Realtime -->
                <div class="pw-strength-bar">
                  <div class="pw-strength-progress" id="reg-pw-bar"></div>
                </div>
                <div class="pw-strength-label">
                  <span id="reg-pw-label" style="color:var(--tertiary);">Kekuatan kata sandi:</span>
                  <span id="reg-pw-score" style="color:var(--tertiary);">-</span>
                </div>
                <div class="pw-criteria-list">
                  <span class="pw-criteria-item" id="crit-len">⚪ Minimal 6 karakter</span>
                  <span class="pw-criteria-item" id="crit-combo">⚪ Kombinasi huruf &amp; angka</span>
                </div>
              </div>

              <div class="form-group">
                <label class="form-label">Konfirmasi Password <span style="color:var(--error);">*</span></label>
                <div style="position:relative;">
                  <input type="password" id="register-password-confirm" class="form-control" placeholder="Ketik ulang password baru Anda" required autocomplete="new-password" style="padding-right:3rem;" minlength="6" onkeyup="handleCapsLockCheck(event, 'caps-warning-confirm')" onkeydown="handleCapsLockCheck(event, 'caps-warning-confirm')">
                  <button type="button" onclick="togglePasswordVis('register-password-confirm')" style="position:absolute;right:.75rem;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--tertiary);" title="Lihat/Sembunyikan Password">👁️</button>
                </div>
                <div id="caps-warning-confirm" class="caps-warning" style="display:none;">⚠️ Caps Lock Aktif pada keyboard Anda</div>
              </div>

              <button type="submit" class="btn btn-primary" style="width:100%;margin-top:.75rem;" id="login-submit-btn">
                <span id="login-btn-text">${l.btn}</span>
              </button>
            </form>

            <!-- Kembali & Masuk -->
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:1.25rem;font-size:0.8125rem;">
              <a href="javascript:void(0)" onclick="goToWelcomeScreen()" style="color:var(--tertiary);text-decoration:none;display:flex;align-items:center;gap:0.25rem;">
                ← Kembali
              </a>
              <span style="color:var(--tertiary);">
                Sudah punya akun?
                <a href="javascript:void(0)" onclick="goToLoginScreen()" style="color:var(--primary);font-weight:600;text-decoration:none;">Masuk di sini</a>
              </span>
            </div>

          </div>
        </div>
      </div>
    `;

    setTimeout(() => {
      document.getElementById('register-name')?.focus();
    }, 50);
  }

  function renderForgotPasswordScreen(loginEl) {
    if (!loginEl) loginEl = document.getElementById('login-overlay');
    loginEl.innerHTML = `
      <div class="login-page">
        <div class="login-split-card">
          ${buildLoginShowcaseHtml()}
          <div class="login-form-panel">
            <div style="margin-bottom:1.5rem;">
              <h1 class="brand-title" style="font-size:1.5rem;font-weight:700;color:var(--primary-dark);margin:0 0 0.35rem;">Pemulihan Kata Sandi</h1>
              <p class="brand-subtitle" style="font-size:0.8125rem;color:var(--tertiary);margin:0;">
                Masukkan email yang terdaftar pada akun CourseHub LMS Anda. Kami akan mengirimkan tautan untuk mengatur ulang kata sandi.
              </p>
            </div>

            <div id="login-error" class="login-error" style="display:none;"></div>
            <div id="login-success" class="login-success" style="display:none;"></div>

            <form id="form-forgot-password" onsubmit="handleForgotPasswordSubmit(event)">
              <div class="form-group">
                <label class="form-label">Email Terdaftar</label>
                <input type="email" id="forgot-email" class="form-control" placeholder="contoh: akun@institusi.ac.id" required autocomplete="email">
              </div>

              <button type="submit" class="btn btn-primary" style="width:100%;margin-top:0.75rem;" id="forgot-submit-btn">
                <span>Kirim Tautan Reset Password</span>
              </button>
            </form>

            <div style="margin-top:1.5rem;text-align:center;">
              <a href="javascript:void(0)" onclick="goToLoginScreen()" style="color:var(--primary);font-weight:600;font-size:0.875rem;text-decoration:none;display:inline-flex;align-items:center;gap:0.35rem;">
                ← Kembali ke Halaman Masuk
              </a>
            </div>
          </div>
        </div>
      </div>
    `;

    setTimeout(() => {
      document.getElementById('forgot-email')?.focus();
    }, 50);
  }

  function renderResetPasswordScreen(loginEl) {
    if (!loginEl) loginEl = document.getElementById('login-overlay');
    loginEl.innerHTML = `
      <div class="login-page">
        <div class="login-split-card">
          ${buildLoginShowcaseHtml()}
          <div class="login-form-panel">
            <div style="margin-bottom:1.5rem;">
              <h1 class="brand-title" style="font-size:1.5rem;font-weight:700;color:var(--primary-dark);margin:0 0 0.35rem;">Atur Password Baru</h1>
              <p class="brand-subtitle" style="font-size:0.8125rem;color:var(--tertiary);margin:0;">
                Silakan tentukan kata sandi baru yang aman untuk akun CourseHub LMS Anda.
              </p>
            </div>

            <div id="login-error" class="login-error" style="display:none;"></div>
            <div id="login-success" class="login-success" style="display:none;"></div>

            <form id="form-reset-password" onsubmit="handleResetPasswordSubmit(event)">
              <div class="form-group">
                <label class="form-label">Password Baru <span style="color:var(--error);">*</span></label>
                <div style="position:relative;">
                  <input type="password" id="new-password" class="form-control" placeholder="Minimal 6 karakter" required minlength="6" autocomplete="new-password" style="padding-right:3rem;" oninput="evaluatePasswordStrength(this.value, 'reset')" onkeyup="handleCapsLockCheck(event, 'caps-warning-reset')" onkeydown="handleCapsLockCheck(event, 'caps-warning-reset')">
                  <button type="button" onclick="togglePasswordVis('new-password')" style="position:absolute;right:.75rem;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--tertiary);" title="Lihat/Sembunyikan Password">👁️</button>
                </div>
                <div id="caps-warning-reset" class="caps-warning" style="display:none;">⚠️ Caps Lock Aktif pada keyboard Anda</div>

                <!-- Password Strength Meter Realtime -->
                <div class="pw-strength-bar">
                  <div class="pw-strength-progress" id="reset-pw-bar"></div>
                </div>
                <div class="pw-strength-label">
                  <span id="reset-pw-label" style="color:var(--tertiary);">Kekuatan kata sandi:</span>
                  <span id="reset-pw-score" style="color:var(--tertiary);">-</span>
                </div>
                <div class="pw-criteria-list">
                  <span class="pw-criteria-item" id="reset-crit-len">⚪ Minimal 6 karakter</span>
                  <span class="pw-criteria-item" id="reset-crit-combo">⚪ Kombinasi huruf &amp; angka</span>
                </div>
              </div>

              <div class="form-group">
                <label class="form-label">Konfirmasi Password Baru <span style="color:var(--error);">*</span></label>
                <div style="position:relative;">
                  <input type="password" id="confirm-new-password" class="form-control" placeholder="Ketik ulang password baru" required minlength="6" autocomplete="new-password" style="padding-right:3rem;" onkeyup="handleCapsLockCheck(event, 'caps-warning-reset-conf')" onkeydown="handleCapsLockCheck(event, 'caps-warning-reset-conf')">
                  <button type="button" onclick="togglePasswordVis('confirm-new-password')" style="position:absolute;right:.75rem;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--tertiary);" title="Lihat/Sembunyikan Password">👁️</button>
                </div>
                <div id="caps-warning-reset-conf" class="caps-warning" style="display:none;">⚠️ Caps Lock Aktif pada keyboard Anda</div>
              </div>

              <button type="submit" class="btn btn-primary" style="width:100%;margin-top:0.75rem;" id="reset-submit-btn">
                <span>Simpan Password Baru &amp; Masuk</span>
              </button>
            </form>

            <div style="margin-top:1.5rem;text-align:center;">
              <a href="javascript:void(0)" onclick="cancelPasswordRecovery()" style="color:var(--tertiary);font-size:0.8125rem;text-decoration:none;display:inline-flex;align-items:center;gap:0.35rem;">
                ← Batal &amp; Kembali ke Halaman Masuk
              </a>
            </div>
          </div>
        </div>
      </div>
    `;

    setTimeout(() => {
      document.getElementById('new-password')?.focus();
    }, 50);
  }

  function cancelPasswordRecovery() {
    try { sessionStorage.removeItem('coursehub_recovery_mode'); } catch (_) {}
    AppState.isPasswordRecovery = false;
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, '', window.location.pathname);
    } else {
      window.location.hash = '';
    }
    const sb = getSupabase();
    if (sb) {
      sb.auth.signOut().catch(() => {});
    }
    goToLoginScreen();
  }
  window.cancelPasswordRecovery = cancelPasswordRecovery;

  function handleCapsLockCheck(e, targetId = 'caps-warning-login') {
    const el = document.getElementById(targetId);
    if (!el) return;
    if (e.getModifierState && e.getModifierState('CapsLock')) {
      el.style.display = 'flex';
    } else {
      el.style.display = 'none';
    }
  }
  window.handleCapsLockCheck = handleCapsLockCheck;

  function evaluatePasswordStrength(password, prefix = 'reg') {
    const bar = document.getElementById(`${prefix}-pw-bar`);
    const label = document.getElementById(`${prefix}-pw-label`);
    const scoreText = document.getElementById(`${prefix}-pw-score`);
    const critLen = document.getElementById(`${prefix}-crit-len`);
    const critCombo = document.getElementById(`${prefix}-crit-combo`);

    if (!bar || !scoreText) return;

    const hasMinLen = (password || '').length >= 6;
    const hasLetters = /[a-zA-Z]/.test(password || '');
    const hasNumbers = /[0-9]/.test(password || '');
    const hasSymbols = /[^a-zA-Z0-9]/.test(password || '');
    const isCombo = hasLetters && hasNumbers;

    if (critLen) {
      critLen.className = 'pw-criteria-item ' + (hasMinLen ? 'valid' : '');
      critLen.innerHTML = (hasMinLen ? '✅' : '⚪') + ' Minimal 6 karakter';
    }
    if (critCombo) {
      critCombo.className = 'pw-criteria-item ' + (isCombo ? 'valid' : '');
      critCombo.innerHTML = (isCombo ? '✅' : '⚪') + ' Kombinasi huruf &amp; angka';
    }

    if (!password) {
      bar.style.width = '0%';
      bar.style.background = '#e2e8f0';
      scoreText.textContent = '-';
      scoreText.style.color = 'var(--tertiary)';
      return;
    }

    let score = 0;
    if (hasMinLen) score += 30;
    if (hasLetters) score += 20;
    if (hasNumbers) score += 25;
    if (hasSymbols || password.length >= 10) score += 25;

    if (score < 40) {
      bar.style.width = '25%';
      bar.style.background = '#ef4444';
      scoreText.textContent = 'Lemah';
      scoreText.style.color = '#ef4444';
    } else if (score < 75) {
      bar.style.width = '60%';
      bar.style.background = '#f59e0b';
      scoreText.textContent = 'Sedang';
      scoreText.style.color = '#d97706';
    } else {
      bar.style.width = '100%';
      bar.style.background = '#10b981';
      scoreText.textContent = 'Kuat';
      scoreText.style.color = '#059669';
    }
  }
  window.evaluatePasswordStrength = evaluatePasswordStrength;

  async function handleForgotPasswordSubmit(e) {
    e.preventDefault();
    const email = document.getElementById('forgot-email').value.trim();
    const btn = document.getElementById('forgot-submit-btn');
    const errEl = document.getElementById('login-error');
    const succEl = document.getElementById('login-success');

    if (!email) {
      showLoginError('Mohon masukkan alamat email Anda.');
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span style="display:inline-block;width:14px;height:14px;border:2px solid #fff;border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;margin-right:6px;"></span> Mengirim...';
    if (errEl) errEl.style.display = 'none';
    if (succEl) succEl.style.display = 'none';

    const sb = getSupabase();
    if (!sb) {
      showLoginError('Koneksi Supabase tidak tersedia.');
      btn.disabled = false;
      btn.innerHTML = '<span>Kirim Tautan Reset Password</span>';
      return;
    }

    try {
      const redirectUrl = window.location.origin + window.location.pathname;
      const { error } = await sb.auth.resetPasswordForEmail(email, {
        redirectTo: redirectUrl
      });
      if (error) throw error;

      if (succEl) {
        succEl.innerHTML = `
          <strong>Tautan Berhasil Dikirim!</strong><br>
          Kami telah mengirimkan instruksi pemulihan kata sandi ke <strong>${escHtml(email)}</strong>. Silakan periksa kotak masuk atau folder spam Anda.
        `;
        succEl.style.display = 'block';
      }
      btn.style.display = 'none';
    } catch (err) {
      showLoginError('Gagal mengirim pemulihan sandi: ' + (err.message || 'Periksa kembali email Anda.'));
      btn.disabled = false;
      btn.innerHTML = '<span>Kirim Tautan Reset Password</span>';
    }
  }
  window.handleForgotPasswordSubmit = handleForgotPasswordSubmit;

  async function handleResetPasswordSubmit(e) {
    e.preventDefault();
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-new-password').value;
    const btn = document.getElementById('reset-submit-btn');
    const errEl = document.getElementById('login-error');
    const succEl = document.getElementById('login-success');

    if (newPassword.length < 6) {
      showLoginError('Password minimal 6 karakter.');
      return;
    }
    if (newPassword !== confirmPassword) {
      showLoginError('Konfirmasi password tidak cocok dengan password baru.');
      return;
    }

    btn.disabled = true;
    btn.innerHTML = 'Menyimpan Password...';
    if (errEl) errEl.style.display = 'none';

    const sb = getSupabase();
    if (!sb) {
      showLoginError('Koneksi Supabase tidak tersedia.');
      btn.disabled = false;
      btn.innerHTML = '<span>Simpan Password Baru &amp; Masuk</span>';
      return;
    }

    try {
      const { error } = await sb.auth.updateUser({ password: newPassword });
      if (error) throw error;

      try { sessionStorage.removeItem('coursehub_recovery_mode'); } catch (_) {}
      AppState.isPasswordRecovery = false;

      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', window.location.pathname);
      } else {
        window.location.hash = '';
      }

      if (succEl) {
        succEl.textContent = '🎉 Kata sandi berhasil diperbarui! Sedang mengalihkan ke halaman masuk...';
        succEl.style.display = 'block';
      }
      setTimeout(async () => {
        try { await sb.auth.signOut(); } catch (_) {}
        goToLoginScreen();
        setTimeout(() => {
          const succ2 = document.getElementById('login-success');
          if (succ2) {
            succ2.textContent = '🎉 Kata sandi berhasil diperbarui! Silakan masuk dengan kata sandi baru Anda.';
            succ2.style.display = 'block';
          }
        }, 80);
      }, 1500);
    } catch (err) {
      showLoginError('Gagal memperbarui kata sandi: ' + err.message);
      btn.disabled = false;
      btn.innerHTML = '<span>Simpan Password Baru &amp; Masuk</span>';
    }
  }
  window.handleResetPasswordSubmit = handleResetPasswordSubmit;

  function goToWelcomeScreen() {
    AppState.loginScreen = 'welcome';
    AppState.authMode = 'login';
    renderLoginScreen();
  }
  window.goToWelcomeScreen = goToWelcomeScreen;

  function goToLoginScreen() {
    AppState.loginScreen = 'login';
    AppState.authMode = 'login';
    renderLoginScreen();
  }
  window.goToLoginScreen = goToLoginScreen;

  function goToRegisterScreen() {
    AppState.loginScreen = 'register';
    AppState.authMode = 'register';
    if (AppState.activeLoginTab === 'admin') {
      AppState.activeLoginTab = 'student';
    }
    renderLoginScreen();
  }
  window.goToRegisterScreen = goToRegisterScreen;

  function goToForgotPasswordScreen() {
    AppState.loginScreen = 'forgot';
    AppState.authMode = 'login';
    renderLoginScreen();
  }
  window.goToForgotPasswordScreen = goToForgotPasswordScreen;

  function handleGoogleLoginWelcome() {
    AppState.activeLoginTab = 'student';
    handleGoogleLogin();
  }
  window.handleGoogleLoginWelcome = handleGoogleLoginWelcome;

  function switchRegisterRole(role) {
    let target = 'student';
    if (role === 'tutor' || role === 'educator') target = 'educator';
    AppState.activeLoginTab = target;
    AppState.loginScreen = 'register';
    AppState.authMode = 'register';
    renderLoginScreen();
  }
  window.switchRegisterRole = switchRegisterRole;

  function toggleAuthMode() {
    if (AppState.loginScreen === 'register' || AppState.authMode === 'register') {
      goToLoginScreen();
    } else {
      goToRegisterScreen();
    }
  }
  window.toggleAuthMode = toggleAuthMode;

  function switchLoginRole(role) {
    let target = 'student';
    if (role === 'tutor' || role === 'educator' || role === 'guru' || role === 'dosen') target = 'educator';
    else if (role === 'admin' || role === 'administrator') target = 'admin';

    AppState.activeLoginTab = target;
    AppState.authMode = 'login';
    AppState.loginScreen = 'login';
    renderLoginScreen();
  }

  async function handleGoogleLogin() {
    const sb = getSupabase();
    if (!sb) {
      showLoginError('Koneksi Supabase tidak tersedia.');
      return;
    }

    const googleBtn = document.getElementById('login-google-btn') || document.getElementById('login-google-btn-welcome');
    const originalContent = googleBtn ? googleBtn.innerHTML : '';
    if (googleBtn) {
      googleBtn.disabled = true;
      googleBtn.style.opacity = '0.75';
      googleBtn.innerHTML = `
        <span style="display:inline-block;width:16px;height:16px;border:2px solid #cbd5e1;border-top-color:#4285F4;border-radius:50%;animation:spin 0.8s linear infinite;margin-right:8px;"></span>
        Menghubungkan ke Google...
      `;
    }

    const currentTab = AppState.activeLoginTab || 'student';
    try {
      localStorage.setItem('coursehub_login_role_intent', currentTab);
      localStorage.setItem('coursehub_login_mode_intent', AppState.authMode || 'login');
    } catch (e) {
      console.warn('localStorage error:', e);
    }

    const redirectUrl = window.location.origin + window.location.pathname;

    const { data, error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUrl
      }
    });

    if (error) {
      console.error('Google OAuth error:', error);
      showLoginError('Gagal menghubungkan Google Auth: ' + (error.message || '') + '. Pastikan Google Provider sudah diaktifkan di Supabase Dashboard.');
      if (googleBtn) {
        googleBtn.disabled = false;
        googleBtn.style.opacity = '1';
        googleBtn.innerHTML = originalContent;
      }
    }
  }

  async function handleAuthSubmit(e) {
    e.preventDefault();
    if (AppState.authMode === 'register') {
      await handleRegister(e);
    } else {
      await handleLogin(e);
    }
  }

  async function handleRegister(e) {
    const name = document.getElementById('register-name').value.trim();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const confirmPassword = document.getElementById('register-password-confirm')?.value;
    const btn = document.getElementById('login-submit-btn');
    const btnText = document.getElementById('login-btn-text');
    const originalText = btnText ? btnText.textContent : 'Daftar';
    let targetRole = AppState.activeLoginTab || 'student';
    if (targetRole === 'admin') targetRole = 'student';

    if (!name) {
      showLoginError('Mohon isi nama lengkap Anda.');
      return;
    }
    if (password.length < 6) {
      showLoginError('Password minimal 6 karakter.');
      return;
    }
    if (confirmPassword !== undefined && password !== confirmPassword) {
      showLoginError('Konfirmasi kata sandi tidak cocok. Mohon ketik ulang kata sandi dengan benar.');
      return;
    }

    btn.disabled = true;
    if (btnText) btnText.textContent = 'Mendaftarkan...';

    const sb = getSupabase();
    if (!sb) {
      showLoginError('Koneksi Supabase tidak tersedia.');
      btn.disabled = false;
      if (btnText) btnText.textContent = originalText;
      return;
    }

    try {
      localStorage.setItem('coursehub_login_mode_intent', 'register');
      localStorage.setItem('coursehub_login_role_intent', targetRole);

      const { data: authData, error: authErr } = await sb.auth.signUp({
        email,
        password,
        options: {
          data: { name, role: targetRole }
        }
      });

      if (authErr) throw authErr;

      const authUserId = authData?.user?.id;
      const { data: existingProfile } = await sb.from('profiles').select('id').eq('email', email).single();

      if (!existingProfile) {
        const newProfile = {
          id: authUserId || createUUID(),
          name,
          email,
          role: targetRole,
          subject: targetRole === 'educator' ? 'Bahasa Arab' : (targetRole === 'admin' ? 'Administrator Pusat' : 'Umum'),
          class_name: targetRole === 'educator' ? 'Guru Pengampu' : (targetRole === 'admin' ? 'Pusat Institusi' : 'Kelas Terbuka'),
          status: 'Aktif'
        };
        if (authUserId) newProfile.auth_user_id = authUserId;
        await sb.from('profiles').insert([newProfile]);
      } else if (authUserId) {
        await sb.from('profiles').update({ auth_user_id: authUserId }).eq('id', existingProfile.id);
      }

      if (authData?.session) {
        await handleSessionStart(authData.session.user);
      } else {
        // Pendaftaran berhasil, arahkan ke layar login
        AppState.loginScreen = 'login';
        AppState.authMode = 'login';
        renderLoginScreen();
        // Tampilkan pesan sukses setelah re-render
        setTimeout(() => {
          const succEl = document.getElementById('login-success');
          if (succEl) {
            succEl.textContent = '🎉 Pendaftaran akun baru berhasil! Silakan masuk dengan email dan kata sandi Anda.';
            succEl.style.display = 'block';
          }
        }, 50);
      }
    } catch (err) {
      showLoginError('Pendaftaran gagal: ' + (err.message || 'Periksa kembali data Anda.'));
    } finally {
      btn.disabled = false;
      if (btnText) btnText.textContent = originalText;
    }
  }

  async function handleLogin(e) {
    // 1. Cek Proteksi Brute-Force Rate Limiting
    if (AppState.loginLockoutUntil && Date.now() < AppState.loginLockoutUntil) {
      const waitSecs = Math.ceil((AppState.loginLockoutUntil - Date.now()) / 1000);
      showLoginError(`⏳ Akun dibekukan sementara demi keamanan. Silakan coba kembali dalam ${waitSecs} detik.`);
      return;
    }

    const target = AppState.activeLoginTab || 'student';
    try {
      localStorage.setItem('coursehub_login_role_intent', target);
      localStorage.setItem('coursehub_login_mode_intent', 'login');
    } catch (err) {}

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

    // 2. Cek keberadaan profil akun di database terlebih dahulu (Mendeteksi akun yang sudah dihapus Admin)
    try {
      const { data: profileCheck, error: profErr } = await sb
        .from('profiles')
        .select('id, name, email, role, status')
        .eq('email', email)
        .maybeSingle();

      if (!profileCheck) {
        showLoginError(`⛔ Akses Ditolak: Akun (${email}) tidak ditemukan di sistem atau telah dinonaktifkan/dihapus oleh Administrator.`);
        btn.disabled = false;
        btn.innerHTML = loginBtnOriginal;
        return;
      }

      if (profileCheck.status === 'Nonaktif') {
        showLoginError(`⛔ Akses Ditolak: Akun (${email}) berstatus Nonaktif. Silakan hubungi Administrator.`);
        btn.disabled = false;
        btn.innerHTML = loginBtnOriginal;
        return;
      }

      // Validasi kesesuaian peran tab login
      const userRole = (profileCheck.role || '').toLowerCase();
      if (userRole && userRole !== target) {
        const roleNames = { admin: 'Administrator', educator: 'Tutor Pengampu', student: 'Peserta Didik' };
        const roleName = roleNames[userRole] || userRole;
        const targetName = roleNames[target] || target;
        showLoginError(`⛔ Akses Ditolak: Akun (${email}) terdaftar sebagai ${roleName}, bukan sebagai ${targetName}. Silakan beralih ke tab "${roleName}" untuk masuk.`);
        btn.disabled = false;
        btn.innerHTML = loginBtnOriginal;
        return;
      }
    } catch (checkErr) {
      console.warn('Pengecekan profil login:', checkErr);
    }

    // 3. Autentikasi kredensial kata sandi
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      AppState.failedAttempts = (AppState.failedAttempts || 0) + 1;
      let msg = error.message || '';
      if (msg.includes('Invalid login credentials')) {
        msg = 'Kata sandi yang Anda masukkan salah. Jika akun Anda dibuat via Google, silakan gunakan tombol "Masuk dengan Google", atau gunakan fitur "Lupa Password?".';
      }

      if (AppState.failedAttempts >= 4) {
        AppState.loginLockoutUntil = Date.now() + (30 * 1000);
        showLoginError('⛔ Terlalu banyak percobaan login gagal (4x). Demi keamanan, proses login dibekukan selama 30 detik.');
      } else {
        showLoginError(msg + ` (Percobaan ${AppState.failedAttempts} dari 4)`);
      }

      btn.disabled = false;
      btn.innerHTML = loginBtnOriginal;
      return;
    }

    // Login Sukses: Bersihkan counter percobaan gagal
    AppState.failedAttempts = 0;
    delete AppState.loginLockoutUntil;

    // Persistensi "Ingat Saya"
    const rememberCheckbox = document.getElementById('login-remember-me');
    if (rememberCheckbox && rememberCheckbox.checked) {
      localStorage.setItem('coursehub_remember_email', email);
    } else {
      localStorage.removeItem('coursehub_remember_email');
    }
  }

  async function handleSessionStart(authUser) {
    // 0. Jika sedang dalam alur pemulihan kata sandi, jangan pernah buka dashboard!
    let inRecovery = false;
    try {
      inRecovery = AppState.isPasswordRecovery || 
                   sessionStorage.getItem('coursehub_recovery_mode') === '1' ||
                   (window.location.hash && window.location.hash.includes('type=recovery')) ||
                   (window.location.search && window.location.search.includes('type=recovery'));
    } catch (_) {}

    if (inRecovery) {
      AppState.isPasswordRecovery = true;
      AppState.loginScreen = 'reset-password';
      renderLoginPage();
      return;
    }

    AppState.authUser = authUser;
    AppState.isDemoMode = false;

    // Periksa apakah login ini dipicu secara aktif dari tab tertentu (misal klik login / redirect OAuth)
    const savedIntent = localStorage.getItem('coursehub_login_role_intent');
    const isExplicitLoginAttempt = !!savedIntent;
    if (savedIntent) {
      AppState.activeLoginTab = savedIntent;
    }
    const activeTab = savedIntent || 'student';

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
        // Cek apakah login via Google
        const isGoogleUser = authUser.app_metadata?.provider === 'google' || 
          (authUser.identities && authUser.identities.some(i => i.provider === 'google'));
        const savedMode = localStorage.getItem('coursehub_login_mode_intent') || AppState.authMode;

        if (isGoogleUser && activeTab === 'student') {
          // JANGAN otomatis daftarkan akun baru jika pengguna bermaksud MASUK (login biasa)
          // Ini mencegah akun yang telah dihapus admin otomatis hidup kembali!
          if (savedMode !== 'register') {
            showLoginError(`⛔ Akses Ditolak: Akun (${authUser.email}) tidak ditemukan di sistem atau telah dinonaktifkan/dihapus oleh Administrator. Silakan hubungi admin.`);
            await getSupabase().auth.signOut();
            AppState.user = null;
            AppState.authUser = null;
            return;
          }

          // Otomatis daftarkan profile Peserta Baru jika pendaftaran resmi lewat tab Peserta Didik
          const fullName = authUser.user_metadata?.full_name || 
                           authUser.user_metadata?.name || 
                           authUser.email.split('@')[0];
          const newStudentProfile = {
            auth_user_id: authUser.id,
            name: fullName,
            email: authUser.email,
            role: 'student',
            subject: 'Umum',
            class_name: 'Kelas Terbuka',
            status: 'Aktif'
          };
          const { data: createdProfile, error: createErr } = await sb
            .from('profiles')
            .insert([newStudentProfile])
            .select()
            .single();

          if (!createErr && createdProfile) {
            AppState.user = createdProfile;
          } else {
            console.error('Gagal membuat profil Google:', createErr);
            showLoginError('Gagal menyiapkan akun profil Google. Hubungi administrator.');
            await getSupabase().auth.signOut();
            return;
          }
        } else if (isGoogleUser && activeTab === 'admin') {
          // Periksa apakah database belum memiliki Administrator sama sekali (Setup Admin Pertama)
          const { data: existingAdmins } = await sb
            .from('profiles')
            .select('id')
            .eq('role', 'admin')
            .limit(1);

          if (!existingAdmins || existingAdmins.length === 0) {
            // Belum ada admin: angkat akun Google pertama ini sebagai Super Administrator
            const fullName = authUser.user_metadata?.full_name || 
                             authUser.user_metadata?.name || 
                             authUser.email.split('@')[0];
            const newAdminProfile = {
              auth_user_id: authUser.id,
              name: fullName,
              email: authUser.email,
              role: 'admin',
              subject: 'Administrator Pusat',
              class_name: 'Pusat Institusi',
              status: 'Aktif'
            };
            const { data: createdAdmin, error: createAdminErr } = await sb
              .from('profiles')
              .insert([newAdminProfile])
              .select()
              .single();

            if (!createAdminErr && createdAdmin) {
              AppState.user = createdAdmin;
            } else {
              console.error('Gagal membuat profil Admin:', createAdminErr);
              showLoginError('Gagal mendaftarkan akun Administrator. Hubungi administrator.');
              await getSupabase().auth.signOut();
              return;
            }
          } else {
            showLoginError(`⛔ Akses Ditolak: Akun Google (${authUser.email}) belum terdaftar sebagai Administrator. Silakan hubungi admin institusi.`);
            await getSupabase().auth.signOut();
            return;
          }
        } else if (isGoogleUser && activeTab === 'educator') {
          if (savedMode === 'register') {
            // Pengguna mendaftar sebagai Tutor baru lewat Google
            const fullName = authUser.user_metadata?.full_name || 
                             authUser.user_metadata?.name || 
                             authUser.email.split('@')[0];
            const newEducatorProfile = {
              auth_user_id: authUser.id,
              name: fullName,
              email: authUser.email,
              role: 'educator',
              subject: 'Bahasa Arab',
              class_name: 'Guru Pengampu',
              status: 'Aktif'
            };
            const { data: createdEducator, error: createEducatorErr } = await sb
              .from('profiles')
              .insert([newEducatorProfile])
              .select()
              .single();

            if (!createEducatorErr && createdEducator) {
              AppState.user = createdEducator;
            } else {
              console.error('Gagal membuat profil Tutor via Google:', createEducatorErr);
              showLoginError('Gagal mendaftarkan akun Tutor via Google. Hubungi administrator.');
              await getSupabase().auth.signOut();
              return;
            }
          } else {
            showLoginError(`⛔ Akses Ditolak: Akun Google (${authUser.email}) belum terdaftar sebagai Tutor Pengampu atau telah dinonaktifkan.`);
            await getSupabase().auth.signOut();
            return;
          }
        } else {
          showLoginError(`⛔ Akses Ditolak: Akun (${authUser.email}) tidak ditemukan di sistem atau telah dinonaktifkan/dihapus oleh Administrator. Hubungi administrator.`);
          await getSupabase().auth.signOut();
          AppState.user = null;
          AppState.authUser = null;
          return;
        }
      }
    } else {
      AppState.user = profile;
    }

    // =========================================================
    // VALIDASI PERAN LOGIN KETAT (Hanya saat proses login baru aktif)
    // =========================================================
    if (isExplicitLoginAttempt) {
      let userRole = (AppState.user?.role || '').toLowerCase();

      // 1. Batasi jika akun peserta login di sisi tutor
      if (activeTab === 'educator' && userRole === 'student') {
        showLoginError('⛔ Akses Ditolak: Akun Anda terdaftar sebagai Peserta Didik dan tidak diizinkan masuk melalui Portal Tutor. Silakan klik tab "Peserta Didik".');
        await sb.auth.signOut();
        AppState.user = null;
        AppState.authUser = null;
        return;
      }

      // 2. Batasi jika akun peserta atau tutor login di sisi administrator
      if (activeTab === 'admin' && userRole !== 'admin') {
        // Jika sistem belum memiliki Admin sama sekali, promosikan akun terdaftar ini menjadi Administrator
        const { data: existingAdmins } = await sb
          .from('profiles')
          .select('id')
          .eq('role', 'admin')
          .limit(1);

        if (!existingAdmins || existingAdmins.length === 0) {
          await sb.from('profiles').update({ role: 'admin' }).eq('id', AppState.user.id);
          AppState.user.role = 'admin';
          userRole = 'admin';
        } else {
          showLoginError('⛔ Akses Ditolak: Akun Anda tidak memiliki hak akses sebagai Administrator Institusi.');
          await sb.auth.signOut();
          AppState.user = null;
          AppState.authUser = null;
          return;
        }
      }

      // 3. Batasi jika akun tutor login di sisi peserta didik
      if (activeTab === 'student' && userRole === 'educator') {
        showLoginError('⛔ Akses Ditolak: Akun Anda terdaftar sebagai Tutor Pengampu. Silakan gunakan tab "Tutor" untuk masuk.');
        await sb.auth.signOut();
        AppState.user = null;
        AppState.authUser = null;
        return;
      }
    }

    hideLoginPage();
    await initApp();
  }

  function hideLoginPage() {
    const loginEl = document.getElementById('login-overlay');
    if (loginEl) loginEl.style.display = 'none';
    document.getElementById('app-root').style.display = 'flex';
    localStorage.removeItem('coursehub_login_role_intent');
    localStorage.removeItem('coursehub_login_mode_intent');
    // Bersihkan hash token dari address bar agar rapi & aman
    if (window.location.hash && (window.location.hash.includes('access_token') || window.location.hash.includes('error='))) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }

  function showLoginError(msg) {
    localStorage.removeItem('coursehub_login_role_intent');
    localStorage.removeItem('coursehub_login_mode_intent');
    const el = document.getElementById('login-error');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
    const btn = document.getElementById('login-submit-btn');
    if (btn) {
      btn.disabled = false;
      const target = AppState.activeLoginTab || 'student';
      const isRegister = AppState.authMode === 'register';
      if (isRegister) {
        if (target === 'educator') btn.innerHTML = '<span id="login-btn-text">Daftar Akun Tutor</span>';
        else btn.innerHTML = '<span id="login-btn-text">Daftar Akun Peserta Didik</span>';
      } else {
        if (target === 'student') btn.innerHTML = '<span id="login-btn-text">Masuk sebagai Peserta Didik</span>';
        else if (target === 'educator') btn.innerHTML = '<span id="login-btn-text">Masuk sebagai Tutor</span>';
        else btn.innerHTML = '<span id="login-btn-text">Masuk sebagai Administrator</span>';
      }
    }
  }

  function togglePasswordVis(inputId = 'login-password') {
    const pw = document.getElementById(inputId);
    if (pw) pw.type = pw.type === 'password' ? 'text' : 'password';
  }

  async function handleLogout() {
    try {
      localStorage.removeItem('lms_last_active_route');
      localStorage.removeItem('lms_last_active_player');
      localStorage.removeItem('lms_demo_role');
    } catch (e) {}
    const sb = typeof getSupabase === 'function' ? getSupabase() : null;
    if (sb) {
      await sb.auth.signOut();
    }
    renderLoginPage();
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

    // Cek apakah ada rute aktif yang disimpan sebelumnya di localStorage
    let restored = false;
    try {
      const savedRouteRaw = localStorage.getItem('lms_last_active_route');
      if (savedRouteRaw) {
        const savedRoute = JSON.parse(savedRouteRaw);
        if (savedRoute && savedRoute.viewId) {
          if (savedRoute.viewId === 'course-player') {
            const targetCourseId = savedRoute.param || AppState.courses[0]?.id;
            const course = AppState.courses.find(c => c.id === targetCourseId) || AppState.courses[0];
            if (course) {
              const savedUnit = typeof savedRoute.unitIndex === 'number' ? savedRoute.unitIndex : 0;
              AppState.activeUnitIndex = Math.min(Math.max(0, savedUnit), Math.max(0, (course.contents || []).length - 1));
              navigateTo('course-player', course.id);
              restored = true;
            }
          } else {
            navigateTo(savedRoute.viewId, savedRoute.param);
            restored = true;
          }
        }
      }
    } catch (e) {
      console.warn('Gagal memulihkan rute terakhir:', e);
    }

    if (!restored) {
      // Navigasi default ke dashboard sesuai role
      if (role === 'admin') navigateTo('admin-dashboard');
      else if (role === 'educator') navigateTo('educator-dashboard');
      else navigateTo('student-dashboard');
    }
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
      await loadAssignmentSubmissions(null);
      return;
    }

    try {
      await Promise.all([
        loadCourses(sb),
        loadProfiles(sb)
      ]);
      // Muat data submisi tugas Google Drive & sesi Zoom
      await loadAssignmentSubmissions(sb);
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

    // Educator melihat course miliknya atau yang author_id belum di-assign
    if (AppState.currentRole === 'educator' && !AppState.isDemoMode && AppState.user) {
      query = query.or(`author_id.eq.${AppState.user.id},author_id.is.null`);
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

    AppState.courses = (data || []).map(c => {
      const rawContents = (c.contents || []).slice();

      return {
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
        contents: (rawContents
          .sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
          .map(cnt => {
            let itemType = cnt.type || 'materi';
            const itemBody = cnt.content_body || '';
            if (itemType === 'tugas') {
              if (itemBody.includes('<!--TYPE:tugas_drive-->')) {
                itemType = 'tugas_drive';
              } else if (itemBody.includes('<!--TYPE:tugas_zoom-->')) {
                itemType = 'tugas_zoom';
              }
            }
            return {
              id: cnt.id,
              moduleId: cnt.module_id,
              sectionName: cnt.section_name || '',
              title: cnt.title,
              type: itemType,
              duration: cnt.duration || '5 Menit',
              embedUrl: cnt.embed_url || '',
              contentBody: itemBody,
              quizData: cnt.quiz_data || null,
              passingScore: cnt.passing_score || 70,
              completed: false // akan diisi loadStudentProgress
            };
          }))
      };
    });
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
        phone: e.phone || '',
        whatsapp: e.whatsapp || '',
        totalCourses: AppState.courses.filter(c => c.authorId === e.id).length
      }));

    AppState.students = (data || [])
      .filter(p => p.role === 'student')
      .map(s => ({
        id: s.id,
        name: s.name,
        email: s.email,
        class: s.class_name || '-',
        status: s.status || 'Aktif',
        phone: s.phone || '',
        whatsapp: s.whatsapp || '',
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
      .select('content_id, score, correct_answers, wrong_answers, time_spent_seconds, notes, status, answers_data')
      .eq('student_id', studentId);
    if (error) return;
    const map = {};
    const progressData = {};
    (data || []).forEach(p => { 
      const isDone = !p.status || p.status === 'Selesai';
      if (isDone) {
        map[p.content_id] = true;
      }
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
   * FITUR PENUGASAN DRIVE, SESI ZOOM & INTEGRASI WHATSAPP TUTOR
   * ========================================================= */

  async function loadAssignmentSubmissions(sb) {
    let submissions = [];
    if (sb) {
      // 1. Coba baca dari assignment_submissions jika tabel sudah dibuat
      try {
        const { data, error } = await sb.from('assignment_submissions').select('*').order('submitted_at', { ascending: false });
        if (!error && data && data.length > 0) {
          submissions = data;
        }
      } catch (e) {
        console.warn('Tabel assignment_submissions belum tersedia:', e);
      }

      // 2. Jika assignment_submissions belum ada atau kosong, muat dari tabel progress Supabase!
      if (!submissions || submissions.length === 0) {
        try {
          const { data: progData, error: progErr } = await sb.from('progress').select('*');
          if (!progErr && progData && progData.length > 0) {
            progData.forEach(row => {
              let sub = row.answers_data;
              if (typeof sub === 'string') {
                try { sub = JSON.parse(sub); } catch (e) { sub = null; }
              }
              const isTaskStatus = row.status === 'Menunggu Review' || row.status === 'Perlu Revisi';
              if ((sub && (sub.type === 'drive' || sub.type === 'zoom' || sub.drive_url || sub.zoom_url)) || isTaskStatus) {
                if (!sub) {
                  sub = {
                    type: 'drive',
                    drive_url: row.notes || 'https://drive.google.com/',
                    student_notes: row.notes || 'Pengajuan tugas mandiri peserta didik',
                    approval_status: row.status === 'Selesai' ? 'approved' : (row.status === 'Perlu Revisi' ? 'rejected' : 'pending')
                  };
                }
                const student = AppState.students.find(st => st.id === row.student_id);
                let computedApproval = 'pending';
                if (row.status === 'Selesai') computedApproval = 'approved';
                else if (row.status === 'Perlu Revisi') computedApproval = 'rejected';
                else if (row.status === 'Menunggu Review') computedApproval = 'pending';
                else if (sub.approval_status) computedApproval = sub.approval_status;

                submissions.push({
                  ...sub,
                  id: sub.id || row.id,
                  course_id: row.course_id,
                  content_id: row.content_id,
                  student_id: row.student_id,
                  student_name: sub.student_name || student?.name || 'Peserta Didik',
                  student_email: sub.student_email || student?.email || '',
                  approval_status: computedApproval,
                  score: row.score !== null && row.score !== undefined ? row.score : sub.score,
                  tutor_feedback: sub.tutor_feedback || (row.notes !== sub.student_notes ? row.notes : '') || '',
                  submitted_at: sub.submitted_at || row.completed_at || new Date().toISOString()
                });
              }
            });
          }
        } catch (err) {
          console.warn('Gagal memuat tugas dari progress Supabase:', err);
        }
      }
    }

    // 3. Fallback jika offline / lokal
    if (!submissions || submissions.length === 0) {
      try {
        const local = localStorage.getItem('lms_submissions');
        if (local) {
          submissions = JSON.parse(local);
        }
      } catch (e) {}
    }

    AppState.submissions = submissions || [];
    updatePendingBadge();
  }

  async function persistSubmission(sub) {
    const idx = AppState.submissions.findIndex(s => s.id === sub.id || (s.student_id === sub.student_id && s.content_id === sub.content_id));
    if (idx >= 0) {
      AppState.submissions[idx] = { ...AppState.submissions[idx], ...sub, updated_at: new Date().toISOString() };
    } else {
      AppState.submissions.unshift({ ...sub, submitted_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    }

    try {
      localStorage.setItem('lms_submissions', JSON.stringify(AppState.submissions));
    } catch (e) {}

    const sb = typeof getSupabase === 'function' ? getSupabase() : null;
    if (sb) {
      // 1. Coba simpan ke assignment_submissions
      try {
        const payload = {
          course_id: sub.course_id,
          module_id: sub.module_id || null,
          content_id: sub.content_id,
          student_id: sub.student_id,
          tutor_id: sub.tutor_id || null,
          type: sub.type,
          drive_url: sub.drive_url || null,
          student_notes: sub.student_notes || null,
          zoom_url: sub.zoom_url || null,
          zoom_meeting_time: sub.zoom_meeting_time || null,
          schedule_status: sub.schedule_status || 'proposed',
          approval_status: sub.approval_status || 'pending',
          score: sub.score || null,
          tutor_feedback: sub.tutor_feedback || null,
          reviewed_at: sub.reviewed_at || null,
          updated_at: new Date().toISOString()
        };
        await sb.from('assignment_submissions').upsert(payload, { onConflict: 'student_id,content_id' });
      } catch (err) {}

      // 2. Simpan juga ke tabel progress Supabase (cloud fallback yang selalu ada di Supabase)
      try {
        const progressPayload = {
          course_id: sub.course_id,
          content_id: sub.content_id,
          student_id: sub.student_id,
          status: sub.approval_status === 'approved' ? 'Selesai' : (sub.approval_status === 'rejected' ? 'Perlu Revisi' : 'Menunggu Review'),
          score: sub.score || null,
          answers_data: sub,
          notes: sub.student_notes || null,
          completed_at: new Date().toISOString()
        };
        await sb.from('progress').upsert(progressPayload, { onConflict: 'student_id,content_id' });
        console.log('✅ Submisi tugas tersimpan ke Supabase (tabel progress).');
      } catch (pErr) {
        console.warn('Gagal sinkronisasi submisi ke progress Supabase:', pErr);
      }
    }

    updatePendingBadge();
  }

  function updatePendingBadge() {
    const isEducator = AppState.currentRole === 'educator';
    const tutorId = AppState.user?.id;
    const tutorName = AppState.user?.name;
    const myCourseIds = isEducator
      ? AppState.courses
          .filter(c => c.authorId === tutorId || c.author_id === tutorId || c.instructor_id === tutorId || c.authorName === tutorName)
          .map(c => c.id)
      : null;

    const pendingCount = (AppState.submissions || []).filter(s => {
      if (s.approval_status !== 'pending') return false;
      if (isEducator && myCourseIds) return myCourseIds.includes(s.course_id);
      return true;
    }).length;

    const badge = document.getElementById('sidebar-approval-badge');
    if (badge) {
      badge.textContent = pendingCount;
      badge.className = `nav-badge-count ${pendingCount > 0 ? '' : 'zero'}`;
    }

    const topbarBtn = document.getElementById('topbar-approval-btn');
    const topbarBadge = document.getElementById('topbar-approval-badge');
    if (topbarBtn) {
      const isTutorOrAdmin = AppState.currentRole === 'educator' || AppState.currentRole === 'admin';
      topbarBtn.style.display = isTutorOrAdmin ? 'inline-flex' : 'none';
      if (topbarBadge) {
        topbarBadge.textContent = pendingCount;
        topbarBadge.style.display = pendingCount > 0 ? 'inline-block' : 'none';
      }
    }
  }

  function cleanPhoneNumber(phone) {
    if (!phone) return '6281298765432';
    let cleaned = ('' + phone).replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
      cleaned = '62' + cleaned.substring(1);
    }
    return cleaned;
  }

  function buildWhatsAppLink(phone, messageText) {
    const cleaned = cleanPhoneNumber(phone);
    return `https://wa.me/${cleaned}?text=${encodeURIComponent(messageText)}`;
  }

  function buildWhatsAppZoomConfirmation(tutor, student, course, unit, meetingTimeStr, zoomUrl, isArrived = false) {
    const phone = tutor.whatsapp || tutor.phone || '6281298765432';
    const tutorName = tutor.name || 'Coach';
    const studentName = student.name || 'Peserta';
    const courseTitle = course?.title || 'Course LMS';
    const unitTitle = unit?.title || 'Sesi Zoom';

    let msg = '';
    if (isArrived) {
      msg = `Halo Coach ${tutorName}, saya ${studentName} dari kelas "${courseTitle}". Waktu sesi Zoom untuk tema "${unitTitle}" telah tiba (${meetingTimeStr}). Saya sudah berada di ruang meeting. Mohon bergabung ya Coach 🙏\n\nLink Zoom: ${zoomUrl}`;
    } else {
      msg = `Halo Coach ${tutorName}, saya ${studentName} dari kelas "${courseTitle}". Saya telah mengajukan jadwal temu sesi Zoom untuk materi "${unitTitle}" pada:\n📅 ${meetingTimeStr} WIB\n🔗 Link Zoom: ${zoomUrl}\n\nMohon konfirmasi kesediaan waktunya ya Coach. Terima kasih! 🙏`;
    }
    return buildWhatsAppLink(phone, msg);
  }


  function getTutorForCourse(course) {
    if (!course) {
      return AppState.educators[0] || {
        id: '',
        name: 'Tutor Pengampu',
        subject: 'Tutor Pengampu',
        phone: '',
        whatsapp: '',
        email: ''
      };
    }
    const found = AppState.educators.find(e => e.id === course.authorId || e.name === course.authorName);
    if (found) return found;
    return {
      id: course.authorId || '',
      name: course.authorName || 'Tutor Pengampu',
      subject: 'Tutor Pengampu Course',
      phone: '',
      whatsapp: '',
      email: ''
    };
  }

  function renderTutorContactCard(tutor, course = null, unit = null, customActionText = null) {
    const tutorPhone = tutor.whatsapp || tutor.phone || '';
    const initials = (tutor.name || 'Tutor').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
    const courseTitle = course?.title || 'Course';
    const unitTitle = unit?.title || 'Materi Belajar';
    const defaultMsg = `Halo Coach ${tutor.name}, saya ${AppState.user?.name || 'Peserta'} dari kelas "${courseTitle}" pada materi "${unitTitle}". Saya ingin bertanya/berkonsultasi mengenai materi ini. Terima kasih! 🙏`;
    const waUrl = tutorPhone ? buildWhatsAppLink(tutorPhone, defaultMsg) : '#';

    return `
      <div class="tutor-contact-widget">
        <div class="tutor-contact-left">
          <div class="tutor-contact-avatar">${initials}</div>
          <div>
            <div class="tutor-contact-name">${escHtml(tutor.name)}</div>
            <div class="tutor-contact-role">
              <span>👨‍🏫</span> ${escHtml(tutor.subject || 'Tutor Pengampu')} • <span style="color:#16a34a;">● Aktif</span>
            </div>
          </div>
        </div>
        ${tutorPhone ? `
        <a href="${waUrl}" target="_blank" rel="noopener noreferrer" class="btn-whatsapp btn-whatsapp-pulse" title="Hubungi Tutor via WhatsApp">
          <svg viewBox="0 0 24 24"><path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.711 2.598 2.664-.698c.969.584 1.761.813 2.796.814 3.183 0 5.769-2.587 5.769-5.767 0-3.181-2.586-5.768-5.769-5.768zm7.969 5.766c0 4.398-3.572 7.969-7.969 7.969-1.393 0-2.696-.36-3.83-1l-4.181 1.095 1.115-4.083c-.724-1.189-1.104-2.56-1.104-3.981 0-4.398 3.572-7.969 7.969-7.969 4.397 0 7.969 3.571 7.969 7.969z"/></svg>
          <span>${customActionText || 'Hubungi Tutor via WhatsApp'}</span>
        </a>
        ` : `
        <span style="font-size:0.8125rem;color:var(--tertiary);font-style:italic;">Kontak WhatsApp belum diatur</span>
        `}
      </div>
    `;
  }

  async function handleStudentSubmitDrive(e, courseId, contentId, moduleId) {
    e.preventDefault();
    const driveUrl = document.getElementById('input-drive-url').value.trim();
    const notes = document.getElementById('input-drive-notes').value.trim();

    if (!driveUrl) {
      showToast('Mohon tempelkan URL Google Drive tugas Anda.', 'error');
      return;
    }

    const course = AppState.courses.find(c => c.id === courseId) || AppState.activeCoursePlayer;
    const tutor = getTutorForCourse(course);
    const student = AppState.user;

    const sub = {
      id: createUUID(),
      course_id: courseId,
      module_id: moduleId,
      content_id: contentId,
      student_id: student.id,
      student_name: student.name,
      student_email: student.email,
      tutor_id: tutor.id,
      tutor_name: tutor.name,
      type: 'drive',
      drive_url: driveUrl,
      student_notes: notes,
      approval_status: 'pending',
      score: null,
      tutor_feedback: ''
    };

    await persistSubmission(sub);
    showToast('🚀 Tugas link Google Drive berhasil dikirim! Menunggu persetujuan dari Tutor.', 'success');
    renderCoursePlayer(document.getElementById('view-container'), courseId);
  }

  async function handleStudentSubmitZoom(e, courseId, contentId, moduleId) {
    e.preventDefault();
    const zoomUrlInput = document.getElementById('input-zoom-url');
    const zoomUrl = zoomUrlInput ? zoomUrlInput.value.trim() : '';
    const dateVal = document.getElementById('input-zoom-date').value;
    const timeVal = document.getElementById('input-zoom-time').value;
    const notes = document.getElementById('input-zoom-notes').value.trim();

    if (!dateVal || !timeVal) {
      showToast('Mohon tentukan usulan tanggal dan jam pertemuan.', 'error');
      return;
    }

    const meetingDateTime = new Date(`${dateVal}T${timeVal}:00`).toISOString();
    const course = AppState.courses.find(c => c.id === courseId) || AppState.activeCoursePlayer;
    const tutor = getTutorForCourse(course);
    const student = AppState.user;

    let sub = (AppState.submissions || []).find(s => s.student_id === student.id && s.content_id === contentId);
    if (!sub) {
      sub = {
        id: createUUID(),
        course_id: courseId,
        module_id: moduleId,
        content_id: contentId,
        student_id: student.id,
        student_name: student.name,
        student_email: student.email,
        tutor_id: tutor.id,
        tutor_name: tutor.name,
        type: 'zoom',
        zoom_url: zoomUrl,
        zoom_meeting_time: meetingDateTime,
        schedule_status: 'proposed',
        approval_status: 'pending',
        student_notes: notes,
        score: null,
        tutor_feedback: ''
      };
      if (!AppState.submissions) AppState.submissions = [];
      AppState.submissions.unshift(sub);
    } else {
      sub.zoom_url = zoomUrl || sub.zoom_url || '';
      sub.zoom_meeting_time = meetingDateTime;
      sub.student_notes = notes;
      sub.schedule_status = 'proposed';
    }

    await persistSubmission(sub);
    showToast(
      zoomUrl 
        ? '📅 Jadwal pertemuan & tautan Zoom berhasil diajukan! Tutor dapat meninjau keduanya sekaligus.' 
        : '📅 Usulan jadwal pertemuan berhasil dikirim ke Tutor! Tautan Zoom dapat ditambahkan setelah jadwal disetujui.', 
      'success'
    );
    renderCoursePlayer(document.getElementById('view-container'), courseId);
  }

  async function handleUpdateZoomUrl(e, subId, courseId) {
    e.preventDefault();
    const inputEl = document.getElementById('quick-zoom-url') || document.getElementById('input-edit-zoom-url');
    const zoomUrl = inputEl ? inputEl.value.trim() : '';
    if (!zoomUrl) {
      showToast('Mohon masukkan tautan Zoom / Google Meet yang valid.', 'warning');
      return;
    }
    const sub = (AppState.submissions || []).find(s => s.id === subId);
    if (!sub) return;
    sub.zoom_url = zoomUrl;
    await persistSubmission(sub);
    showToast('✅ Tautan ruang Zoom berhasil disimpan! Siap bergabung pada jadwal tatap muka.', 'success');
    renderCoursePlayer(document.getElementById('view-container'), courseId);
  }
  window.handleUpdateZoomUrl = handleUpdateZoomUrl;

  async function quickConfirmZoomSchedule(subId, courseId) {
    const sub = (AppState.submissions || []).find(s => s.id === subId);
    if (!sub) return;
    sub.schedule_status = 'confirmed';
    await persistSubmission(sub);
    showToast(`🤝 Jadwal sesi Zoom dengan ${sub.student_name} telah disetujui!`, 'success');
    renderCoursePlayer(document.getElementById('view-container'), courseId);
  }
  window.quickConfirmZoomSchedule = quickConfirmZoomSchedule;

  function openZoomEditForm() {
    const formBox = document.getElementById('zoom-form-container');
    if (formBox) {
      formBox.style.display = 'block';
      formBox.scrollIntoView({ behavior: 'smooth' });
    }
  }
  window.openZoomEditForm = openZoomEditForm;

  function openModalReviewSubmission(submissionId) {
    let sub = (AppState.submissions || []).find(s => s.id === submissionId || s.content_id === submissionId || s.student_id === submissionId);
    if (!sub) {
      const activeUnit = AppState.activeCoursePlayer?.contents?.[AppState.activeUnitIndex];
      const activeCourse = AppState.activeCoursePlayer || AppState.courses[0];
      const firstStudent = AppState.students[0] || { id: 'std-demo-1', name: 'Fajri Siswa', email: 'fajri@siswa.sch.id' };
      sub = {
        id: submissionId || createUUID(),
        course_id: activeCourse?.id || '',
        content_id: activeUnit?.id || submissionId || '',
        student_id: firstStudent.id,
        student_name: firstStudent.name,
        student_email: firstStudent.email,
        type: 'drive',
        drive_url: 'https://drive.google.com/test-tugas-siswa',
        student_notes: 'Lembar kerja praktik mandiri telah saya selesaikan. Mohon dievaluasi.',
        approval_status: 'pending',
        score: null,
        tutor_feedback: ''
      };
      if (!AppState.submissions) AppState.submissions = [];
      AppState.submissions.unshift(sub);
    }

    const course = AppState.courses.find(c => c.id === sub.course_id) || AppState.activeCoursePlayer;
    const unit = course?.contents?.find(u => u.id === sub.content_id) || AppState.activeCoursePlayer?.contents?.[AppState.activeUnitIndex];
    const isZoom = sub.type === 'zoom';

    document.getElementById('modal-title').textContent = isZoom 
      ? `Evaluasi & Persetujuan Sesi Zoom: ${sub.student_name}` 
      : `Pemeriksaan Tugas Drive: ${sub.student_name}`;

    let itemDetailHtml = '';
    if (isZoom) {
      const dt = sub.zoom_meeting_time ? new Date(sub.zoom_meeting_time).toLocaleString('id-ID', { dateStyle: 'full', timeStyle: 'short' }) : 'Belum ditentukan';
      itemDetailHtml = `
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:1rem;margin-bottom:1rem;">
          <div style="font-weight:700;color:#1e40af;margin-bottom:.35rem;">📹 Link Ruang Zoom Siswa:</div>
          <div style="display:flex;align-items:center;gap:.5rem;word-break:break-all;">
            <a href="${escHtml(sub.zoom_url || '#')}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm" style="display:inline-flex;align-items:center;gap:.35rem;">
              🚀 Masuk Ruang Zoom Peserta ↗
            </a>
            <span style="font-size:0.8125rem;color:#475569;">${escHtml(sub.zoom_url || '-')}</span>
          </div>
          <div style="margin-top:.75rem;font-size:0.875rem;">
            <strong>📅 Usulan Waktu Siswa:</strong> ${dt} WIB
          </div>
          ${sub.student_notes ? `<div style="margin-top:.5rem;font-size:0.8125rem;color:#334155;"><strong>Catatan Siswa:</strong> "${escHtml(sub.student_notes)}"</div>` : ''}
        </div>
      `;
    } else {
      itemDetailHtml = `
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:1rem;margin-bottom:1rem;">
          <div style="font-weight:700;color:#166534;margin-bottom:.35rem;">📁 Berkas Pengerjaan Google Drive Siswa:</div>
          <div style="display:flex;align-items:center;gap:.5rem;word-break:break-all;flex-wrap:wrap;">
            <a href="${escHtml(sub.drive_url || '#')}" target="_blank" rel="noopener noreferrer" class="btn btn-outline btn-sm" style="display:inline-flex;align-items:center;gap:.35rem;background:#fff;color:#166534;border-color:#86efac;font-weight:600;">
              📂 Buka Link Google Drive Peserta ↗
            </a>
            <span style="font-size:0.8125rem;color:#475569;">${escHtml(sub.drive_url || '-')}</span>
          </div>
          ${sub.student_notes ? `<div style="margin-top:.5rem;font-size:0.8125rem;color:#334155;"><strong>Catatan Siswa:</strong> "${escHtml(sub.student_notes)}"</div>` : ''}
        </div>
      `;
    }

    document.getElementById('modal-content').innerHTML = `
      <div>
        <div style="margin-bottom:1rem;font-size:0.875rem;color:var(--tertiary);">
          <strong>Course:</strong> ${escHtml(course?.title || 'Course')} • <strong>Tema:</strong> ${escHtml(unit?.sectionName || unit?.title || 'Tema')}
        </div>

        ${itemDetailHtml}

        <form id="form-review-submission" onsubmit="event.preventDefault(); submitTutorReview('${sub.id}')">
          <div class="form-group">
            <label class="form-label">Keputusan Persetujuan Kelulusan Tema <span style="color:var(--error);">*</span></label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">
              <label style="display:flex;align-items:center;gap:0.5rem;padding:0.75rem;border:2px solid #bbf7d0;background:#f0fdf4;border-radius:8px;cursor:pointer;">
                <input type="radio" name="review_decision" value="approved" checked>
                <div>
                  <strong style="color:#166534;">✅ Setujui (Lulus Tema)</strong>
                  <div style="font-size:0.75rem;color:#15803d;">Membuka tema berikutnya untuk siswa.</div>
                </div>
              </label>
              <label style="display:flex;align-items:center;gap:0.5rem;padding:0.75rem;border:2px solid #fecaca;background:#fef2f2;border-radius:8px;cursor:pointer;">
                <input type="radio" name="review_decision" value="rejected">
                <div>
                  <strong style="color:#991b1b;">⚠️ Perlu Revisi / Ulangi</strong>
                  <div style="font-size:0.75rem;color:#b91c1c;">Siswa wajib mengulang tugasnya.</div>
                </div>
              </label>
            </div>
          </div>

          ${!isZoom ? `
          <div class="form-group">
            <label class="form-label">Nilai Evaluasi (0 - 100)</label>
            <input type="number" id="review-score" class="form-control" min="0" max="100" value="${sub.score || 85}">
          </div>` : ''}

          <div class="form-group">
            <label class="form-label">Catatan & Masukan Feedback untuk Siswa <span style="color:var(--error);">*</span></label>
            <textarea id="review-feedback" class="form-control" rows="4" placeholder="${isZoom ? 'Tuliskan catatan hasil pertemuan sesi tatap muka mentoring Zoom...' : 'Tuliskan umpan balik yang membangun atau instruksi bagian mana yang wajib direvisi oleh peserta...'}" required>${escHtml(sub.tutor_feedback || (isZoom ? 'Sesi tatap muka virtual Zoom telah terlaksana dengan baik dan tuntas.' : 'Pengerjaan tugas Anda sudah sangat baik dan memenuhi standar kelulusan tema ini.'))}</textarea>
            <small style="color:var(--tertiary);font-size:0.75rem;margin-top:0.25rem;display:block;">
              💡 Catatan ini akan langsung tampil di layar tugas siswa.
            </small>
          </div>
        </form>
      </div>
    `;

    document.getElementById('modal-action-btn').textContent = isZoom ? 'Konfirmasi Sesi Zoom' : 'Simpan Keputusan Review';
    document.getElementById('modal-action-btn').onclick = () => {
      document.getElementById('form-review-submission').requestSubmit();
    };
    const modal = document.getElementById('global-modal');
    if (modal) {
      modal.style.display = 'flex';
      modal.style.zIndex = '99999';
      modal.classList.add('active');
    }
  }

  window.openModalReviewSubmission = openModalReviewSubmission;

  window.submitTutorReview = async function(submissionId) {
    const decisionEl = document.querySelector('input[name="review_decision"]:checked');
    const decision = decisionEl ? decisionEl.value : 'approved';
    const scoreEl = document.getElementById('review-score');
    const scoreVal = scoreEl ? scoreEl.value : null;
    const feedbackVal = document.getElementById('review-feedback').value.trim();

    await handleTutorReviewSubmission(submissionId, decision, scoreVal, feedbackVal);
  };

  async function handleTutorReviewSubmission(submissionId, decision, score, feedback) {
    let sub = (AppState.submissions || []).find(s => s.id === submissionId || s.content_id === submissionId);
    if (!sub) return;

    setModalLoading(true, 'Menyimpan review...');
    try {
      sub.approval_status = decision;
      // Sesi Zoom murni evaluasi kehadiran/tatap muka tanpa skor nilai
      sub.score = sub.type === 'zoom' ? null : (score ? parseInt(score, 10) : (decision === 'approved' ? 90 : null));
      sub.tutor_feedback = feedback;
      sub.reviewed_at = new Date().toISOString();

      if (decision === 'approved') {
        if (sub.type === 'zoom') sub.schedule_status = 'completed';
        // Tandai unit selesai pada tabel progress untuk SISWA bersangkutan
        await dbMarkContentComplete(sub.content_id, sub.course_id, sub.student_id);
        
        // Update di AppState.courses
        const course = AppState.courses.find(c => c.id === sub.course_id) || AppState.activeCoursePlayer;
        const unit = course?.contents?.find(u => u.id === sub.content_id);
        if (unit) unit.completed = true;

        showToast(`🎉 Tugas peserta berhasil disetujui! Tema berikutnya otomatis terbuka.`, 'success');
      } else {
        // Jika perlu revisi, pastikan unit belum completed agar bab berikutnya tetap terkunci
        const course = AppState.courses.find(c => c.id === sub.course_id) || AppState.activeCoursePlayer;
        const unit = course?.contents?.find(u => u.id === sub.content_id);
        if (unit) unit.completed = false;

        showToast(`⚠️ Tugas dikembalikan untuk revisi. Siswa wajib mengulang mengerjakan tugas.`, 'warning');
      }

      await persistSubmission(sub);
      closeModal();

      if (AppState.currentView === 'tutor-approvals') {
        renderTutorApprovals(document.getElementById('view-container'));
      } else if (AppState.currentView === 'course-player' || AppState.activeCoursePlayer) {
        renderCoursePlayer(document.getElementById('view-container'), sub.course_id || AppState.activeCoursePlayer?.id);
      }
    } catch (err) {
      showToast('Gagal menyimpan review: ' + err.message, 'error');
    } finally {
      setModalLoading(false, 'Simpan Keputusan Review');
    }
  }

  window.handleTutorReviewSubmission = handleTutorReviewSubmission;

  function openModalConfirmZoomSchedule(submissionId) {
    const sub = (AppState.submissions || []).find(s => s.id === submissionId || s.content_id === submissionId);
    if (!sub) return;

    const curTime = sub.zoom_meeting_time ? new Date(sub.zoom_meeting_time) : new Date();
    const dateStr = curTime.toISOString().split('T')[0];
    const timeStr = `${String(curTime.getHours()).padStart(2, '0')}:${String(curTime.getMinutes()).padStart(2, '0')}`;

    document.getElementById('modal-title').textContent = `Konfirmasi Jadwal Zoom: ${sub.student_name}`;
    document.getElementById('modal-content').innerHTML = `
      <div>
        <p style="font-size:0.875rem;color:var(--tertiary);margin-bottom:1rem;">
          Pilih apakah Anda menyetujui usulan jadwal dari peserta atau menentukan jadwal pertemuan alternatif.
        </p>

        <form id="form-confirm-zoom" onsubmit="event.preventDefault(); submitConfirmZoomSchedule('${sub.id}')">
          <div class="form-group">
            <label class="form-label">Status Jadwal</label>
            <select id="zoom-schedule-action" class="form-control" onchange="toggleZoomRescheduleFields(this.value)">
              <option value="confirmed" selected>🤝 Setujui Jadwal Ini (Konfirmasi)</option>
              <option value="rescheduled">🔄 Jadwalkan Ulang (Tentukan Tanggal & Jam Lain)</option>
            </select>
          </div>

          <div id="zoom-reschedule-inputs" style="display:none;margin-top:1rem;">
            <div class="zoom-datetime-grid">
              <div class="form-group">
                <label class="form-label">Tanggal Baru</label>
                <input type="date" id="zoom-new-date" class="form-control" value="${dateStr}">
              </div>
              <div class="form-group">
                <label class="form-label">Jam Baru</label>
                <input type="time" id="zoom-new-time" class="form-control" value="${timeStr}">
              </div>
            </div>
          </div>

          <div style="margin-top:1rem;padding:0.875rem;background:#f8fafc;border-radius:8px;font-size:0.8125rem;color:var(--primary);">
            🔗 <strong>Ruang Zoom yang disiapkan peserta:</strong><br>
            <a href="${escHtml(sub.zoom_url || '#')}" target="_blank" rel="noopener noreferrer" style="color:var(--secondary-hover);">${escHtml(sub.zoom_url || '-')}</a>
          </div>
        </form>
      </div>
    `;

    document.getElementById('modal-action-btn').textContent = 'Simpan Jadwal';
    document.getElementById('modal-action-btn').onclick = () => {
      document.getElementById('form-confirm-zoom').requestSubmit();
    };
    const modal = document.getElementById('global-modal');
    if (modal) {
      modal.style.display = 'flex';
      modal.style.zIndex = '99999';
      modal.classList.add('active');
    }
  }

  window.openModalConfirmZoomSchedule = openModalConfirmZoomSchedule;

  window.toggleZoomRescheduleFields = function(val) {
    const el = document.getElementById('zoom-reschedule-inputs');
    if (el) el.style.display = val === 'rescheduled' ? 'block' : 'none';
  };

  window.submitConfirmZoomSchedule = async function(submissionId) {
    const act = document.getElementById('zoom-schedule-action').value;
    let newTime = null;
    if (act === 'rescheduled') {
      const d = document.getElementById('zoom-new-date').value;
      const t = document.getElementById('zoom-new-time').value;
      if (d && t) newTime = new Date(`${d}T${t}:00`).toISOString();
    }
    await handleTutorConfirmZoomSchedule(submissionId, act, newTime);
  };

  async function handleTutorConfirmZoomSchedule(submissionId, newStatus = 'confirmed', rescheduledTime = null) {
    const sub = (AppState.submissions || []).find(s => s.id === submissionId || s.content_id === submissionId);
    if (!sub) return;

    setModalLoading(true, 'Menyimpan jadwal...');
    try {
      sub.schedule_status = newStatus;
      if (rescheduledTime) {
        sub.zoom_meeting_time = rescheduledTime;
      }
      await persistSubmission(sub);
      showToast(`✅ Jadwal sesi Zoom telah berhasil ${newStatus === 'confirmed' ? 'dikonfirmasi' : 'dijadwalkan ulang'}!`, 'success');
      closeModal();
      if (AppState.currentView === 'tutor-approvals') {
        renderTutorApprovals(document.getElementById('view-container'));
      } else if (AppState.currentView === 'course-player' || AppState.activeCoursePlayer) {
        renderCoursePlayer(document.getElementById('view-container'), sub.course_id || AppState.activeCoursePlayer?.id);
      }
    } catch (e) {
      showToast('Gagal update jadwal: ' + e.message, 'error');
    } finally {
      setModalLoading(false, 'Simpan Jadwal');
    }
  }

  window.handleTutorConfirmZoomSchedule = handleTutorConfirmZoomSchedule;

  window.refreshApprovalsFromPlayer = async function(contentId, courseId) {
    showToast('Memperbarui data penugasan dari server...', 'info');
    const sb = typeof getSupabase === 'function' ? getSupabase() : null;
    await loadAssignmentSubmissions(sb);
    renderCoursePlayer(document.getElementById('view-container'), courseId);
    showToast('✅ Data penugasan siswa berhasil diperbarui.', 'success');
  };

  window.checkStudentApprovalStatus = async function(contentId, courseId) {
    showToast('Memeriksa status persetujuan dari Tutor...', 'info');
    const sb = typeof getSupabase === 'function' ? getSupabase() : null;
    if (sb) {
      await Promise.all([
        loadAssignmentSubmissions(sb),
        loadStudentProgress(sb)
      ]);
    }
    const targetCourseId = courseId || AppState.activeCoursePlayer?.id || AppState.courses[0]?.id;
    renderCoursePlayer(document.getElementById('view-container'), targetCourseId);
    showToast('✅ Status persetujuan tugas berhasil disinkronkan.', 'success');
  };

  window.demoTestApprovalModal = function(contentId, courseId) {
    const activeCourse = (courseId && AppState.courses.find(c => c.id === courseId)) || AppState.activeCoursePlayer || AppState.courses[0];
    const targetCourseId = activeCourse?.id || 'demo-course';
    const activeUnit = (contentId && activeCourse?.contents?.find(u => u.id === contentId)) || activeCourse?.contents?.find(u => (u.type || '').includes('tugas')) || activeCourse?.contents?.[0];
    const targetContentId = activeUnit?.id || contentId || 'demo-unit';

    let sub = (AppState.submissions || []).find(s => s.content_id === targetContentId);
    if (!sub) {
      sub = {
        id: createUUID(),
        course_id: targetCourseId,
        content_id: targetContentId,
        student_id: AppState.students[0]?.id || 'demo-student-id',
        student_name: AppState.students[0]?.name || 'FAJRI PERTAMA',
        student_email: AppState.students[0]?.email || 'lindasolehuddin@gmail.com',
        type: 'drive',
        drive_url: 'https://drive.google.com/test-tugas-siswa',
        student_notes: 'Tugas praktik mandiri saya mohon diperiksa coach.',
        approval_status: 'pending',
        score: null,
        tutor_feedback: ''
      };
      if (!AppState.submissions) AppState.submissions = [];
      AppState.submissions.unshift(sub);
    }
    openModalReviewSubmission(sub.id);
  };

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

  async function dbAddContent({ courseId, title, type, duration, embedUrl, contentBody, sectionName, orderIndex, quizData, passingScore }) {
    const sb = getSupabase();
    if (!sb) throw new Error('Supabase tidak tersedia');

    let bodyToSave = contentBody || '';
    let payloadType = type;

    // Coba insert pertama kali
    let res = await sb.from('course_contents').insert([{
      course_id: courseId,
      title,
      type: payloadType,
      duration: duration || '10 Menit',
      embed_url: embedUrl || null,
      content_body: bodyToSave,
      section_name: sectionName || '',
      order_index: orderIndex || 1,
      quiz_data: quizData || null,
      passing_score: passingScore || 70
    }]).select().single();

    // Fallback otomatis jika skema database belum diperbarui constraint-nya untuk 'tugas_drive' / 'tugas_zoom'
    if (res.error && (res.error.code === '23514' || res.error.message?.includes('course_contents_type_check'))) {
      console.warn('DB constraint type_check terpicu untuk type:', type, 'Melakukan fallback ke type "tugas" dengan metadata tag...');
      if (type === 'tugas_drive' || type === 'tugas_zoom') {
        payloadType = 'tugas';
        if (!bodyToSave.includes(`<!--TYPE:${type}-->`)) {
          bodyToSave = `<!--TYPE:${type}-->\n` + bodyToSave;
        }
        res = await sb.from('course_contents').insert([{
          course_id: courseId,
          title,
          type: payloadType,
          duration: duration || '10 Menit',
          embed_url: embedUrl || null,
          content_body: bodyToSave,
          section_name: sectionName || '',
          order_index: orderIndex || 1,
          quiz_data: quizData || null,
          passing_score: passingScore || 70
        }]).select().single();
      }
    }

    if (res.error) throw res.error;
    return { ...res.data, type: type, content_body: bodyToSave };
  }

  async function dbEditContent(contentId, { title, type, duration, embedUrl, contentBody, sectionName, quizData, passingScore }) {
    const sb = getSupabase();
    if (!sb) throw new Error('Supabase tidak tersedia');

    let bodyToSave = contentBody || '';
    let payloadType = type;

    const updatePayload = {
      title,
      type: payloadType,
      duration: duration || '10 Menit',
      embed_url: embedUrl || null,
      content_body: bodyToSave
    };
    if (sectionName !== undefined) updatePayload.section_name = sectionName;
    if (quizData !== undefined) updatePayload.quiz_data = quizData;
    if (passingScore !== undefined) updatePayload.passing_score = passingScore;

    let res = await sb.from('course_contents').update(updatePayload).eq('id', contentId);
    if (res.error && (res.error.code === '23514' || res.error.message?.includes('course_contents_type_check'))) {
      console.warn('DB constraint type_check terpicu saat edit:', type, 'Melakukan fallback ke type "tugas"...');
      if (type === 'tugas_drive' || type === 'tugas_zoom') {
        updatePayload.type = 'tugas';
        if (!bodyToSave.includes(`<!--TYPE:${type}-->`)) {
          bodyToSave = `<!--TYPE:${type}-->\n` + bodyToSave;
          updatePayload.content_body = bodyToSave;
        }
        res = await sb.from('course_contents').update(updatePayload).eq('id', contentId);
      }
    }
    if (res.error) throw res.error;
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

  async function dbMarkContentComplete(contentId, courseId, targetStudentId = null) {
    const sb = getSupabase();
    const studentId = targetStudentId || AppState.user?.id;
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

  async function dbSubmitQuizResult({ contentId, courseId, score, correctAnswers, wrongAnswers, timeSpentSeconds, notes, reviewData = null }) {
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
      answers_data: reviewData,
      completed_at: new Date().toISOString()
    }], { onConflict: 'student_id,content_id' });
    if (error) throw error;
  }

  /* =========================================================
   * NAVIGATION & ROUTING
   * ========================================================= */
  function navigateTo(viewId, param = null) {
    if (viewId !== 'course-player') {
      clearActiveStudyTimer();
      clearQuizCountdownTimer();
    }
    AppState.currentView = viewId;
    try {
      localStorage.setItem('lms_last_active_route', JSON.stringify({
        viewId,
        param,
        role: AppState.currentRole,
        unitIndex: AppState.activeUnitIndex
      }));
    } catch (e) {}

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
    const bcCurrent = document.getElementById('bc-current-page');

    const viewTitles = {
      'admin-dashboard': 'Dasbor Utama',
      'educator-dashboard': 'Katalog Modul',
      'student-dashboard': 'Ruang Belajar',
      'student-management': 'Kelola Siswa',
      'tutor-approvals': 'Persetujuan Tugas',
      'progress-report': 'Laporan Capaian',
      'course-player': 'Pembelajaran Aktif',
      'course-editor': 'Kurikulum Editor',
      'student-assignments': 'Daftar Tugas Saya'
    };
    if (bcCurrent) {
      bcCurrent.textContent = viewTitles[viewId] || 'Portal';
    }

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
      case 'tutor-approvals':
        titleEl.textContent = 'Pusat Persetujuan Tugas & Mentoring Zoom';
        renderTutorApprovals(container);
        if (typeof getSupabase === 'function' && getSupabase()) {
          loadAssignmentSubmissions(getSupabase()).then(() => {
            if (AppState.currentView === 'tutor-approvals') {
              renderTutorApprovals(container);
            }
          });
        }
        break;
      case 'student-assignments':
        titleEl.textContent = 'Status Tugas & Jadwal Zoom Saya';
        renderStudentAssignments(container);
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
   * ROLE SWITCHER (Deprecated — Peran ditentukan oleh akun)
   * ========================================================= */
  async function setRole(role) {
    console.info('Peran LMS ditentukan berdasarkan autentikasi akun aktif:', role);
  }

  /* =========================================================
   * SIDEBAR BUILDERS
   * ========================================================= */
  function buildSidebarForAdmin() {
    const nav = document.getElementById('sidebar-nav-container');
    const pendingCount = (AppState.submissions || []).filter(s => s.approval_status === 'pending').length;

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
      <a class="nav-item" data-view="tutor-approvals" onclick="navigateTo('tutor-approvals')">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"></path><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>
        <span>Persetujuan Tugas & Zoom</span>
        <span class="nav-badge-count ${pendingCount > 0 ? '' : 'zero'}" id="sidebar-approval-badge">${pendingCount}</span>
      </a>
      <a class="nav-item" data-view="progress-report" onclick="navigateTo('progress-report')">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
        <span>Audit Capaian & PDF</span>
      </a>
      <div class="nav-group-title">SIMULASI & PRESENTASI</div>
      <a class="nav-item" data-view="course-player" onclick="navigateTo('course-player', AppState.courses[0]?.id)">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
        <span>Mode Fullscreen</span>
      </a>
    `;
  }

  function buildSidebarForEducator() {
    const nav = document.getElementById('sidebar-nav-container');
    const tutorId = AppState.user?.id;
    const tutorName = AppState.user?.name;
    const myCourseIds = AppState.courses
      .filter(c => c.authorId === tutorId || c.author_id === tutorId || c.instructor_id === tutorId || c.authorName === tutorName)
      .map(c => c.id);
    const pendingCount = (AppState.submissions || [])
      .filter(s => s.approval_status === 'pending' && myCourseIds.includes(s.course_id))
      .length;

    nav.innerHTML = `
      <div class="nav-group-title">RUANG KERJA TUTOR</div>
      <a class="nav-item active" data-view="educator-dashboard" onclick="navigateTo('educator-dashboard')">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
        <span>Katalog Course Saya</span>
      </a>
      <a class="nav-item" data-view="tutor-approvals" onclick="navigateTo('tutor-approvals')">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"></path><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>
        <span>Persetujuan Tugas & Zoom</span>
        <span class="nav-badge-count ${pendingCount > 0 ? '' : 'zero'}" id="sidebar-approval-badge">${pendingCount}</span>
      </a>
      <a class="nav-item" data-view="progress-report" onclick="navigateTo('progress-report')">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
        <span>Laporan & Ekspor PDF</span>
      </a>
      <div class="nav-group-title">SIMULASI KELAS</div>
      <a class="nav-item" data-view="course-player" onclick="navigateTo('course-player', AppState.courses[0]?.id)">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
        <span>Mode Fullscreen</span>
      </a>
    `;
  }

  function buildSidebarForStudent() {
    const nav = document.getElementById('sidebar-nav-container');
    nav.innerHTML = `
      <div class="nav-group-title">PEMBELAJARAN</div>
      <a class="nav-item active" data-view="student-dashboard" onclick="navigateTo('student-dashboard')">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
        <span>Course Terdaftar</span>
      </a>
      <a class="nav-item" data-view="student-assignments" onclick="navigateTo('student-assignments')">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
        <span>Tugas & Jadwal Zoom Saya</span>
      </a>
      <a class="nav-item" data-view="progress-report" onclick="navigateTo('progress-report')">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
        <span>Capaian Belajar Saya</span>
      </a>
    `;
  }

  function buildLogoutButton() {
    // Tombol logout di sidebar ditiadakan agar tidak duplikat dengan tombol logout di pojok kanan atas navbar
    return '';
  }

  /* =========================================================
   * VIEW RENDERERS
   * ========================================================= */

  // 1. Educator Dashboard
  function renderEducatorDashboard(container) {
    const isEducator = AppState.currentRole === 'educator';
    const tutorId = AppState.user?.id;
    const tutorName = AppState.user?.name;
    const myCourses = isEducator
      ? AppState.courses.filter(c => c.authorId === tutorId || c.author_id === tutorId || c.instructor_id === tutorId || c.authorName === tutorName)
      : AppState.courses;
    const myCourseIds = myCourses.map(c => c.id);

    if (myCourses.length === 0) {
      container.innerHTML = `
        <div style="text-align:center;padding:4rem 2rem;">
          <div style="font-size:3rem;margin-bottom:1rem;">📚</div>
          <h2 style="margin-bottom:.5rem;">Belum Ada Course ${isEducator ? 'Anda' : ''}</h2>
          <p style="color:var(--tertiary);margin-bottom:1.5rem;">Buat course pertama Anda untuk mulai berbagi materi pembelajaran.</p>
          <button class="btn btn-authoritative" onclick="openModalCreateCourse()">
            + Buat Course Baru
          </button>
        </div>
      `;
      return;
    }

    const coursesHtml = myCourses.map(c => `
      <div class="card-course-elevated">
        <div>
          <div class="course-cover-container" style="background:${c.coverGradient || 'linear-gradient(135deg, #1e3a5f 0%, #0f766e 100%)'};">
            <span class="badge" style="align-self:flex-start;background:rgba(255,255,255,0.25);color:#fff;backdrop-filter:blur(6px);font-weight:600;font-size:0.75rem;">${c.status || 'Aktif'}</span>
            <div style="display:flex;align-items:center;justify-content:space-between;width:100%;">
              <span style="font-size:0.75rem;opacity:0.95;font-weight:500;">📚 ${c.contents.length} Unit Konten</span>
              <span style="font-size:0.75rem;font-weight:700;background:rgba(0,0,0,0.25);padding:0.15rem 0.45rem;border-radius:10px;">👥 ${c.enrolledStudents || 0} Siswa</span>
            </div>
          </div>
          <div style="padding:1.25rem 1.25rem 0.75rem;">
            <h3 style="font-size:1.1rem;margin-bottom:0.4rem;line-height:1.35;color:var(--primary-dark);font-family:var(--font-heading);">${escHtml(c.title)}</h3>
            <p style="font-size:0.8125rem;line-height:1.5;margin-bottom:1rem;color:var(--tertiary);">${escHtml(c.description || 'Modul kurikulum pembelajaran interaktif.')}</p>
          </div>
        </div>
        <div style="padding:0 1.25rem 1.25rem;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.85rem;font-size:0.75rem;color:var(--tertiary);">
            <span>📅 Dibuat: ${c.createdAt || '-'}</span>
          </div>
          <div style="display:flex;gap:0.4rem;flex-wrap:wrap;">
            <button class="btn btn-outline btn-sm" style="flex:1;min-width:110px;" onclick="navigateTo('course-editor','${c.id}')">
              📚 Kelola Modul
            </button>
            <button class="btn btn-outline btn-sm" onclick="openModalEditCourse('${c.id}')" title="Edit Informasi Course">
              ✏️ Edit
            </button>
            <button class="btn btn-primary btn-sm" onclick="navigateTo('course-player','${c.id}')">
              ▶ Putar
            </button>
            ${!isEducator ? `
            <button class="btn btn-ghost btn-sm" onclick="openEnrollModal('${c.id}')" title="Kelola Enrollment" style="color:var(--secondary);">
              👥
            </button>` : ''}
            <button class="btn btn-ghost btn-sm" onclick="confirmDeleteCourse('${c.id}')" title="Hapus Course" style="color:var(--error);">
              🗑️
            </button>
          </div>
        </div>
      </div>
    `).join('');

    const totalUnits = myCourses.reduce((s, c) => s + c.contents.length, 0);
    const totalStudents = isEducator
      ? myCourses.reduce((s, c) => s + (c.enrolledStudents || 0), 0)
      : AppState.students.length;
    const pendingApprovalsCount = (AppState.submissions || []).filter(s => {
      if (s.approval_status !== 'pending') return false;
      if (isEducator && myCourseIds) return myCourseIds.includes(s.course_id);
      return true;
    }).length;

    const hour = new Date().getHours();
    const timeGreeting = hour < 11 ? 'Selamat Pagi' : (hour < 15 ? 'Selamat Siang' : (hour < 18 ? 'Selamat Sore' : 'Selamat Malam'));
    const bannerHtml = `
      <div class="dashboard-greeting-banner">
        <div class="greeting-text">
          <h2>${timeGreeting}, ${escHtml(tutorName || 'Tutor Pengampu')}! 👨‍🏫</h2>
          <p>Portal Pengampu Kelas & Kurikulum Akademik. Pantau capaian peserta dan kelola materi ajar interaktif.</p>
        </div>
        <div class="greeting-chips-row">
          <div class="greeting-chip">
            <span>📚 ${myCourses.length} Modul Aktif</span>
          </div>
          <div class="greeting-chip">
            <span>👥 ${totalStudents} Siswa Diampu</span>
          </div>
          ${pendingApprovalsCount > 0 ? `
            <div class="greeting-chip" style="background:#ef4444;border-color:#f87171;color:#fff;">
              <span>⚡ ${pendingApprovalsCount} Menunggu Persetujuan</span>
            </div>
          ` : ''}
        </div>
      </div>
    `;

    container.innerHTML = `
      ${bannerHtml}

      <div class="grid-stats" style="grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));margin-bottom:1.75rem;">
        <div class="stat-card-elevated">
          <div class="stat-icon-glass" style="background:#dbeafe;color:#1d4ed8;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
          </div>
          <div>
            <div class="stat-val-huge">${AppState.courses.length}</div>
            <div class="stat-lbl-sub">Total Course Aktif</div>
          </div>
        </div>
        <div class="stat-card-elevated">
          <div class="stat-icon-glass" style="background:#ccfbf1;color:#0f766e;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle></svg>
          </div>
          <div>
            <div class="stat-val-huge">${totalStudents}</div>
            <div class="stat-lbl-sub">Peserta Didik Diampu</div>
          </div>
        </div>
        <div class="stat-card-elevated">
          <div class="stat-icon-glass" style="background:#fef3c7;color:#b45309;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
          </div>
          <div>
            <div class="stat-val-huge">${totalUnits}</div>
            <div class="stat-lbl-sub">Total Unit Materi</div>
          </div>
        </div>
        <div class="stat-card-elevated" onclick="navigateTo('tutor-approvals')" style="cursor:pointer;border:${pendingApprovalsCount > 0 ? '2px solid #818cf8;background:#f5f3ff;' : '1px solid var(--border);'}" title="Klik untuk membuka Pusat Persetujuan Tugas">
          <div class="stat-icon-glass" style="background:#ede9fe;color:#4f46e5;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"></path><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>
          </div>
          <div>
            <div class="stat-val-huge" style="${pendingApprovalsCount > 0 ? 'color:#4f46e5;font-weight:800;' : ''}">${pendingApprovalsCount}</div>
            <div class="stat-lbl-sub" style="font-weight:600;color:${pendingApprovalsCount > 0 ? '#4338ca' : 'inherit'};">Persetujuan Tugas ↗</div>
          </div>
        </div>
      </div>

      ${pendingApprovalsCount > 0 ? `
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:1.15rem 1.35rem;margin-bottom:1.5rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.75rem;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
          <div style="display:flex;align-items:center;gap:0.75rem;">
            <span style="font-size:1.75rem;">📝</span>
            <div>
              <strong style="color:#1e40af;font-size:1rem;display:block;">Ada ${pendingApprovalsCount} pengajuan tugas peserta didik menunggu persetujuan Anda!</strong>
              <span style="font-size:0.8125rem;color:#3b82f6;">Setujui tugas Drive atau jadwal Zoom siswa agar bab materi berikutnya dapat diakses.</span>
            </div>
          </div>
          <button class="btn btn-primary btn-sm" onclick="navigateTo('tutor-approvals')" style="font-weight:700;padding:0.45rem 1rem;">
            ⚡ Buka Persetujuan Tugas (${pendingApprovalsCount}) →
          </button>
        </div>
      ` : ''}

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
        <td><strong>${e.totalCourses}</strong> Modul</td>
        <td>
          <span class="badge ${e.status === 'Nonaktif' ? 'badge-draft' : 'badge-success'}">
            <span class="${e.status === 'Nonaktif' ? 'status-dot-inactive' : 'status-dot-active'}"></span>
            ${escHtml(e.status || 'Aktif')}
          </span>
        </td>
        <td style="display:flex;gap:.375rem;align-items:center;">
          <button class="btn btn-outline btn-sm" onclick="openModalEditEducator('${e.id}','${escHtml(e.name)}','${escHtml(e.subject)}','${escHtml(e.email || '')}','${escHtml(e.status || 'Aktif')}')">✏️ Edit</button>
          <button class="btn btn-authoritative btn-sm" onclick="openModalCreateCourse('${e.id}','${escHtml(e.name)}')">+ Course</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--error);" onclick="confirmDeleteEducator('${e.id}','${escHtml(e.name)}')">🗑️</button>
        </td>
      </tr>
    `).join('');

    const allCoursesList = AppState.courses.map(c => `
      <div class="course-admin-item" style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:1rem 1.25rem;margin-bottom:.75rem;display:flex;align-items:center;justify-content:space-between;box-shadow:var(--shadow-1);">
        <div style="display:flex;align-items:center;gap:.75rem;">
          <div style="width:10px;height:10px;border-radius:50%;background:var(--secondary);flex-shrink:0;box-shadow:0 0 6px var(--secondary);"></div>
          <div>
            <strong style="font-size:.95rem;color:var(--primary);">${escHtml(c.title)}</strong>
            <div style="font-size:.775rem;color:var(--tertiary);margin-top:0.15rem;">Pengampu: <b>${escHtml(c.authorName)}</b> | 📚 ${c.contents.length} Unit | 👥 ${c.enrolledStudents} Siswa Terdaftar</div>
          </div>
        </div>
        <div class="course-admin-actions" style="display:flex;gap:.4rem;">
          <button class="btn btn-outline btn-sm" onclick="navigateTo('course-editor','${c.id}')">📚 Kurikulum</button>
          <button class="btn btn-outline btn-sm" onclick="openModalEditCourse('${c.id}')">✏️ Edit</button>
          <button class="btn btn-primary btn-sm" onclick="navigateTo('course-player','${c.id}')">▶ Putar</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--secondary);" onclick="openEnrollModal('${c.id}')" title="Kelola Enrollment Siswa">👥 Enrol</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--error);" onclick="confirmDeleteCourse('${c.id}')" title="Hapus Course">🗑️</button>
        </div>
      </div>
    `).join('');

    const hour = new Date().getHours();
    const timeGreeting = hour < 11 ? 'Selamat Pagi' : (hour < 15 ? 'Selamat Siang' : (hour < 18 ? 'Selamat Sore' : 'Selamat Malam'));
    const adminBannerHtml = `
      <div class="dashboard-greeting-banner">
        <div class="greeting-text">
          <h2>${timeGreeting}, Super Administrator! 🏛️</h2>
          <p>Pusat Komando & Tata Kelola Pembelajaran CourseHub LMS. Kendalikan seluruh kurikulum, pendidik, dan rombel institusi.</p>
        </div>
        <div class="greeting-chips-row">
          <div class="greeting-chip">
            <span>📚 ${AppState.courses.length} Course Aktif</span>
          </div>
          <div class="greeting-chip">
            <span>👨‍🏫 ${AppState.educators.length} Guru Pengampu</span>
          </div>
          <div class="greeting-chip">
            <span>👥 ${AppState.students.length} Peserta Terdaftar</span>
          </div>
        </div>
      </div>
    `;

    container.innerHTML = `
      ${adminBannerHtml}

      <div class="grid-stats" style="grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));margin-bottom:1.75rem;">
        <div class="stat-card-elevated">
          <div class="stat-icon-glass" style="background:#e0e7ff;color:#3730a3;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
          </div>
          <div>
            <div class="stat-val-huge">${AppState.educators.length}</div>
            <div class="stat-lbl-sub">Total Guru / Pendidik</div>
          </div>
        </div>
        <div class="stat-card-elevated">
          <div class="stat-icon-glass" style="background:#ccfbf1;color:#0f766e;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
          </div>
          <div>
            <div class="stat-val-huge">${AppState.courses.length}</div>
            <div class="stat-lbl-sub">Total Course Institusi</div>
          </div>
        </div>
        <div class="stat-card-elevated">
          <div class="stat-icon-glass" style="background:#dbeafe;color:#1d4ed8;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle></svg>
          </div>
          <div>
            <div class="stat-val-huge">${AppState.students.length}</div>
            <div class="stat-lbl-sub">Total Peserta Didik</div>
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

    const totalUnits = (course.contents || []).length;
    const unitsList = (course.contents || []).map((u, idx) => `
      <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:0.9rem 1.1rem;margin-bottom:.75rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.75rem;box-shadow:var(--shadow-1);">
        <div style="display:flex;align-items:center;gap:.75rem;flex:1;min-width:280px;">
          <!-- Kontrol Pengatur Urutan Materi (Naik / Turun / Pilih Posisi) -->
          <div style="display:flex;align-items:center;gap:0.3rem;">
            <button class="btn btn-outline btn-sm" onclick="moveContentOrder('${course.id}','${u.id}', -1)" title="Pindahkan Urutan ke Atas (Sebelumnya)" ${idx === 0 ? 'disabled style="opacity:.25;padding:0.25rem 0.45rem;"' : 'style="padding:0.25rem 0.45rem;"'}>⬆️</button>
            <button class="btn btn-outline btn-sm" onclick="moveContentOrder('${course.id}','${u.id}', 1)" title="Pindahkan Urutan ke Bawah (Setelahnya)" ${idx === totalUnits - 1 ? 'disabled style="opacity:.25;padding:0.25rem 0.45rem;"' : 'style="padding:0.25rem 0.45rem;"'}>⬇️</button>
            <select class="form-control" style="width:68px;padding:0.2rem 0.35rem;height:30px;font-size:0.75rem;font-weight:700;" onchange="moveContentToPos('${course.id}','${u.id}', this.value)" title="Ubah langsung ke nomor urutan">
              ${course.contents.map((_, pIdx) => `<option value="${pIdx + 1}" ${pIdx === idx ? 'selected' : ''}>#${pIdx + 1}</option>`).join('')}
            </select>
          </div>

          <span class="badge badge-${(u.type || 'materi').toLowerCase()}">${u.type}</span>
          <div>
            <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
              <strong style="font-size:.9375rem;color:var(--primary);">${escHtml(u.title)}</strong>
              ${u.sectionName ? `<span class="badge" style="background:#f1f5f9;color:#475569;font-size:0.72rem;font-weight:600;">📁 ${escHtml(u.sectionName)}</span>` : ''}
            </div>
            <div style="font-size:.75rem;color:var(--tertiary);margin-top:0.2rem;">⏱️ Estimasi: ${escHtml(u.duration || '10 Menit')} • Posisi Urutan #${idx + 1}</div>
          </div>
        </div>
        <div style="display:flex;gap:.5rem;align-items:center;">
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
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
          <div>
            <h3 style="margin:0;font-size:1.125rem;">Urutan Alur Materi (${course.contents.length} Unit)</h3>
            <p style="margin:0.25rem 0 0;font-size:0.8125rem;color:var(--tertiary);">Gunakan tombol ⬆️ ⬇️ atau dropdown angka posisi untuk mengatur urutan materi dengan mudah tanpa membuat ulang.</p>
          </div>
        </div>
        ${unitsList || '<p style="color:var(--tertiary);text-align:center;padding:2rem;">Belum ada unit konten. Tambahkan unit pertama!</p>'}
      </div>
    `;
  }

  async function moveContentOrder(courseId, contentId, delta) {
    const course = AppState.courses.find(c => c.id === courseId);
    if (!course || !course.contents) return;

    const currentIdx = course.contents.findIndex(u => u.id === contentId);
    if (currentIdx === -1) return;

    const targetIdx = currentIdx + delta;
    if (targetIdx < 0 || targetIdx >= course.contents.length) return;

    const item = course.contents.splice(currentIdx, 1)[0];
    course.contents.splice(targetIdx, 0, item);

    await persistContentsOrder(course);
    renderCourseEditor(document.getElementById('view-container'), courseId);
    showToast(`✅ Urutan materi "${item.title}" dipindahkan ke posisi #${targetIdx + 1}`, 'success');
  }
  window.moveContentOrder = moveContentOrder;

  async function moveContentToPos(courseId, contentId, targetPosStr) {
    const course = AppState.courses.find(c => c.id === courseId);
    if (!course || !course.contents) return;

    const currentIdx = course.contents.findIndex(u => u.id === contentId);
    if (currentIdx === -1) return;

    let targetIdx = parseInt(targetPosStr, 10) - 1;
    if (isNaN(targetIdx)) return;
    targetIdx = Math.max(0, Math.min(course.contents.length - 1, targetIdx));
    if (targetIdx === currentIdx) return;

    const item = course.contents.splice(currentIdx, 1)[0];
    course.contents.splice(targetIdx, 0, item);

    await persistContentsOrder(course);
    renderCourseEditor(document.getElementById('view-container'), courseId);
    showToast(`✅ Urutan materi "${item.title}" dipindahkan ke posisi #${targetIdx + 1}`, 'success');
  }
  window.moveContentToPos = moveContentToPos;

  async function persistContentsOrder(course) {
    if (!course || !course.contents) return;
    course.contents.forEach((u, i) => {
      u.order_index = i + 1;
    });

    const sb = typeof getSupabase === 'function' ? getSupabase() : null;
    if (sb && !AppState.isDemoMode) {
      try {
        const updates = course.contents.map((u, i) => 
          sb.from('course_contents').update({ order_index: i + 1 }).eq('id', u.id)
        );
        await Promise.all(updates);
      } catch (err) {
        console.warn('Gagal sinkronkan urutan konten ke database:', err);
      }
    }
  }
  window.persistContentsOrder = persistContentsOrder;

  // 4. Student Management (Khusus Administrator)
  function renderStudentManagement(container) {
    if (AppState.currentRole !== 'admin') {
      showToast('⛔ Akses dibatasi: Hanya Administrator yang berwenang mengelola seluruh data peserta didik.', 'warning');
      navigateTo('educator-dashboard');
      return;
    }

    const rows = AppState.students.map(s => `
      <tr>
        <td style="font-weight:600;color:var(--primary);">${escHtml(s.name)}</td>
        <td>${escHtml(s.email)}</td>
        <td><span class="badge badge-draft">${escHtml(s.class)}</span></td>
        <td>
          <span class="badge ${s.status === 'Nonaktif' ? 'badge-draft' : 'badge-success'}">
            <span class="${s.status === 'Nonaktif' ? 'status-dot-inactive' : 'status-dot-active'}"></span>
            ${escHtml(s.status || 'Aktif')}
          </span>
        </td>
        <td style="display:flex;gap:.375rem;flex-wrap:wrap;">
          <button class="btn btn-outline btn-sm" onclick="openModalEditStudent('${s.id}','${escHtml(s.name)}','${escHtml(s.email)}','${escHtml(s.class || '')}','${escHtml(s.status || 'Aktif')}');">✏️ Edit</button>
          <button class="btn btn-outline btn-sm" onclick="openModalEnrollStudent('${s.id}','${escHtml(s.name)}')">Daftarkan ke Course</button>
          <button class="btn btn-ghost btn-sm" onclick="navigateTo('progress-report')">Lihat Nilai</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--error);" onclick="confirmDeleteStudent('${s.id}','${escHtml(s.name)}')" title="Hapus Akun Siswa">🗑️ Hapus</button>
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
        <div style="text-align:center;padding:4rem 2rem;background:#fff;border-radius:12px;border:1px dashed #cbd5e1;box-shadow:var(--shadow-1);margin-top:1rem;">
          <div style="font-size:3.5rem;margin-bottom:1rem;">📖</div>
          <h2 style="font-size:1.4rem;color:var(--primary-dark);margin-bottom:0.5rem;">Belum Terdaftar di Kursus Manapun</h2>
          <p style="color:var(--tertiary);margin:0 auto 1.5rem;max-width:500px;line-height:1.6;">
            Akun Anda belum terdaftar di kelas/kursus aktif. Silakan hubungi guru pengampu atau administrator akademik untuk didaftarkan ke materi kurikulum.
          </p>
        </div>
      `;
      return;
    }

    let totalCompletedUnits = 0;
    let totalUnits = 0;
    let completedCoursesCount = 0;
    let totalProgressSum = 0;

    const coursesHtml = enrolledCourses.map(c => {
      const completedCount = c.contents.filter(u => u.completed).length;
      const total = c.contents.length;
      const pct = total > 0 ? Math.round((completedCount / total) * 100) : 0;
      
      totalCompletedUnits += completedCount;
      totalUnits += total;
      totalProgressSum += pct;
      if (pct === 100 && total > 0) completedCoursesCount++;

      let statusBadge = `<span class="badge" style="background:rgba(255,255,255,0.28);color:#fff;backdrop-filter:blur(6px);font-weight:600;font-size:0.75rem;">🚀 Belum Dimulai</span>`;
      if (pct === 100) {
        statusBadge = `<span class="badge" style="background:#10b981;color:#fff;font-weight:700;font-size:0.75rem;">✅ Selesai Tuntas</span>`;
      } else if (pct > 0) {
        statusBadge = `<span class="badge" style="background:#f59e0b;color:#fff;font-weight:700;font-size:0.75rem;">📖 Sedang Belajar (${pct}%)</span>`;
      }

      return `
        <div class="card-course-elevated">
          <div>
            <div class="course-cover-container" style="background:${c.coverGradient || 'linear-gradient(135deg, #1e3a5f 0%, #0f766e 100%)'};">
              <div style="display:flex;align-items:center;justify-content:space-between;width:100%;">
                ${statusBadge}
                <span style="font-size:0.75rem;background:rgba(0,0,0,0.25);padding:0.2rem 0.5rem;border-radius:10px;color:#fff;font-weight:500;">
                  📚 ${total} Unit
                </span>
              </div>
              <div style="font-size:0.8rem;color:#fff;opacity:0.95;font-weight:500;display:flex;align-items:center;gap:0.35rem;">
                <span>👨‍🏫</span> ${escHtml(c.authorName || 'Tutor Pengampu')}
              </div>
            </div>
            <div style="padding:1.25rem 1.25rem 0.75rem;">
              <h3 style="font-size:1.1rem;margin-bottom:0.4rem;line-height:1.35;color:var(--primary-dark);font-family:var(--font-heading);">${escHtml(c.title)}</h3>
              <p style="font-size:0.8125rem;line-height:1.5;margin-bottom:1rem;color:var(--tertiary);">${escHtml(c.description || 'Modul pembelajaran terstruktur interaktif.')}</p>
              
              <div style="margin-bottom:0.5rem;">
                <div style="display:flex;justify-content:space-between;align-items:center;font-size:0.75rem;margin-bottom:0.375rem;">
                  <span style="color:var(--tertiary);font-weight:600;">Capaian Unit Materi</span>
                  <strong style="color:var(--primary-dark);">${completedCount} dari ${total} Unit (${pct}%)</strong>
                </div>
                <div class="progress-track" style="height:7px;">
                  <div class="progress-fill" style="width:${pct}%;background:${pct === 100 ? '#10b981' : 'var(--secondary)'};"></div>
                </div>
              </div>
            </div>
          </div>
          <div style="padding:0 1.25rem 1.25rem;">
            <button class="btn ${pct === 100 ? 'btn-outline' : 'btn-primary'}" style="width:100%;font-weight:600;padding:0.65rem 1rem;" onclick="navigateTo('course-player','${c.id}')">
              ${pct === 100 ? '✅ Lihat Kembali Materi' : (pct > 0 ? 'Lanjutkan Pembelajaran →' : 'Mulai Pembelajaran →')}
            </button>
          </div>
        </div>
      `;
    }).join('');

    const avgProgress = enrolledCourses.length > 0 ? Math.round(totalProgressSum / enrolledCourses.length) : 0;
    const hour = new Date().getHours();
    const timeGreeting = hour < 11 ? 'Selamat Pagi' : (hour < 15 ? 'Selamat Siang' : (hour < 18 ? 'Selamat Sore' : 'Selamat Malam'));
    const studentName = escHtml(AppState.user?.name?.split(' ')[0] || 'Peserta Didik');

    const bannerHtml = `
      <div class="dashboard-greeting-banner">
        <div class="greeting-text">
          <h2>${timeGreeting}, ${studentName}! 🎓</h2>
          <p>Portal Belajar Peserta Didik. Akses unit kurikulum, tonton video pembelajaran, dan selesaikan evaluasi kompetensi.</p>
        </div>
        <div class="greeting-chips-row">
          <div class="greeting-chip">
            <span>📚 ${enrolledCourses.length} Kursus Terdaftar</span>
          </div>
          <div class="greeting-chip">
            <span>✅ ${completedCoursesCount} Kursus Diselesaikan</span>
          </div>
          <div class="greeting-chip">
            <span>🎯 ${avgProgress}% Rata-rata Progres</span>
          </div>
        </div>
      </div>
    `;

    container.innerHTML = `
      ${bannerHtml}

      <div class="grid-stats" style="grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));margin-bottom:1.75rem;">
        <div class="stat-card-elevated">
          <div class="stat-icon-glass" style="background:#dbeafe;color:#1d4ed8;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
          </div>
          <div>
            <div class="stat-val-huge">${enrolledCourses.length}</div>
            <div class="stat-lbl-sub">Kursus Terdaftar</div>
          </div>
        </div>
        <div class="stat-card-elevated">
          <div class="stat-icon-glass" style="background:#ccfbf1;color:#0f766e;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>
          </div>
          <div>
            <div class="stat-val-huge">${totalCompletedUnits} / ${totalUnits}</div>
            <div class="stat-lbl-sub">Unit Materi Tuntas</div>
          </div>
        </div>
        <div class="stat-card-elevated">
          <div class="stat-icon-glass" style="background:#fef3c7;color:#b45309;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
          </div>
          <div>
            <div class="stat-val-huge">${avgProgress}%</div>
            <div class="stat-lbl-sub">Rata-rata Capaian</div>
          </div>
        </div>
      </div>

      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;">
        <div>
          <h3 style="font-size:1.15rem;margin:0 0 0.25rem;color:var(--primary-dark);font-family:var(--font-heading);">Modul Pembelajaran Anda</h3>
          <p style="margin:0;font-size:0.8125rem;color:var(--tertiary);">Klik salah satu kursus di bawah untuk membuka ruang belajar.</p>
        </div>
      </div>

      <div class="grid-courses">${coursesHtml}</div>
    `;
  }

  // 6. Course Player (Hierarchical Multi-Level Curriculum)
  function parseDurationSeconds(durStr, contentBody = '') {
    if (durStr && typeof durStr === 'string') {
      const str = durStr.toLowerCase();
      const match = str.match(/\d+(\.\d+)?/);
      if (match) {
        const val = parseFloat(match[0]);
        if (str.includes('detik') || str.includes('sec')) {
          return Math.max(5, Math.round(val));
        }
        if (str.includes('jam') || str.includes('hour')) {
          return Math.max(60, Math.round(val * 3600));
        }
        return Math.max(10, Math.round(val * 60));
      }
    }
    // Estimasi cerdas jika durasi belum diisi: hitung kata bacaan (180 kata/menit)
    if (contentBody && typeof contentBody === 'string') {
      const cleanText = contentBody.replace(/<[^>]*>/g, ' ').trim();
      const wordCount = cleanText.split(/\s+/).filter(Boolean).length;
      if (wordCount > 10) {
        const estimatedSeconds = Math.round((wordCount / 180) * 60);
        return Math.max(30, estimatedSeconds);
      }
    }
    return 60; // 1 menit default
  }

  function renderCoursePlayer(container, courseId) {
    const course = AppState.courses.find(c => c.id === courseId) || AppState.courses[0];
    if (!course) {
      container.innerHTML = '<div style="padding:3rem;text-align:center;"><p>Course tidak ditemukan.</p></div>';
      return;
    }
    AppState.activeCoursePlayer = course;
    if (AppState.activeUnitIndex >= course.contents.length) AppState.activeUnitIndex = 0;

    // Simpan posisi player aktif ke localStorage agar persisten saat tab ditutup/reload
    try {
      localStorage.setItem('lms_last_active_route', JSON.stringify({
        viewId: 'course-player',
        param: course.id,
        role: AppState.currentRole,
        unitIndex: AppState.activeUnitIndex
      }));
      localStorage.setItem('lms_last_active_player', JSON.stringify({
        courseId: course.id,
        unitIndex: AppState.activeUnitIndex
      }));
    } catch (e) {}

    const currentUnit = course.contents[AppState.activeUnitIndex];
    if (!currentUnit) {
      container.innerHTML = '<div style="padding:3rem;text-align:center;"><p>Unit konten belum tersedia. <button class="btn btn-outline" onclick="navigateTo(\'course-editor\',\''+courseId+'\')">Tambah Konten ↗</button></p></div>';
      return;
    }

    const completedCount = course.contents.filter(u => u.completed).length;
    const progressPercent = course.contents.length > 0 ? Math.round((completedCount / course.contents.length) * 100) : 0;
    const isStudent = AppState.currentRole === 'student' || AppState.isSimulatingStudent;

    // 1. Identifikasi & Pengelompokan Unit (Pre-Exam, Bab Accordion, Post-Course)
    let preExamIdx = course.contents.findIndex(u => (u.type || '').toLowerCase() === 'pre_exam' || u.title.toLowerCase().includes('pre-exam') || u.title.toLowerCase().includes('pretest'));
    
    const postCourseTypes = ['evaluasi', 'post_exam', 'tugas', 'refleksi', 'sertifikat'];
    const postCourseIndices = [];
    const chapters = {};
    const chapterOrder = [];

    course.contents.forEach((u, idx) => {
      if (idx === preExamIdx) return;
      const typeLower = (u.type || '').toLowerCase();
      const hasSection = Boolean((u.sectionName && u.sectionName.trim()) || u.moduleId);
      const isExplicitPostCourse = ['post_exam', 'sertifikat', 'refleksi'].includes(typeLower);
      if (!hasSection && isExplicitPostCourse) {
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
      const statusIcon = u.completed ? '✓' : (isLocked ? '🔒' : (isActive ? '●' : ''));
      const statusClass = u.completed ? 'completed' : (isLocked ? 'locked' : (isActive ? 'active-unit' : ''));
      
      preExamHtml = `
        <div class="player-standalone-card ${isActive ? 'active' : ''} ${statusClass}"
             onclick="selectPlayerUnit(${preExamIdx})"
             title="${isLocked ? 'Terkunci. Selesaikan sesi sebelumnya.' : escHtml(u.title)}">
          <div class="player-status-circle ${statusClass}" style="flex-shrink:0;">
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

      let totalChapterSec = 0;
      subItems.forEach(({ unit: u }) => {
        totalChapterSec += parseDurationSeconds(u.duration, u.contentBody);
      });
      const totalChapterMin = Math.max(1, Math.round(totalChapterSec / 60));

      let chStatusIcon = '';
      let chStatusClass = '';
      if (allCompleted) {
        chStatusIcon = '✓';
        chStatusClass = 'completed';
      } else if (firstLocked) {
        chStatusIcon = '🔒';
        chStatusClass = 'locked';
      } else if (hasActive) {
        chStatusIcon = '●';
        chStatusClass = 'active-unit';
      }

      const subItemsHtml = subItems.map(({ unit: u, idx }) => {
        const isLocked = isUnitLocked(idx, course);
        const isActive = idx === AppState.activeUnitIndex;
        let icon = '📖';
        const typeLower = (u.type || '').toLowerCase();
        if (typeLower === 'video') icon = '▶';
        else if (typeLower === 'kuis_popup' || typeLower === 'kuis' || u.title.toLowerCase().includes('kuis')) icon = '📋';
        else if (typeLower === 'tugas_drive') icon = '📁';
        else if (typeLower === 'tugas_zoom') icon = '📹';
        else if (typeLower === 'tugas') icon = '✏️';

        const subStatusIcon = u.completed ? '✓' : (isLocked ? '🔒' : (isActive ? '●' : ''));
        const subStatusClass = u.completed ? 'completed' : (isLocked ? 'locked' : (isActive ? 'active-unit' : 'uncompleted'));

        return `
          <div class="player-subitem ${isActive ? 'active' : ''} ${isLocked ? 'locked' : ''}"
               onclick="selectPlayerUnit(${idx})"
               title="${isLocked ? 'Sesi ini terkunci' : escHtml(u.title)}">
            <div class="player-status-circle ${subStatusClass}" style="width:20px;height:20px;font-size:0.65rem;flex-shrink:0;">
              ${subStatusIcon}
            </div>
            <div style="flex:1;min-width:0;">
              <div class="player-subitem-title">${icon} ${escHtml(u.title)}</div>
              <div class="player-subitem-meta">⏱️ ${escHtml(u.duration || '5 Menit')}</div>
            </div>
          </div>
        `;
      }).join('');

      return `
        <div class="player-chapter-card ${isExpanded ? 'expanded' : ''} ${hasActive ? 'chapter-active' : ''}">
          <div class="player-chapter-header" onclick="toggleChapterAccordion('${escHtml(chTitle)}', event)">
            <div class="player-status-circle ${chStatusClass}" style="flex-shrink:0;">
              ${chStatusIcon}
            </div>
            <div class="player-chapter-title" style="flex:1;min-width:0;">${escHtml(chTitle)}</div>
            <div style="display:flex;align-items:center;gap:0.4rem;flex-shrink:0;">
              <span class="chapter-duration-badge" title="Total estimasi waktu menyelesaikan tema ini">⏱️ ~${totalChapterMin}m</span>
              <div class="player-chapter-chevron" style="transform:${isExpanded ? 'rotate(180deg)' : 'rotate(0deg)'};transition:transform 0.25s ease;">▼</div>
            </div>
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
    const forceTest = (AppState.forceTestAntiSkip && AppState.forceTestAntiSkip[currentUnit.id]) || false;
    const isCompleted = currentUnit.completed && !forceTest;
    const typeLower = (currentUnit.type || '').toLowerCase();
    const isQuizUnit = ['pre_exam', 'kuis_popup', 'post_exam', 'kuis'].includes(typeLower) || (currentUnit.quizData && currentUnit.quizData.length > 0);
    const isReviewMode = AppState.quizReviewMode && AppState.quizReviewMode[currentUnit.id];
    const hasSubmitted = Boolean(
      (AppState.progressData && AppState.progressData[currentUnit.id]) ||
      (AppState.lastQuizResults && AppState.lastQuizResults[currentUnit.id]) ||
      isCompleted ||
      AppState.progressMap[currentUnit.id]
    );
    const showResultScreen = hasSubmitted && !isReviewMode;

    let contentHtml = '';

    if (isQuizUnit) {
      if (showResultScreen) {
        // LAYAR HASIL SKOR
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

        // Ambil data review pengerjaan & pembahasan
        let reviewData = progress.answers_data || (AppState.lastQuizResults && AppState.lastQuizResults[currentUnit.id]);
        if (!reviewData) {
          try {
            const raw = localStorage.getItem('lms_quiz_review_' + currentUnit.id);
            if (raw) reviewData = JSON.parse(raw);
          } catch (e) {}
        }
        if (!reviewData) {
          const effQ = getEffectiveQuizData(currentUnit);
          if (effQ && effQ.length > 0) {
            reviewData = {
              unitId: currentUnit.id,
              submittedAt: progress.completed_at || new Date().toISOString(),
              score,
              correctAnswers: correctCount,
              wrongAnswers: wrongCount,
              questions: effQ.map(q => ({
                id: q.id,
                question: q.question,
                options: q.options,
                answerIndex: q.answerIndex,
                userAnswer: -1,
                explanation: q.explanation || 'Pembahasan materi ini menguji penguasaan kaidah standar pada topik pembelajaran.'
              }))
            };
          }
        }

        const passGrade = currentUnit.passingScore || (typeLower === 'pre_exam' ? 60 : 70);
        const isPassed = progress.is_passed !== undefined ? progress.is_passed : (score >= passGrade);
        // Kunci jawaban & pembahasan HANYA boleh ditampilkan jika siswa telah lulus batas KKM
        // Untuk mencegah kebocoran jawaban saat siswa remedial
        const canViewExplanation = isPassed || AppState.activeRole === 'educator' || AppState.activeRole === 'admin';

        const isExpOpen = canViewExplanation && AppState.quizExplanationOpen && AppState.quizExplanationOpen[currentUnit.id];
        let explanationSectionHtml = '';

        if (canViewExplanation && reviewData && Array.isArray(reviewData.questions) && reviewData.questions.length > 0) {
          if (isExpOpen) {
            const itemsHtml = reviewData.questions.map((q, idx) => {
              const userAns = q.userAnswer;
              const isAnswered = typeof userAns === 'number' && userAns >= 0;
              const isCorrect = isAnswered && userAns === q.answerIndex;
              const optionsHtml = q.options.map((opt, optIdx) => {
                const isUserChoice = userAns === optIdx;
                const isActualCorrect = optIdx === q.answerIndex;
                let optClass = 'exam-review-opt';
                let tag = '';

                if (isUserChoice && isActualCorrect) {
                  optClass += ' user-correct';
                  tag = '<span class="badge" style="background:#16a34a;color:#ffffff;font-size:0.7rem;padding:0.15rem 0.45rem;">✓ Jawaban Anda Benar</span>';
                } else if (isUserChoice && !isActualCorrect) {
                  optClass += ' user-wrong';
                  tag = '<span class="badge" style="background:#dc2626;color:#ffffff;font-size:0.7rem;padding:0.15rem 0.45rem;">✕ Pilihan Anda (Salah)</span>';
                } else if (isActualCorrect) {
                  optClass += ' actual-correct';
                  tag = '<span class="badge" style="background:#059669;color:#ffffff;font-size:0.7rem;padding:0.15rem 0.45rem;">★ Kunci Jawaban Benar</span>';
                }

                return `
                  <div class="${optClass}">
                    <span style="line-height:1.4;" dir="auto">${escHtml(opt)}</span>
                    ${tag}
                  </div>
                `;
              }).join('');

              let statusBadge = '';
              if (!isAnswered) {
                statusBadge = '<span class="badge" style="background:#f1f5f9;color:#64748b;font-weight:700;">⚪ Tidak Terjawab</span>';
              } else if (isCorrect) {
                statusBadge = '<span class="badge" style="background:#dcfce7;color:#166534;font-weight:700;">✅ Jawaban Benar</span>';
              } else {
                statusBadge = '<span class="badge" style="background:#fee2e2;color:#991b1b;font-weight:700;">❌ Jawaban Salah</span>';
              }

              return `
                <div class="exam-review-item ${isCorrect ? 'correct' : (isAnswered ? 'wrong' : '')}">
                  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem;flex-wrap:wrap;gap:0.5rem;">
                    <strong style="color:var(--primary);font-size:0.95rem;">Soal #${idx + 1}</strong>
                    ${statusBadge}
                  </div>
                  <div class="exam-question-text" dir="auto" style="margin-bottom:0.75rem;">${escHtml(q.question)}</div>
                  <div style="margin-bottom:0.5rem;">${optionsHtml}</div>
                  <div class="exam-explanation-box">
                    💡 <strong>Pembahasan &amp; Konsep Materi:</strong><br>
                    ${escHtml(q.explanation || 'Pembahasan materi ini menguji penguasaan kaidah standar pada topik pembelajaran.')}
                  </div>
                </div>
              `;
            }).join('');

            explanationSectionHtml = `
              <div id="quiz-explanation-container" style="width:100%;margin-top:1.5rem;text-align:left;">
                <div style="background:#f1f5f9;border:1px solid #cbd5e1;padding:0.75rem 1rem;border-radius:8px;margin-bottom:1rem;display:flex;align-items:center;justify-content:space-between;">
                  <strong style="color:var(--primary);font-size:0.95rem;">📑 Lembar Jawaban &amp; Pembahasan Soal</strong>
                  <span style="font-size:0.8125rem;color:var(--tertiary);">${reviewData.questions.length} Soal Selesai Diulas</span>
                </div>
                ${itemsHtml}
              </div>
            `;
          }
        }

        contentHtml = `
          <div class="exam-result-box">
            <div class="exam-illustration-badge">
              <div class="exam-thumbsup-circle" style="background:${isPassed ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : 'linear-gradient(135deg, #f59e0b 0%, #dc2626 100%)'};">
                ${isPassed ? '👍' : '⚠️'}
                <span class="exam-thumbsup-check">${isPassed ? '✓' : '!'}</span>
              </div>
            </div>

            <h2 class="exam-result-title">
              ${isPassed ? `Selamat! Kamu telah lulus ${escHtml(cleanTitle)} kelas ini` : `Hasil ${escHtml(cleanTitle)}: Belum Lulus`}
            </h2>

            ${!isPassed ? `
              <div style="background:#fef2f2;border:1px solid #fecaca;color:#991b1b;padding:0.75rem 1rem;border-radius:8px;margin-bottom:1rem;font-size:0.875rem;max-width:520px;margin-left:auto;margin-right:auto;">
                🔒 <strong>Sesi Materi Selanjutnya Masih Terkunci:</strong> Nilai kamu (${score}) belum memenuhi batas kelulusan (${passGrade}). Silakan kerjakan ulang ujian/kuis ini agar materi berikutnya terbuka.
              </div>
            ` : ''}

            <div class="exam-score-table-card">
              <div class="exam-score-columns">
                <div>
                  <div class="exam-stat-label">Benar</div>
                  <div class="exam-stat-value" style="color:#059669;">${correctCount}</div>
                </div>
                <div>
                  <div class="exam-stat-label">Salah</div>
                  <div class="exam-stat-value" style="color:#dc2626;">${wrongCount}</div>
                </div>
                <div>
                  <div class="exam-stat-label">Waktu</div>
                  <div class="exam-stat-value">${timeStr}</div>
                </div>
                <div>
                  <div class="exam-stat-label">Nilai</div>
                  <div class="exam-stat-value ${isPassed ? 'score-teal' : 'score-red'}" style="color:${isPassed ? '#0d9488' : '#dc2626'};">${score}</div>
                </div>
              </div>
              
              <div class="exam-stat-divider"></div>
              
              <p class="exam-stat-notes">
                <strong>Catatan:</strong> ${escHtml(notes)}
              </p>
            </div>

            <div style="margin-top:0.5rem;display:flex;gap:.75rem;flex-wrap:wrap;justify-content:center;">
              <button class="btn ${isPassed ? 'btn-outline' : 'btn-authoritative'} btn-sm" onclick="retakeQuiz(${AppState.activeUnitIndex})" style="font-weight:700;">
                🔄 ${isPassed ? 'Kerjakan Ulang untuk Perbaiki Nilai' : 'Ulangi Kuis / Remedial (Soal & Opsi Diacak Ulang)'}
              </button>
              ${canViewExplanation && reviewData && Array.isArray(reviewData.questions) && reviewData.questions.length > 0 ? `
                <button class="btn btn-outline btn-sm" onclick="toggleQuizExplanation('${currentUnit.id}')" style="font-weight:600;">
                  ${isExpOpen ? '🙈 Tutup Pembahasan' : '📖 Lihat Pembahasan & Kunci Jawaban'}
                </button>
              ` : ''}
              ${isPassed ? `
                <button class="btn btn-primary btn-sm" onclick="nextPlayerUnit()" style="font-weight:700;">
                  Lanjut ke Materi Berikutnya →
                </button>
              ` : ''}
            </div>

            ${!canViewExplanation ? `
              <p style="font-size:0.8125rem;color:var(--tertiary);margin-top:1rem;text-align:center;">
                🔒 <em>Kunci jawaban dan pembahasan soal dirahasiakan dan baru akan terbuka setelah Anda berhasil mencapai batas kelulusan (KKM).</em>
              </p>
            ` : ''}

            ${explanationSectionHtml}
          </div>
        `;
      } else {
        // FORM PENGERJAAN KUIS / EXAM (DENGAN COUNTDOWN TIMER & SOAL/OPSI TERACAK)
        const questions = getShuffledQuizSession(currentUnit);
        if (!AppState.activeQuizStartTime) AppState.activeQuizStartTime = Date.now();
        const unitAnswers = (AppState.activeQuizAnswers && AppState.activeQuizAnswers[currentUnit.id]) || {};
        const durationMinutes = parseDurationMinutes(currentUnit.duration, 15);
        const initialTimerStr = `${String(durationMinutes).padStart(2, '0')}:00`;

        const questionsHtml = questions.map((q, qIdx) => {
          const selectedOpt = unitAnswers[q.id];
          const optionsHtml = q.options.map((opt, optIdx) => `
            <div class="exam-option-card ${selectedOpt === optIdx ? 'selected' : ''}" 
                 onclick="selectQuizOption('${currentUnit.id}', ${q.id}, ${optIdx})">
              <input type="radio" name="q_${q.id}" value="${optIdx}" ${selectedOpt === optIdx ? 'checked' : ''}>
              <span style="font-size:0.875rem;color:#334155;line-height:1.5;flex:1;" dir="auto">${escHtml(opt)}</span>
            </div>
          `).join('');

          return `
            <div class="exam-question-item" id="quiz-q-${q.id}">
              <div class="exam-question-text" dir="auto"><strong>${qIdx + 1}.</strong> ${escHtml(q.question)}</div>
              <div>${optionsHtml}</div>
            </div>
          `;
        }).join('');

        contentHtml = `
          <div class="exam-container">
            <!-- Countdown Timer Bar -->
            <div class="exam-countdown-bar">
              <div style="display:flex;align-items:center;gap:0.5rem;">
                <span style="font-size:1.15rem;">⏱️</span>
                <span>Batas Waktu Pengerjaan Ujian:</span>
              </div>
              <div class="exam-countdown-timer" id="quiz-countdown-timer-display" title="Hitung mundur sisa waktu ujian">
                ${initialTimerStr}
              </div>
            </div>

            <div class="exam-intro-card" dir="auto">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem;flex-wrap:wrap;gap:0.4rem;">
                <span class="badge badge-primary">${currentUnit.type === 'pre_exam' ? 'Pra-Pembelajaran' : 'Uji Pemahaman'}</span>
                <div style="display:flex;align-items:center;gap:0.5rem;">
                  <span class="badge" style="background:#f1f5f9;color:#475569;font-size:0.75rem;">🔀 Soal &amp; Opsi Diacak</span>
                  <span style="font-size:0.8125rem;color:var(--tertiary);font-weight:600;">⏱️ ${durationMinutes} Menit</span>
                </div>
              </div>
              <h3 style="margin-bottom:.5rem;">${escHtml(currentUnit.title)}</h3>
              <p style="color:var(--tertiary);font-size:0.875rem;line-height:1.5;margin:0;">
                Pilihlah salah satu jawaban yang paling tepat. Jawaban akan otomatis dikumpulkan jika waktu ujian habis.
              </p>
            </div>

            ${questionsHtml}

            <div style="text-align:center;margin-top:1.5rem;padding-bottom:2rem;">
              <button class="btn btn-primary" style="padding:0.75rem 2.5rem;font-size:1rem;" onclick="submitActiveQuiz(${AppState.activeUnitIndex})">
                🚀 Kumpulkan &amp; Periksa Jawaban
              </button>
            </div>
          </div>
        `;
      }
    } else if (typeLower === 'tugas_drive' || typeLower === 'tugas') {
      const tutor = getTutorForCourse(course);
      const isTutorOrAdmin = (AppState.currentRole === 'educator' || AppState.currentRole === 'admin') && !AppState.isSimulatingStudent;

      if (isTutorOrAdmin) {
        // --- PANEL PENILAIAN & PERSETUJUAN TUTOR LANGSUNG DI PLAYER ---
        const unitSubs = (AppState.submissions || []).filter(s => s.content_id === currentUnit.id || (s.course_id === course.id && (s.type === 'drive' || s.drive_url)));
        
        let tutorListHtml = '';
        if (unitSubs.length === 0) {
          tutorListHtml = `
            <div style="text-align:center;padding:2.5rem 1.5rem;background:#fff;border-radius:10px;border:1px dashed #cbd5e1;margin-bottom:1.5rem;">
              <div style="font-size:2.5rem;margin-bottom:0.5rem;">📂</div>
              <h4 style="margin:0 0 0.25rem;color:var(--primary);">Belum Ada Peserta yang Mengumpulkan Tugas</h4>
              <p style="font-size:0.875rem;color:var(--tertiary);margin:0 0 1rem;max-width:480px;margin-left:auto;margin-right:auto;">
                Begitu siswa mengirimkan tautan Google Drive mereka, data tugas dan tombol persetujuan akan langsung muncul di sini.
              </p>
              <div style="display:flex;gap:0.75rem;justify-content:center;flex-wrap:wrap;">
                <button type="button" class="btn btn-primary btn-sm" onclick="demoTestApprovalModal('${currentUnit.id}', '${course.id}')">
                  ⚡ Uji Coba Form Persetujuan Langsung (Simulasi Tugas)
                </button>
                <button type="button" class="btn btn-outline btn-sm" onclick="refreshApprovalsFromPlayer('${currentUnit.id}', '${course.id}')">
                  🔄 Muat Ulang Data dari Server
                </button>
              </div>
            </div>
          `;
        } else {
          tutorListHtml = unitSubs.map(s => {
            const student = AppState.students.find(st => st.id === s.student_id);
            const studentPhone = student?.whatsapp || student?.phone || '';
            const isApproved = s.approval_status === 'approved';
            const isRejected = s.approval_status === 'rejected';

            let badgeHtml = '';
            if (isApproved) {
              badgeHtml = `<span class="badge" style="background:#dcfce7;color:#166534;font-weight:700;">✅ Disetujui (Nilai: ${s.score || 90}/100)</span>`;
            } else if (isRejected) {
              badgeHtml = `<span class="badge" style="background:#fee2e2;color:#991b1b;font-weight:700;">⚠️ Perlu Revisi</span>`;
            } else {
              badgeHtml = `<span class="badge" style="background:#fef3c7;color:#92400e;font-weight:700;">⏳ Menunggu Review &amp; Persetujuan</span>`;
            }

            const waMsg = `Halo ${s.student_name}, saya Tutor ${tutor.name} dari kelas "${course.title}". Mengenai tugas Drive Anda pada tema "${currentUnit.title}", ${isApproved ? 'selamat tugas Anda telah disetujui!' : (isRejected ? 'mohon cek catatan revisi di LMS ya.' : 'tugas Anda sedang diperiksa.')}`;
            const waUrl = buildWhatsAppLink(studentPhone || '628123456789', waMsg);

            return `
              <div style="background:#ffffff;border:1px solid ${isApproved ? '#86efac' : (isRejected ? '#fca5a5' : '#e2e8f0')};border-radius:10px;padding:1.25rem;margin-bottom:1rem;box-shadow:var(--shadow-1);">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.75rem;">
                  <div>
                    <strong style="font-size:1.05rem;color:var(--primary);">${escHtml(s.student_name || 'Peserta')}</strong>
                    <div style="font-size:0.75rem;color:var(--tertiary);">${escHtml(student?.class || s.student_email || 'Siswa')} • Dikirim: ${new Date(s.submitted_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}</div>
                  </div>
                  <div>${badgeHtml}</div>
                </div>

                <div style="background:#f8fafc;padding:0.75rem 1rem;border-radius:8px;margin-bottom:0.75rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;">
                  <div style="font-size:0.875rem;word-break:break-all;">
                    <strong style="color:#166534;">📁 Berkas Google Drive Siswa:</strong> 
                    <a href="${escHtml(s.drive_url)}" target="_blank" rel="noopener noreferrer" style="color:#15803d;font-weight:600;text-decoration:underline;">
                      ${escHtml(s.drive_url)} ↗
                    </a>
                  </div>
                  <a href="${escHtml(s.drive_url)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline btn-sm" style="background:#fff;color:#166534;border-color:#86efac;font-weight:600;">
                    📂 Buka Link Drive Siswa ↗
                  </a>
                </div>

                ${s.student_notes ? `
                  <div style="font-size:0.8125rem;color:#475569;background:#f1f5f9;padding:0.5rem 0.75rem;border-radius:6px;margin-bottom:0.75rem;">
                    <strong>Catatan Siswa:</strong> "${escHtml(s.student_notes)}"
                  </div>
                ` : ''}

                ${s.tutor_feedback ? `
                  <div style="font-size:0.8125rem;color:#1e293b;background:${isApproved ? '#f0fdf4' : '#fef2f2'};border-left:3px solid ${isApproved ? '#22c55e' : '#ef4444'};padding:0.5rem 0.75rem;border-radius:4px;margin-bottom:0.75rem;">
                    <strong>Feedback Tutor:</strong> "${escHtml(s.tutor_feedback)}"
                  </div>
                ` : ''}

                <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-top:0.5rem;padding-top:0.5rem;border-top:1px solid #f1f5f9;">
                  <button type="button" class="btn btn-primary btn-sm" onclick="openModalReviewSubmission('${s.id}')" style="font-weight:700;">
                    ⚡ ${isApproved ? 'Ubah Keputusan / Nilai' : 'Periksa & Beri Keputusan Persetujuan'}
                  </button>
                  <a href="${waUrl}" target="_blank" rel="noopener noreferrer" class="btn-whatsapp" style="font-size:0.75rem;padding:0.35rem 0.65rem;">
                    Hubungi via WA
                  </a>
                </div>
              </div>
            `;
          }).join('');
        }

        contentHtml = `
          <div style="max-width:780px;margin:0 auto;line-height:1.7;">
            <!-- Header Panel Tutor -->
            <div style="background:linear-gradient(135deg, #1e1b4b 0%, #312e81 100%);color:#fff;border-radius:12px;padding:1.25rem 1.5rem;margin-bottom:1.5rem;box-shadow:var(--shadow-2);display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;">
              <div>
                <span class="badge" style="background:#4338ca;color:#e0e7ff;font-weight:700;margin-bottom:0.35rem;display:inline-block;">👨‍🏫 Panel Penilaian &amp; Persetujuan Tutor</span>
                <h3 style="margin:0;font-size:1.2rem;color:#fff;">Penugasan: ${escHtml(currentUnit.title)}</h3>
                <p style="margin:0.25rem 0 0;font-size:0.8125rem;color:#c7d2fe;">
                  Tinjau lembar kerja peserta didik, beri evaluasi nilai, dan setujui kelulusan tema untuk membuka materi bab berikutnya.
                </p>
              </div>
              <button type="button" class="btn btn-sm" style="background:rgba(255,255,255,0.15);color:#fff;border:1px solid rgba(255,255,255,0.3);" onclick="refreshApprovalsFromPlayer('${currentUnit.id}', '${course.id}')">
                🔄 Muat Ulang Data
              </button>
            </div>

            <!-- Petunjuk Tugas Untuk Siswa -->
            <div class="assignment-card" style="margin-bottom:1.5rem;">
              <div class="assignment-card-header" style="background:#f8fafc;">
                <h4 style="margin:0;font-size:0.95rem;color:var(--primary);">📋 Instruksi Penugasan yang Diterima Siswa:</h4>
              </div>
              <div class="assignment-card-body" style="padding:1rem 1.25rem;">
                ${currentUnit.contentBody || '<p>Peserta diminta menyelesaikan tugas dan mengunggah tautan Google Drive.</p>'}
              </div>
            </div>

            <!-- Daftar Pengajuan Siswa -->
            <div style="margin-bottom:1rem;display:flex;align-items:center;justify-content:space-between;">
              <h4 style="margin:0;color:var(--primary);font-size:1rem;">Daftar Pengajuan Peserta Didik (${unitSubs.length})</h4>
              <button type="button" class="btn btn-outline btn-sm" onclick="navigateTo('tutor-approvals')" style="font-size:0.75rem;">
                Buka Pusat Persetujuan Lengkap ↗
              </button>
            </div>

            ${tutorListHtml}
          </div>
        `;
      } else {
        // --- TAMPILAN SISWA (ATAU SIMULASI SISWA) ---
        const studentId = AppState.user?.id;
        const sub = (AppState.submissions || []).find(s => s.student_id === studentId && s.content_id === currentUnit.id);
        const isApproved = sub && sub.approval_status === 'approved';
        const isRejected = sub && sub.approval_status === 'rejected';
        const isPending = sub && sub.approval_status === 'pending';

        let statusCardHtml = '';
        if (isApproved) {
          statusCardHtml = `
            <div class="submission-status-card approved">
              <div class="submission-status-header">
                <div class="submission-status-title">
                  <span>🎉</span> Tugas Telah Disetujui Tutor (Lulus Tema)
                </div>
                <span class="badge badge-success">Nilai: ${sub.score || 90}/100</span>
              </div>
              <div class="submission-meta-row">
                <span>📅 Dikirim: ${new Date(sub.submitted_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                <span>🔗 Link: <a href="${escHtml(sub.drive_url)}" target="_blank" rel="noopener noreferrer" style="color:#166534;font-weight:600;text-decoration:underline;">Buka Google Drive ↗</a></span>
              </div>
              <div class="submission-feedback-box">
                <strong>Catatan & Apresiasi Tutor:</strong><br>
                ${escHtml(sub.tutor_feedback || 'Pengerjaan tugas Anda sudah sangat baik dan memenuhi standar kompetensi tema ini. Silakan lanjutkan ke tema berikutnya.')}
              </div>
              <div style="margin-top:0.5rem;">
                <button class="btn btn-primary" onclick="nextPlayerUnit()">
                  Lanjut ke Tema Berikutnya →
                </button>
              </div>
            </div>
          `;
        } else if (isRejected) {
          statusCardHtml = `
            <div class="submission-status-card rejected">
              <div class="submission-status-header">
                <div class="submission-status-title">
                  <span>⚠️</span> Tugas Perlu Direvisi (Belum Disetujui)
                </div>
                <span class="badge" style="background:#fee2e2;color:#991b1b;font-weight:700;">Wajib Mengulang</span>
              </div>
              <p style="margin:0;font-size:0.875rem;line-height:1.5;">
                Tutor telah memeriksa tugas Anda dan meminta perbaikan. Tema berikutnya tetap <strong>TERKUNCI</strong> sampai tugas perbaikan Anda disetujui tutor.
              </p>
              <div class="submission-feedback-box" style="background:#fff;border-color:#fca5a5;">
                <strong style="color:#991b1b;">Catatan Revisi dari Tutor (${escHtml(tutor.name)}):</strong><br>
                ${escHtml(sub.tutor_feedback || 'Mohon periksa kembali pengerjaan lembar kerja Anda dan perbaiki sesuai instruksi sebelum mengirimkan kembali.')}
              </div>
              <div style="margin-top:0.75rem;display:flex;gap:0.75rem;flex-wrap:wrap;align-items:center;">
                <button class="btn btn-outline btn-sm" onclick="document.getElementById('drive-submission-form-container').style.display='block';this.style.display='none';">
                  ✏️ Kirim Ulang Perbaikan Tugas
                </button>
                <button class="btn btn-outline btn-sm" onclick="checkStudentApprovalStatus('${currentUnit.id}', '${course.id}')" title="Periksa apakah Tutor sudah menyetujui revisi tugas Anda">
                  🔄 Cek Status Persetujuan
                </button>
              </div>
            </div>
          `;
        } else if (isPending) {
          statusCardHtml = `
            <div class="submission-status-card pending">
              <div class="submission-status-header">
                <div class="submission-status-title">
                  <span>⏳</span> Menunggu Peninjauan & Persetujuan Tutor
                </div>
                <span class="badge" style="background:#fef3c7;color:#92400e;font-weight:700;">Status: Pending Review</span>
              </div>
              <p style="margin:0;font-size:0.875rem;line-height:1.5;">
                Tugas Anda telah berhasil dikirim ke Tutor <strong>${escHtml(tutor.name)}</strong>. Tema pembelajaran selanjutnya akan <strong>terbuka otomatis</strong> setelah tugas Anda disetujui.
              </p>
              <div class="submission-meta-row" style="margin-top:0.25rem;">
                <span>📅 Waktu Kirim: ${new Date(sub.submitted_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                <span>🔗 Link: <a href="${escHtml(sub.drive_url)}" target="_blank" rel="noopener noreferrer" style="color:#92400e;font-weight:600;text-decoration:underline;">Lihat Tautan Drive ↗</a></span>
              </div>
              ${sub.student_notes ? `<div style="font-size:0.8125rem;color:#78350f;background:rgba(255,255,255,0.7);padding:0.5rem 0.75rem;border-radius:6px;margin-top:0.25rem;"><strong>Catatan Anda:</strong> "${escHtml(sub.student_notes)}"</div>` : ''}
              <div style="margin-top:0.75rem;display:flex;gap:0.75rem;flex-wrap:wrap;align-items:center;">
                <button class="btn btn-primary btn-sm" onclick="checkStudentApprovalStatus('${currentUnit.id}', '${course.id}')" title="Periksa apakah Tutor sudah menyetujui tugas Anda">
                  🔄 Cek Status Persetujuan Tutor
                </button>
                <button class="btn btn-outline btn-sm" onclick="document.getElementById('drive-submission-form-container').style.display='block';this.style.display='none';">
                  ✏️ Perbarui / Ganti Tautan Drive
                </button>
              </div>
            </div>
          `;
        }

        const showForm = !isApproved && (!isPending || isRejected);
        const initialUrl = sub?.drive_url || '';
        const initialNotes = sub?.student_notes || '';

        contentHtml = `
          <div style="max-width:760px;margin:0 auto;line-height:1.7;">
            <!-- Widget Kontak WhatsApp Tutor -->
            ${renderTutorContactCard(tutor, course, currentUnit, '💬 Konfirmasi Tugas via WA')}

            <div class="assignment-card">
              <div class="assignment-card-header">
                <h3 class="assignment-card-title">
                  <span>📁</span> ${escHtml(currentUnit.title)}
                </h3>
                <span class="badge badge-primary">Syarat Kelulusan Tema</span>
              </div>
              <div class="assignment-card-body">
                <div class="assignment-instruction-box">
                  ${currentUnit.contentBody || '<p>Selesaikan tugas praktik mandiri dan kirimkan tautan Google Drive Anda untuk diperiksa oleh tutor.</p>'}
                </div>

                ${statusCardHtml}

                <div id="drive-submission-form-container" style="display:${showForm ? 'block' : 'none'};">
                  <form id="form-submit-drive-assignment" onsubmit="handleStudentSubmitDrive(event, '${course.id}', '${currentUnit.id}', '${currentUnit.moduleId || ''}')">
                    <div class="form-group">
                      <label class="form-label" style="font-weight:700;">
                        ${isRejected ? 'Tautan Google Drive Hasil Revisi' : 'Tautan Berkas Google Drive / Google Docs / Spreadsheet'} <span style="color:var(--error);">*</span>
                      </label>
                      <div class="drive-input-wrapper">
                        <span class="drive-input-icon">📁</span>
                        <input type="url" id="input-drive-url" class="form-control" placeholder="https://docs.google.com/spreadsheets/d/... atau https://drive.google.com/..." value="${escHtml(initialUrl)}" required>
                      </div>
                      <small style="color:var(--tertiary);font-size:0.75rem;display:block;margin-top:0.35rem;">
                        💡 <strong>Penting:</strong> Pastikan setelan akses Google Drive sudah diatur ke <em>"Anyone with the link can view / Siapa saja yang memiliki link dapat melihat"</em> agar tutor dapat memeriksa tugas Anda.
                      </small>
                    </div>

                    <div class="form-group">
                      <label class="form-label">Catatan Tambahan untuk Tutor (Opsional)</label>
                      <textarea id="input-drive-notes" class="form-control" rows="3" placeholder="Tuliskan keterangan pengerjaan atau pertanyaan untuk tutor...">${escHtml(initialNotes)}</textarea>
                    </div>

                    <button type="submit" class="btn btn-primary" style="padding:0.75rem 2rem;font-size:0.95rem;width:100%;">
                      ${isRejected ? '🔄 Kirim Ulang Tugas Revisi untuk Persetujuan' : '🚀 Kirim Tugas untuk Persetujuan Tutor'}
                    </button>
                  </form>
                </div>
              </div>
            </div>
          </div>
        `;
      }
    } else if (typeLower === 'tugas_zoom') {
      const tutor = getTutorForCourse(course);
      const isTutorOrAdmin = (AppState.currentRole === 'educator' || AppState.currentRole === 'admin') && !AppState.isSimulatingStudent;

      if (isTutorOrAdmin) {
        // --- PANEL PERIKSA & KONFIRMASI JADWAL ZOOM UNTUK TUTOR ---
        const unitSubs = (AppState.submissions || []).filter(s => s.content_id === currentUnit.id || (s.course_id === course.id && (s.type === 'zoom' || s.zoom_url)));

        let tutorListHtml = '';
        if (unitSubs.length === 0) {
          tutorListHtml = `
            <div style="text-align:center;padding:2.5rem 1.5rem;background:#fff;border-radius:10px;border:1px dashed #cbd5e1;margin-bottom:1.5rem;">
              <div style="font-size:2.5rem;margin-bottom:0.5rem;">📹</div>
              <h4 style="margin:0 0 0.25rem;color:var(--primary);">Belum Ada Usulan Jadwal Tatap Muka Zoom</h4>
              <p style="font-size:0.875rem;color:var(--tertiary);margin:0 0 1rem;max-width:480px;margin-left:auto;margin-right:auto;">
                Begitu siswa mengajukan usulan tanggal, jam, dan ruang Zoom mereka, permohonan temu virtual akan muncul di sini.
              </p>
              <button type="button" class="btn btn-outline btn-sm" onclick="refreshApprovalsFromPlayer('${currentUnit.id}', '${course.id}')">
                🔄 Muat Ulang Data dari Server
              </button>
            </div>
          `;
        } else {
          tutorListHtml = unitSubs.map(s => {
            const student = AppState.students.find(st => st.id === s.student_id);
            const isApproved = s.approval_status === 'approved';
            const isConfirmed = s.schedule_status === 'confirmed';
            const meetingDateObj = s.zoom_meeting_time ? new Date(s.zoom_meeting_time) : null;
            const meetingTimeStr = meetingDateObj ? meetingDateObj.toLocaleString('id-ID', { dateStyle: 'full', timeStyle: 'short' }) : 'Belum ditentukan';

            return `
              <div style="background:#ffffff;border:1px solid ${isApproved ? '#86efac' : '#e2e8f0'};border-radius:10px;padding:1.25rem;margin-bottom:1rem;box-shadow:var(--shadow-1);">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.75rem;">
                  <div>
                    <strong style="font-size:1.05rem;color:var(--primary);">${escHtml(s.student_name || 'Peserta')}</strong>
                    <div style="font-size:0.75rem;color:var(--tertiary);">${escHtml(student?.class || s.student_email || 'Siswa')}</div>
                  </div>
                  <div>
                    <span class="badge ${isApproved ? 'badge-success' : (isConfirmed ? 'badge-primary' : 'badge-warning')}">
                      ${isApproved ? '✅ Lulus Tema' : (isConfirmed ? '🤝 Jadwal Disetujui' : '⏳ Menunggu Konfirmasi')}
                    </span>
                  </div>
                </div>

                <div style="background:#eff6ff;padding:0.75rem 1rem;border-radius:8px;margin-bottom:0.75rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;">
                  <div>
                    <div style="font-size:0.75rem;color:#1e40af;font-weight:600;">Jadwal Pertemuan Tatap Muka:</div>
                    <strong style="font-size:1rem;color:#1e3a8a;">${meetingTimeStr} WIB</strong>
                  </div>
                  <a href="${escHtml(s.zoom_url)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm">
                    🚀 Masuk Ruang Zoom Siswa ↗
                  </a>
                </div>

                ${s.student_notes ? `<div style="font-size:0.8125rem;color:#475569;margin-bottom:0.75rem;"><strong>Catatan Topik:</strong> "${escHtml(s.student_notes)}"</div>` : ''}

                <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-top:0.5rem;padding-top:0.5rem;border-top:1px solid #f1f5f9;">
                  ${!isConfirmed && !isApproved ? `
                    <button type="button" class="btn btn-primary btn-sm" onclick="quickConfirmZoomSchedule('${s.id}', '${course.id}')" style="font-weight:700;">
                      🤝 Setujui Jadwal Ini
                    </button>
                  ` : ''}
                  <button type="button" class="btn btn-outline btn-sm" onclick="openModalConfirmZoomSchedule('${s.id}')">
                    📅 Atur / Ubah Jadwal
                  </button>
                  <button type="button" class="btn btn-secondary btn-sm" onclick="openModalReviewSubmission('${s.id}')" style="font-weight:700;">
                    ⚡ ${isApproved ? 'Ubah Penilaian' : 'Evaluasi & Beri Kelulusan Sesi'}
                  </button>
                </div>
              </div>
            `;
          }).join('');
        }

        contentHtml = `
          <div style="max-width:780px;margin:0 auto;line-height:1.7;">
            <div style="background:linear-gradient(135deg, #1e1b4b 0%, #312e81 100%);color:#fff;border-radius:12px;padding:1.25rem 1.5rem;margin-bottom:1.5rem;box-shadow:var(--shadow-2);display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;">
              <div>
                <span class="badge" style="background:#4338ca;color:#e0e7ff;font-weight:700;margin-bottom:0.35rem;display:inline-block;">👨‍🏫 Panel Tutor</span>
                <h3 style="margin:0;font-size:1.2rem;color:#fff;">Sesi Zoom: ${escHtml(currentUnit.title)}</h3>
                <p style="margin:0.25rem 0 0;font-size:0.8125rem;color:#c7d2fe;">
                  Kelola usulan jadwal tatap muka virtual dari peserta didik, setujui waktu temu, dan berikan evaluasi kelulusan.
                </p>
              </div>
              <button type="button" class="btn btn-sm" style="background:rgba(255,255,255,0.15);color:#fff;border:1px solid rgba(255,255,255,0.3);" onclick="refreshApprovalsFromPlayer('${currentUnit.id}', '${course.id}')">
                🔄 Muat Ulang
              </button>
            </div>

            ${tutorListHtml}
          </div>
        `;
      } else {
        // --- TAMPILAN SISWA ZOOM ---
        const studentId = AppState.user?.id;
        const sub = (AppState.submissions || []).find(s => s.student_id === studentId && s.content_id === currentUnit.id);
        const isApproved = sub && sub.approval_status === 'approved';
        const isRejected = sub && sub.approval_status === 'rejected';
        const isPending = sub && sub.approval_status === 'pending';

        let zoomStatusHtml = '';
        if (sub) {
          const meetingDateObj = sub.zoom_meeting_time ? new Date(sub.zoom_meeting_time) : null;
          const meetingTimeStr = meetingDateObj ? meetingDateObj.toLocaleString('id-ID', { dateStyle: 'full', timeStyle: 'short' }) : 'Belum ditentukan';
          const isScheduleConfirmed = sub.schedule_status === 'confirmed';

          const waConfirmUrl = buildWhatsAppZoomConfirmation(tutor, AppState.user || { name: 'Peserta' }, course, currentUnit, meetingTimeStr, sub.zoom_url, false);
          const waArrivedUrl = buildWhatsAppZoomConfirmation(tutor, AppState.user || { name: 'Peserta' }, course, currentUnit, meetingTimeStr, sub.zoom_url, true);

          zoomStatusHtml = `
            <div class="submission-status-card ${isApproved ? 'approved' : (isRejected ? 'rejected' : 'pending')}">
              <div class="submission-status-header">
                <div class="submission-status-title">
                  <span>📹</span> ${isApproved ? 'Sesi Zoom Selesai & Disetujui' : (isScheduleConfirmed ? 'Jadwal Zoom Dikonfirmasi Tutor 🤝' : 'Pengajuan Jadwal Pertemuan')}
                </div>
                <span class="badge ${isApproved ? 'badge-success' : (isScheduleConfirmed ? 'badge-primary' : 'badge-warning')}">
                  ${isApproved ? '✅ Lulus Tema' : (isScheduleConfirmed ? 'Jadwal Disetujui' : 'Menunggu Konfirmasi')}
                </span>
              </div>

              ${sub.zoom_url ? `
                <div style="background:#fff;border:1px solid rgba(0,0,0,0.08);border-radius:10px;padding:1rem;margin-top:0.5rem;">
                  <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.75rem;">
                    <div>
                      <span style="font-size:0.75rem;color:var(--tertiary);display:block;">Waktu Pertemuan Tatap Muka:</span>
                      <strong style="font-size:1rem;color:var(--primary);">${meetingTimeStr} WIB</strong>
                    </div>
                    <div style="display:flex;gap:0.5rem;align-items:center;">
                      <a href="${escHtml(sub.zoom_url)}" target="_blank" rel="noopener noreferrer" class="btn-zoom-join">
                        🚀 Masuk Ruang Zoom ↗
                      </a>
                      <button type="button" class="btn btn-outline btn-sm" onclick="openZoomEditForm()" title="Ubah Link Zoom atau Usulan Jadwal">✏️ Ubah</button>
                    </div>
                  </div>
                  <div style="font-size:0.8125rem;color:var(--tertiary);word-break:break-all;">
                    Link Room: <a href="${escHtml(sub.zoom_url)}" target="_blank" rel="noopener noreferrer" style="color:var(--primary);font-weight:600;">${escHtml(sub.zoom_url)}</a>
                  </div>
                </div>
              ` : `
                <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:1rem;margin-top:0.5rem;">
                  <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.5rem;">
                    <div>
                      <span style="font-size:0.75rem;color:#1e40af;display:block;">Usulan Jadwal Pertemuan:</span>
                      <strong style="font-size:1rem;color:#1e3a8a;">${meetingTimeStr} WIB</strong>
                    </div>
                    <button type="button" class="btn btn-outline btn-sm" onclick="openZoomEditForm()">✏️ Ubah Jadwal</button>
                  </div>
                  <div style="background:#ffffff;padding:0.75rem;border-radius:8px;border:1px solid #dbeafe;margin-top:0.5rem;">
                    <strong style="font-size:0.8125rem;color:#1e40af;display:block;margin-bottom:0.25rem;">
                      ${isScheduleConfirmed ? '🤝 Jadwal Telah Disetujui! Silakan Masukkan Link Zoom Pertemuan Anda:' : '🔗 Sertakan Tautan Zoom Pertemuan (Bisa sekarang atau setelah jadwal dikonfirmasi):'}
                    </strong>
                    <form onsubmit="handleUpdateZoomUrl(event, '${sub.id}', '${course.id}')" style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.5rem;">
                      <input type="url" id="quick-zoom-url" class="form-control" style="flex:1;min-width:220px;" placeholder="https://us04web.zoom.us/j/... atau Google Meet" required>
                      <button type="submit" class="btn btn-primary btn-sm">Simpan Link Zoom</button>
                    </form>
                  </div>
                </div>
              `}

              ${isApproved ? `
                <div class="submission-feedback-box" style="margin-top:0.5rem;">
                  <strong>Nilai & Ulasan Tutor (${escHtml(tutor.name)}):</strong><br>
                  ${escHtml(sub.tutor_feedback || 'Sesi tatap muka virtual berjalan sangat baik. Pemahaman Anda telah teruji dengan lancar.')}
                  <div style="margin-top:0.75rem;">
                    <button class="btn btn-primary" onclick="nextPlayerUnit()">
                      Lanjut ke Tema Berikutnya →
                    </button>
                  </div>
                </div>
              ` : `
                <!-- Tombol Notifikasi WhatsApp ke Tutor -->
                <div style="margin-top:0.75rem;padding:1rem;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;">
                  <div style="font-weight:700;color:#166534;font-size:0.875rem;margin-bottom:0.35rem;">
                    💬 Koordinasi Langsung via WhatsApp Tutor Pengampu
                  </div>
                  <p style="font-size:0.8125rem;color:#15803d;margin-bottom:0.75rem;line-height:1.5;">
                    Gunakan tombol di bawah ini untuk mengirim pesan konfirmasi otomatis ke WhatsApp <strong>${escHtml(tutor.name)}</strong>:
                  </p>
                  <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
                    <a href="${waConfirmUrl}" target="_blank" rel="noopener noreferrer" class="btn-whatsapp">
                      <svg viewBox="0 0 24 24"><path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.711 2.598 2.664-.698c.969.584 1.761.813 2.796.814 3.183 0 5.769-2.587 5.769-5.767 0-3.181-2.586-5.768-5.769-5.768zm7.969 5.766c0 4.398-3.572 7.969-7.969 7.969-1.393 0-2.696-.36-3.83-1l-4.181 1.095 1.115-4.083c-.724-1.189-1.104-2.56-1.104-3.981 0-4.398 3.572-7.969 7.969-7.969 4.397 0 7.969 3.571 7.969 7.969z"/></svg>
                      Konfirmasi Jadwal via WhatsApp
                    </a>
                    <a href="${waArrivedUrl}" target="_blank" rel="noopener noreferrer" class="btn-whatsapp" style="background:#0f766e;">
                      <svg viewBox="0 0 24 24"><path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.711 2.598 2.664-.698c.969.584 1.761.813 2.796.814 3.183 0 5.769-2.587 5.769-5.767 0-3.181-2.586-5.768-5.769-5.768zm7.969 5.766c0 4.398-3.572 7.969-7.969 7.969-1.393 0-2.696-.36-3.83-1l-4.181 1.095 1.115-4.083c-.724-1.189-1.104-2.56-1.104-3.981 0-4.398 3.572-7.969 7.969-7.969 4.397 0 7.969 3.571 7.969 7.969z"/></svg>
                      ⏰ Sudah Waktunya Zoom! Beritahu Tutor
                    </a>
                  </div>
                </div>
              `}
            </div>
          `;
        }

        const showZoomForm = !sub || isRejected;
        const defaultTomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

        contentHtml = `
          <div style="max-width:760px;margin:0 auto;line-height:1.7;">
            <!-- Widget Kontak WhatsApp Tutor -->
            ${renderTutorContactCard(tutor, course, currentUnit, '💬 Kontak WhatsApp Tutor')}

            <div class="assignment-card">
              <div class="assignment-card-header">
                <h3 class="assignment-card-title">
                  <span>📹</span> ${escHtml(currentUnit.title)}
                </h3>
                <span class="badge badge-primary">Sesi Tatap Muka Virtual</span>
              </div>
              <div class="assignment-card-body">
                <div class="assignment-instruction-box">
                  ${currentUnit.contentBody || '<p>Sediakan tautan ruang Zoom Meeting Anda dan usulkan waktu pertemuan tatap muka langsung bersama tutor pengampu.</p>'}
                </div>

                ${zoomStatusHtml}

                <div id="zoom-form-container" style="display:${showZoomForm ? 'block' : 'none'};margin-top:1rem;">
                  <form id="form-submit-zoom" onsubmit="handleStudentSubmitZoom(event, '${course.id}', '${currentUnit.id}', '${currentUnit.moduleId || ''}')">
                    <div class="form-group">
                      <label class="form-label" style="font-weight:700;">
                        Tautan Ruang Zoom Meeting (Bisa disertakan sekarang atau setelah jadwal disetujui)
                      </label>
                      <input type="url" id="input-zoom-url" class="form-control" placeholder="https://us04web.zoom.us/j/... atau https://meet.google.com/..." value="${escHtml(sub?.zoom_url || '')}">
                      <small style="color:var(--tertiary);font-size:0.75rem;display:block;margin-top:0.35rem;">
                        💡 <strong>Saran:</strong> Anda dapat langsung menyertakan link Zoom agar tutor dapat meninjau jadwal &amp; tautan sekaligus, atau menambahkannya setelah jadwal disepakati.
                      </small>
                    </div>

                    <div class="zoom-datetime-grid">
                      <div class="form-group">
                        <label class="form-label" style="font-weight:700;">Usulan Tanggal Pertemuan <span style="color:var(--error);">*</span></label>
                        <input type="date" id="input-zoom-date" class="form-control" value="${defaultTomorrow}" required>
                      </div>
                      <div class="form-group">
                        <label class="form-label" style="font-weight:700;">Usulan Jam (WIB) <span style="color:var(--error);">*</span></label>
                        <input type="time" id="input-zoom-time" class="form-control" value="14:00" required>
                      </div>
                    </div>

                    <div class="form-group">
                      <label class="form-label">Catatan Topik Diskusi / Ketersediaan Waktu (Opsional)</label>
                      <textarea id="input-zoom-notes" class="form-control" rows="2" placeholder="Tuliskan topik bahasan materi yang ingin dikonsultasikan...">${escHtml(sub?.student_notes || '')}</textarea>
                    </div>

                    <button type="submit" class="btn btn-primary" style="padding:0.75rem 2rem;font-size:0.95rem;width:100%;">
                      📅 Ajukan Jadwal Pertemuan Tatap Muka
                    </button>
                  </form>
                </div>
              </div>
            </div>
          </div>
        `;
      }
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
        const isYoutube = currentUnit.embedUrl.includes('youtube.com') || currentUnit.embedUrl.includes('youtu.be');
        const isDirectVideo = !isYoutube && (
          currentUnit.embedUrl.toLowerCase().includes('.mp4') ||
          currentUnit.embedUrl.toLowerCase().includes('.webm') ||
          currentUnit.embedUrl.toLowerCase().includes('.ogg') ||
          currentUnit.embedUrl.toLowerCase().includes('/storage/') ||
          typeLower === 'video'
        );

        if (isDirectVideo && !isYoutube) {
          contentHtml = `
            <div class="video-player-container">
              <video id="lms-custom-video" src="${escHtml(currentUnit.embedUrl)}" controls controlsList="nodownload noplaybackrate" disablePictureInPicture playsinline preload="auto" style="width:100%;border-radius:12px;background:#000;display:block;">
                <source src="${escHtml(currentUnit.embedUrl)}" type="video/mp4">
                Browser Anda tidak mendukung tag video HTML5.
              </video>
            </div>
            ${currentUnit.contentBody ? `<div class="reading-content-area" style="line-height:1.9;" dir="auto">${currentUnit.contentBody}</div>` : ''}
          `;
        } else if (isYoutube) {
          const ytMatch = currentUnit.embedUrl.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
          const ytId = ytMatch ? ytMatch[1] : '';
          const hasOrigin = window.location.origin && window.location.origin !== 'null' && !window.location.origin.startsWith('file');
          const originParam = hasOrigin ? `&origin=${encodeURIComponent(window.location.origin)}` : '';
          const embedSrc = ytId
            ? `https://www.youtube.com/embed/${ytId}?enablejsapi=1${originParam}&rel=0&modestbranding=1`
            : currentUnit.embedUrl.replace('watch?v=', 'embed/').replace('youtu.be/', 'www.youtube.com/embed/');

          contentHtml = `
            <div class="video-player-container" style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:12px;margin-bottom:1.5rem;background:#000;">
              <iframe id="lms-youtube-iframe" src="${embedSrc}" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" allowfullscreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe>
            </div>
            ${currentUnit.contentBody ? `<div class="reading-content-area" style="line-height:1.9;" dir="auto">${currentUnit.contentBody}</div>` : ''}
          `;
        }
      } else {
        contentHtml = `<div class="reading-content-area" style="line-height:1.9;" dir="auto">${currentUnit.contentBody || '<p style="color:var(--tertiary);">Konten belum tersedia.</p>'}</div>`;
      }
    }

    // Timer badge untuk materi teks / video
    let timerWidgetHtml = '';
    const isVideoUnit = typeLower === 'video' || (currentUnit.embedUrl && (currentUnit.embedUrl.endsWith('.mp4') || currentUnit.embedUrl.includes('youtube') || currentUnit.embedUrl.includes('youtu.be') || currentUnit.embedUrl.includes('/storage/v1/object/public/')));
    const targetSeconds = parseDurationSeconds(currentUnit.duration, currentUnit.contentBody);

    let savedElapsed = AppState.unitStudyElapsed[currentUnit.id];
    if (savedElapsed === undefined || savedElapsed === null) {
      const stored = localStorage.getItem('lms_study_elapsed_' + currentUnit.id);
      savedElapsed = stored ? parseInt(stored, 10) : 0;
    }
    const initialRem = Math.max(0, targetSeconds - (savedElapsed || 0));
    const remM = Math.floor(initialRem / 60);
    const remS = initialRem % 60;
    const initialPct = Math.min(100, Math.round(((savedElapsed || 0) / targetSeconds) * 100));

    if ((isStudent || forceTest) && (!isCompleted || forceTest) && !isQuizUnit) {
      if (isVideoUnit) {
        timerWidgetHtml = `
          <div class="study-timer-badge video-timer" id="study-timer-display" title="Tonton video pembelajaran ini hingga tuntas">
            <span>🎥</span>
            <div class="study-timer-bar"><div class="study-timer-fill" id="study-timer-progress" style="width:0%;"></div></div>
            <span id="study-timer-text">0:00 / 0:00 (0%)</span>
          </div>
        `;
      } else {
        timerWidgetHtml = `
          <div class="study-timer-badge text-timer" id="study-timer-display" title="Estimasi waktu membaca materi ini untuk membuka sesi berikutnya">
            <span>⏱️</span>
            <div class="study-timer-bar"><div class="study-timer-fill" id="study-timer-progress" style="width:${initialPct}%;"></div></div>
            <span id="study-timer-text">${remM}:${remS < 10 ? '0' : ''}${remS} tersisa</span>
          </div>
        `;
      }
    } else if (isCompleted && !forceTest && !isQuizUnit) {
      timerWidgetHtml = `
        <div class="study-timer-badge completed">
          <span>✓</span>
          <span>Selesai Dipelajari</span>
        </div>
      `;
    }

    // Tombol Selanjutnya / Next Action State
    let nextBtnDisabled = false;
    let nextBtnClass = 'btn-next-action';
    let nextBtnHtml = '<span>Selanjutnya →</span>';

    if (isStudent && !isCompleted) {
      nextBtnDisabled = true;
      nextBtnClass = 'btn-next-action locked';

      if (isQuizUnit) {
        nextBtnHtml = '<span>🔒 Kerjakan & Kumpulkan Kuis Dulu</span>';
      } else if (typeLower === 'tugas_drive') {
        const studentId = AppState.user?.id;
        const sub = (AppState.submissions || []).find(s => s.student_id === studentId && s.content_id === currentUnit.id);
        if (!sub) {
          nextBtnHtml = '<span>🔒 Kumpulkan Link Google Drive Dulu</span>';
        } else if (sub.approval_status === 'pending') {
          nextBtnHtml = '<span>⏳ Menunggu Persetujuan Tutor</span>';
        } else if (sub.approval_status === 'rejected') {
          nextBtnHtml = '<span>⚠️ Perlu Revisi Tugas</span>';
        }
      } else if (typeLower === 'tugas_zoom') {
        nextBtnHtml = '<span>🔒 Jadwalkan & Hadiri Sesi Zoom Dulu</span>';
      } else if (isVideoUnit) {
        nextBtnHtml = '<span>🔒 Tonton Video Hingga Selesai</span>';
      } else {
        const durLabel = `${remM}:${remS < 10 ? '0' : ''}${remS}`;
        nextBtnHtml = `<span>🔒 Membaca Materi (Sisa <strong id="next-btn-countdown">${durLabel}</strong>)</span>`;
      }
    } else if (isCompleted) {
      nextBtnClass = 'btn-next-action ready';
      nextBtnHtml = '<span>✅ Selesai — Lanjutkan →</span>';
    }

    // Tutor Simulator Toggle (Hanya untuk Tutor / Admin)
    let simulationToggleHtml = '';
    if (AppState.currentRole !== 'student') {
      simulationToggleHtml = `
        <button class="btn btn-outline btn-sm" onclick="toggleStudentSimulation()" style="font-size:0.75rem;padding:0.25rem 0.65rem;" title="Simulasikan kunci video dan timer baca persis seperti siswa">
          ${AppState.isSimulatingStudent ? '🔓 Matikan Simulasi Siswa' : '👁️ Uji Kunci Siswa'}
        </button>
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
            <div class="player-header-info">
              <div class="player-header-top-row">
                <span class="badge badge-${(currentUnit.type || 'materi').toLowerCase()}">${currentUnit.type}</span>
                ${timerWidgetHtml}
              </div>
              <h2 class="player-unit-main-heading" dir="auto">${escHtml(currentUnit.title)}</h2>
            </div>
            <div class="player-header-actions">
              ${simulationToggleHtml}
              <button class="btn btn-outline btn-sm" onclick="toggleIFPMode()" id="ifp-toggle-btn" title="Mode Layar Penuh (Fullscreen)">
                🖥️ Fullscreen
              </button>
            </div>
          </div>

          <div class="player-content-body" id="player-body" dir="auto">
            ${contentHtml}
          </div>

          <!-- Footer Bersih: Tombol Selanjutnya dengan Proteksi Penguncian -->
          <div class="player-content-footer-clean">
            <div style="display:flex;align-items:center;justify-content:space-between;width:100%;">
              <button class="btn btn-outline btn-sm" onclick="prevPlayerUnit()" ${AppState.activeUnitIndex === 0 ? 'disabled style="opacity:.4;"' : ''}>
                ← Sebelumnya
              </button>
              <button class="${nextBtnClass}" onclick="onNextButtonClicked()" id="btn-player-next" ${nextBtnDisabled ? 'disabled' : ''}>
                ${nextBtnHtml}
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    // Pasang listener penguncian video dan timer belajar otomatis jika bukan kuis
    if (!isQuizUnit) {
      clearQuizCountdownTimer();
      initUnitInteractions(currentUnit, course, targetSeconds, isVideoUnit);
    } else {
      if (!showResultScreen) {
        startQuizCountdownTimer(currentUnit, AppState.activeUnitIndex);
      } else {
        clearQuizCountdownTimer();
      }
    }
  }

  // 7. Progress Report (data dari Supabase)
  async function renderProgressReport(container) {
    container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:50vh;"><div class="spinner"></div></div>`;

    const sb = typeof getSupabase === 'function' ? getSupabase() : null;

    if (!sb || AppState.isDemoMode) {
      renderProgressReportStatic(container);
      return;
    }

    try {
      if (AppState.currentRole === 'student') {
        // Laporan personal siswa
        const studentId = AppState.user?.id;
        const { data: rawProgress, error: progErr } = await sb
          .from('progress')
          .select('*')
          .eq('student_id', studentId)
          .order('completed_at', { ascending: false });

        if (progErr) throw progErr;
        const progressData = rawProgress || [];
        AppState.allProgressRecords = progressData;

        // Ambil submissions siswa untuk melengkapi status unit tugas/zoom
        const studentSubmissions = (AppState.submissions || []).filter(sub => sub.student_id === studentId);

        const rows = progressData.map(p => {
          const course = AppState.courses.find(c => c.id === p.course_id);
          const unit = course?.contents?.find(u => u.id === p.content_id);
          const typeLower = (unit?.type || 'materi').toLowerCase();
          const isDone = p.status === 'Selesai' || p.is_passed !== false;
          let scoreText = '-';
          if (p.score !== null && p.score !== undefined && typeLower !== 'tugas_zoom') {
            scoreText = `${p.score}/100`;
          } else if (typeLower === 'tugas_zoom') {
            scoreText = isDone ? 'Terlaksana' : '-';
          }

          return `
            <tr>
              <td style="color:var(--primary);font-weight:600;">${escHtml(course?.title || '-')}</td>
              <td>${escHtml(unit?.title || p.content_id || '-')}</td>
              <td><span class="badge badge-${typeLower}">${unit?.type || 'Materi'}</span></td>
              <td><span class="badge ${isDone ? 'badge-success' : 'badge-draft'}">${isDone ? '✅ Selesai' : '⏳ Proses'}</span></td>
              <td style="font-weight:700;color:#0f766e;">${scoreText}</td>
              <td>${p.completed_at ? new Date(p.completed_at).toLocaleDateString('id-ID', { dateStyle: 'medium' }) : '-'}</td>
            </tr>
          `;
        }).join('');

        const studentCourse = AppState.courses[0];

        container.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem;flex-wrap:wrap;gap:1rem;">
            <div>
              <h2>Capaian Belajar Saya</h2>
              <p>Riwayat unit materi dan evaluasi yang telah Anda selesaikan secara realtime.</p>
            </div>
            ${studentCourse ? `
              <button class="btn btn-primary" onclick="exportPDF('${escHtml(AppState.user?.name || 'Peserta Didik')}', '${studentCourse.id}', '${studentId}')">
                📄 Cetak / Unduh Laporan PDF Resmi (A4)
              </button>
            ` : ''}
          </div>
          <div class="table-container">
            <table class="data-table">
              <thead><tr><th>Course</th><th>Unit Materi</th><th>Jenis</th><th>Status</th><th>Nilai</th><th>Diselesaikan</th></tr></thead>
              <tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:var(--tertiary);padding:2rem;">Belum ada unit yang diselesaikan.</td></tr>'}</tbody>
            </table>
          </div>
        `;
      } else {
        // Admin/Educator: laporan capaian semua siswa
        const { data: rawProgress, error: progErr } = await sb
          .from('progress')
          .select('*')
          .order('completed_at', { ascending: false });

        if (progErr) throw progErr;
        const progressData = rawProgress || [];
        AppState.allProgressRecords = progressData;

        const isEducator = AppState.currentRole === 'educator';
        const tutorId = AppState.user?.id;
        const tutorName = AppState.user?.name;
        const myCourseIds = isEducator
          ? AppState.courses
              .filter(c => c.authorId === tutorId || c.author_id === tutorId || c.instructor_id === tutorId || c.authorName === tutorName)
              .map(c => c.id)
          : null;

        // Agregasi: hitung progress per siswa per course
        const byStudentCourse = {};

        // Inisialisasi dari progress yang ada
        progressData.forEach(p => {
          if (isEducator && myCourseIds && !myCourseIds.includes(p.course_id)) {
            return;
          }
          const key = `${p.student_id}::${p.course_id}`;
          const st = AppState.students.find(s => s.id === p.student_id) || { name: 'Peserta Didik', class: 'Kelas X' };
          const cr = AppState.courses.find(c => c.id === p.course_id) || { title: 'Course Pembelajaran' };

          if (!byStudentCourse[key]) {
            byStudentCourse[key] = {
              studentName: st.name || '-',
              className: st.class || '-',
              courseTitle: cr.title || '-',
              courseId: p.course_id,
              studentId: p.student_id,
              count: 0,
              scores: []
            };
          }
          if (p.status === 'Selesai' || p.is_passed !== false) {
            byStudentCourse[key].count++;
          }
          if (typeof p.score === 'number' && p.score !== null) {
            byStudentCourse[key].scores.push(p.score);
          }
        });

        // Sertakan juga siswa yang terdaftar aktif di course meskipun belum mulai
        const targetCourses = isEducator && myCourseIds
          ? AppState.courses.filter(c => myCourseIds.includes(c.id))
          : AppState.courses;

        (targetCourses || []).forEach(c => {
          (AppState.students || []).forEach(st => {
            const key = `${st.id}::${c.id}`;
            const hasProg = progressData.some(p => p.student_id === st.id && p.course_id === c.id);
            if (hasProg && !byStudentCourse[key]) {
              byStudentCourse[key] = {
                studentName: st.name || '-',
                className: st.class || '-',
                courseTitle: c.title || '-',
                courseId: c.id,
                studentId: st.id,
                count: 0,
                scores: []
              };
            }
          });
        });

        const rows = Object.values(byStudentCourse).map(row => {
          const course = AppState.courses.find(c => c.id === row.courseId);
          const total = course ? course.contents.length : 1;
          const pct = total > 0 ? Math.min(100, Math.round((row.count / total) * 100)) : 0;
          const avgScore = row.scores.length > 0 
            ? Math.round(row.scores.reduce((a, b) => a + b, 0) / row.scores.length)
            : (pct >= 100 ? 90 : (pct > 0 ? 80 : '-'));

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
              <td style="text-align:center;font-weight:700;color:#0f766e;">${avgScore}</td>
              <td>
                <button class="btn btn-outline btn-sm" onclick="exportPDF('${escHtml(row.studentName)}', '${row.courseId}', '${row.studentId}')">📄 Cetak PDF</button>
              </td>
            </tr>
          `;
        }).join('');

        container.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem;flex-wrap:wrap;gap:1rem;">
            <div>
              <h2>Laporan Capaian Belajar</h2>
              <p>Rekapitulasi aktivitas dan progres capaian nyata seluruh peserta didik dari database.</p>
            </div>
            <button class="btn btn-primary" onclick="exportBatchPDF()">📄 Ekspor PDF Seluruh Siswa</button>
          </div>
          <div class="table-container">
            <table class="data-table">
              <thead><tr><th>Nama Siswa</th><th>Rombel</th><th>Course</th><th>Unit Selesai</th><th>Persentase</th><th>Rata-rata Nilai</th><th>Ekspor</th></tr></thead>
              <tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:var(--tertiary);padding:2rem;">Belum ada data progress siswa.</td></tr>'}</tbody>
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
    // Pendidik dan admin bebas akses (kecuali mode simulasi siswa aktif)
    if (AppState.currentRole !== 'student' && !AppState.isSimulatingStudent) return false;
    // Unit pertama (Pre-Exam) selalu terbuka
    if (idx <= 0) return false;

    // 1. Terkunci jika unit tepat sebelumnya belum berstatus selesai
    if (!course.contents[idx - 1].completed) return true;

    // 2. GERBANG PERSYARATAN TEMA / BAB (Sequential Theme Locking by Tutor Approval)
    const targetUnit = course.contents[idx];
    const targetChapter = targetUnit.sectionName || (targetUnit.moduleId && course.modules?.find(m => m.id === targetUnit.moduleId)?.title) || '';

    // Periksa apakah bab-bab sebelum targetChapter memiliki tugas gerbang yang belum disetujui tutor
    for (let i = 0; i < idx; i++) {
      const u = course.contents[i];
      const ch = u.sectionName || (u.moduleId && course.modules?.find(m => m.id === u.moduleId)?.title) || '';
      
      // Jika u berada di bab yang berbeda dengan targetUnit (u adalah bab sebelum targetChapter)
      if (ch && targetChapter && ch !== targetChapter) {
        const typeLower = (u.type || '').toLowerCase();
        const isThemeGate = typeLower === 'tugas_drive' || typeLower === 'tugas_zoom' || (typeLower === 'tugas' && (u.title.toLowerCase().includes('tugas') || u.title.toLowerCase().includes('lembar')));
        
        if (isThemeGate) {
          const studentId = AppState.user?.id;
          const sub = (AppState.submissions || []).find(s => s.student_id === studentId && s.content_id === u.id);
          const isApproved = u.completed && sub && sub.approval_status === 'approved';

          // Jika tugas gerbang tema sebelumnya belum diapprove oleh tutor, maka targetUnit terkunci mutlak!
          if (!isApproved) {
            return true;
          }
        }
      }
    }

    return false;
  }

  function toggleStudentSimulation() {
    AppState.isSimulatingStudent = !AppState.isSimulatingStudent;
    showToast(
      AppState.isSimulatingStudent 
        ? '🔒 Mode Simulasi Siswa Aktif: Penguncian video & timer baca berlaku persis seperti akun siswa.' 
        : '🔓 Mode Pendidik Aktif: Penguncian dinonaktifkan (bebas akses).', 
      'info'
    );
    renderCoursePlayer(document.getElementById('view-container'), AppState.activeCoursePlayer.id);
  }

  function toggleChapterAccordion(chTitle, event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    AppState.expandedChapters[chTitle] = !AppState.expandedChapters[chTitle];
    const isExp = !!AppState.expandedChapters[chTitle];

    // Toggle langsung di DOM tanpa re-render player agar video/timer tidak terganggu
    const cards = document.querySelectorAll('.player-chapter-card');
    let found = false;
    cards.forEach(card => {
      const titleEl = card.querySelector('.player-chapter-title');
      if (titleEl && titleEl.textContent.trim() === (chTitle || '').trim()) {
        card.classList.toggle('expanded', isExp);
        const chev = card.querySelector('.player-chapter-chevron');
        if (chev) {
          chev.style.transform = isExp ? 'rotate(180deg)' : 'rotate(0deg)';
        }
        found = true;
      }
    });

    if (!found && AppState.activeCoursePlayer) {
      renderCoursePlayer(document.getElementById('view-container'), AppState.activeCoursePlayer.id);
    }
  }

  function selectQuizOption(unitIdOrQId, optIdx, maybeOptIdx) {
    let unitId, qId, chosenOpt;
    if (maybeOptIdx !== undefined) {
      unitId = unitIdOrQId;
      qId = optIdx;
      chosenOpt = maybeOptIdx;
    } else {
      const course = AppState.activeCoursePlayer;
      const currentUnit = course?.contents?.[AppState.activeUnitIndex];
      unitId = currentUnit ? currentUnit.id : 'default';
      qId = unitIdOrQId;
      chosenOpt = optIdx;
    }

    if (!AppState.activeQuizAnswers) AppState.activeQuizAnswers = {};
    if (!AppState.activeQuizAnswers[unitId]) AppState.activeQuizAnswers[unitId] = {};
    AppState.activeQuizAnswers[unitId][qId] = chosenOpt;

    const qEl = document.getElementById(`quiz-q-${qId}`);
    if (qEl) {
      qEl.querySelectorAll('.exam-option-card').forEach((card, idx) => {
        card.classList.toggle('selected', idx === chosenOpt);
        const radio = card.querySelector('input[type="radio"]');
        if (radio) radio.checked = (idx === chosenOpt);
      });
    }
  }

  function parseDurationMinutes(durStr, defaultMinutes = 15) {
    if (durStr && typeof durStr === 'string') {
      const str = durStr.toLowerCase();
      const match = str.match(/\d+(\.\d+)?/);
      if (match) {
        const val = parseFloat(match[0]);
        if (str.includes('detik') || str.includes('sec')) {
          return Math.max(1, Math.ceil(val / 60));
        }
        if (str.includes('jam') || str.includes('hour')) {
          return Math.max(1, Math.round(val * 60));
        }
        return Math.max(1, Math.round(val));
      }
    }
    return defaultMinutes;
  }

  function shuffleArray(arr) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function getShuffledQuizSession(unit, forceReshuffle = false) {
    if (!unit) return [];
    if (!AppState.activeQuizSession) AppState.activeQuizSession = {};
    if (!forceReshuffle && AppState.activeQuizSession[unit.id]) {
      return AppState.activeQuizSession[unit.id];
    }

    const baseQuestions = getEffectiveQuizData(unit);
    const preparedQuestions = baseQuestions.map(q => {
      const originalOpts = Array.isArray(q.options) ? q.options : [];
      const originalAnswer = typeof q.answerIndex === 'number' ? q.answerIndex : 0;
      
      const mappedOpts = originalOpts.map((optText, optIdx) => ({
        text: optText,
        isCorrect: optIdx === originalAnswer,
        originalIndex: optIdx
      }));

      const shuffledOpts = shuffleArray(mappedOpts);
      const newAnswerIndex = shuffledOpts.findIndex(o => o.isCorrect);

      return {
        id: q.id,
        question: q.question,
        options: shuffledOpts.map(o => o.text),
        answerIndex: newAnswerIndex >= 0 ? newAnswerIndex : 0,
        explanation: q.explanation || ''
      };
    });

    const shuffledQuestions = shuffleArray(preparedQuestions);
    AppState.activeQuizSession[unit.id] = shuffledQuestions;
    return shuffledQuestions;
  }

  function clearQuizCountdownTimer() {
    if (AppState.quizCountdownInterval) {
      clearInterval(AppState.quizCountdownInterval);
      AppState.quizCountdownInterval = null;
    }
  }
  window.clearQuizCountdownTimer = clearQuizCountdownTimer;

  function startQuizCountdownTimer(unit, unitIdx) {
    clearQuizCountdownTimer();
    if (!unit) return;

    const durationMinutes = parseDurationMinutes(unit.duration, 15);
    const totalSecs = durationMinutes * 60;

    // Pertahankan sisa waktu jika sedang berada di unit yang sama
    if (AppState.activeQuizTimerUnitId !== unit.id || !AppState.activeQuizTimerStart) {
      AppState.activeQuizTimerUnitId = unit.id;
      AppState.activeQuizTimerTotalSecs = totalSecs;
      AppState.activeQuizTimerStart = Date.now();
    }

    const updateTimerDisplay = () => {
      const elapsed = Math.floor((Date.now() - AppState.activeQuizTimerStart) / 1000);
      const remaining = Math.max(0, AppState.activeQuizTimerTotalSecs - elapsed);
      const m = Math.floor(remaining / 60);
      const s = remaining % 60;
      const formatted = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

      const timerEl = document.getElementById('quiz-countdown-timer-display');
      if (timerEl) {
        timerEl.textContent = formatted;
        timerEl.classList.toggle('warning', remaining <= 180 && remaining > 60);
        timerEl.classList.toggle('critical', remaining <= 60);
      }

      if (remaining <= 0) {
        clearQuizCountdownTimer();
        delete AppState.activeQuizTimerUnitId;
        delete AppState.activeQuizTimerStart;
        delete AppState.activeQuizTimerTotalSecs;
        showToast('⏰ Waktu ujian telah habis! Jawaban Anda otomatis dikumpulkan.', 'info');
        submitActiveQuiz(unitIdx, true);
      }
    };

    updateTimerDisplay();
    AppState.quizCountdownInterval = setInterval(updateTimerDisplay, 1000);
  }
  window.startQuizCountdownTimer = startQuizCountdownTimer;

  function toggleQuizExplanation(unitId) {
    if (!AppState.quizExplanationOpen) AppState.quizExplanationOpen = {};
    const progress = (AppState.progressData && AppState.progressData[unitId]) || {};
    const course = AppState.activeCoursePlayer;
    const unit = course ? (course.contents || []).find(u => u.id === unitId) : null;
    const typeLower = ((unit && unit.type) || '').toLowerCase();
    const passGrade = (unit && unit.passingScore) || (typeLower === 'pre_exam' ? 60 : 70);
    const score = progress.score !== undefined ? progress.score : 0;
    const isPassed = progress.is_passed !== undefined ? progress.is_passed : (score >= passGrade);
    const isPrivileged = AppState.activeRole === 'educator' || AppState.activeRole === 'admin';

    if (!isPassed && !isPrivileged) {
      showToast('Kunci jawaban & pembahasan soal dirahasiakan sebelum Anda mencapai batas kelulusan (KKM).', 'warning');
      return;
    }

    AppState.quizExplanationOpen[unitId] = !AppState.quizExplanationOpen[unitId];
    if (AppState.activeCoursePlayer) {
      renderCoursePlayer(document.getElementById('view-container'), AppState.activeCoursePlayer.id);
    }
  }
  window.toggleQuizExplanation = toggleQuizExplanation;

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

  async function submitActiveQuiz(unitIdx, isAutoSubmit = false) {
    const course = AppState.activeCoursePlayer;
    if (!course) return;
    const unit = course.contents[unitIdx];
    if (!unit) return;

    const questions = getShuffledQuizSession(unit);
    const unitAnswers = (AppState.activeQuizAnswers && AppState.activeQuizAnswers[unit.id]) || {};

    if (!isAutoSubmit) {
      const unanswered = questions.filter(q => unitAnswers[q.id] === undefined);
      if (unanswered.length > 0) {
        showToast(`⚠️ Harap jawab seluruh pertanyaan (${questions.length - unanswered.length}/${questions.length} terjawab).`, 'warning');
        return;
      }
    }

    clearQuizCountdownTimer();
    delete AppState.activeQuizTimerUnitId;
    delete AppState.activeQuizTimerStart;
    delete AppState.activeQuizTimerTotalSecs;

    let correct = 0;
    questions.forEach(q => {
      if (unitAnswers[q.id] === q.answerIndex) correct++;
    });
    const wrong = questions.length - correct;
    const score = questions.length > 0 ? Math.round((correct / questions.length) * 100) : 0;
    const typeLower = (unit.type || '').toLowerCase();
    const isPreExam = typeLower === 'pre_exam' || unit.title.toLowerCase().includes('pre-exam');
    const passingScore = unit.passingScore || (isPreExam ? 60 : 70);
    const isPassed = score >= passingScore;

    const now = Date.now();
    const start = AppState.activeQuizStartTime || (now - (correct * 90 + wrong * 50) * 1000);
    const elapsedSecs = Math.max(30, Math.round((now - start) / 1000));

    let notes = '';
    if (isPreExam) {
      notes = score < passingScore
        ? 'Nilai awal kamu di bawah rata-rata. Sesi materi berikutnya masih terkunci. Pelajari kembali materi dan kerjakan ulang ya!'
        : 'Pemahaman awal Anda sudah baik. Pelajari modul kelas secara komprehensif untuk penguasaan mendalam.';
    } else {
      notes = score >= passingScore
        ? 'Luar biasa! Kamu telah menguasai kompetensi pada unit ini dengan sangat baik. Pertahankan prestasimu!'
        : 'Nilai kamu masih di bawah batas kelulusan. Sesi berikutnya masih terkunci. Pelajari kembali materi dan gunakan tombol Kerjakan Ulang untuk meningkatkan nilai.';
    }

    const reviewQuestions = questions.map(q => {
      const userChoice = unitAnswers[q.id] !== undefined ? unitAnswers[q.id] : -1;
      return {
        id: q.id,
        question: q.question,
        options: q.options,
        answerIndex: q.answerIndex,
        userAnswer: userChoice,
        explanation: q.explanation || 'Pembahasan materi ini menguji penguasaan kaidah standar pada topik pembelajaran.'
      };
    });

    const reviewData = {
      unitId: unit.id,
      submittedAt: new Date().toISOString(),
      score,
      correctAnswers: correct,
      wrongAnswers: wrong,
      isPassed,
      questions: reviewQuestions
    };

    if (!AppState.lastQuizResults) AppState.lastQuizResults = {};
    AppState.lastQuizResults[unit.id] = reviewData;

    try {
      localStorage.setItem('lms_quiz_review_' + unit.id, JSON.stringify(reviewData));
    } catch (e) {}

    const progressItem = {
      score,
      correct_answers: correct,
      wrong_answers: wrong,
      time_spent_seconds: elapsedSecs,
      notes,
      answers_data: reviewData,
      is_passed: isPassed
    };
    if (!AppState.progressData) AppState.progressData = {};
    AppState.progressData[unit.id] = progressItem;
    AppState.progressMap[unit.id] = isPassed;
    unit.completed = isPassed;

    if (!AppState.quizReviewMode) AppState.quizReviewMode = {};
    AppState.quizReviewMode[unit.id] = false;
    if (AppState.quizExplanationOpen) {
      delete AppState.quizExplanationOpen[unit.id];
    }

    try {
      await dbSubmitQuizResult({
        contentId: unit.id,
        courseId: course.id,
        score,
        correctAnswers: correct,
        wrongAnswers: wrong,
        timeSpentSeconds: elapsedSecs,
        notes,
        reviewData
      });
      if (isPassed) {
        showToast(isAutoSubmit ? '⏰ Waktu habis! Selamat, Anda lulus ujian!' : `🎉 Selamat! Anda lulus ujian dengan nilai ${score}/${passingScore}!`, 'success');
      } else {
        showToast(`⚠️ Nilai Anda (${score}) belum mencapai batas kelulusan (${passingScore}). Sesi berikutnya masih terkunci. Silakan kerjakan ulang.`, 'warning');
      }
    } catch (err) {
      console.warn('Simpan kuis lokal:', err);
    }

    renderCoursePlayer(document.getElementById('view-container'), course.id);
  }
  window.submitActiveQuiz = submitActiveQuiz;

  function retakeQuiz(unitIdx) {
    const course = AppState.activeCoursePlayer;
    if (!course) return;
    const unit = course.contents[unitIdx];
    if (!unit) return;

    clearQuizCountdownTimer();
    delete AppState.activeQuizTimerUnitId;
    delete AppState.activeQuizTimerStart;
    delete AppState.activeQuizTimerTotalSecs;

    if (AppState.quizExplanationOpen) {
      delete AppState.quizExplanationOpen[unit.id];
    }

    // Hapus sesi acak lama dan acak ulang susunan soal & opsi
    if (AppState.activeQuizSession) {
      delete AppState.activeQuizSession[unit.id];
    }
    getShuffledQuizSession(unit, true);

    if (!AppState.quizReviewMode) AppState.quizReviewMode = {};
    AppState.quizReviewMode[unit.id] = true;
    if (!AppState.activeQuizAnswers) AppState.activeQuizAnswers = {};
    AppState.activeQuizAnswers[unit.id] = {};
    AppState.activeQuizStartTime = Date.now();
    showToast('🎲 Remedial Kuis: Soal dan urutan pilihan jawaban telah diacak ulang. Selamat mengerjakan!', 'info');
    renderCoursePlayer(document.getElementById('view-container'), course.id);
  }
  window.retakeQuiz = retakeQuiz;

  async function onNextButtonClicked() {
    const course = AppState.activeCoursePlayer;
    if (!course) return;
    const currentUnit = course.contents[AppState.activeUnitIndex];
    if (!currentUnit) return;

    const typeLower = (currentUnit.type || '').toLowerCase();
    const isQuiz = ['pre_exam', 'kuis_popup', 'post_exam', 'kuis'].includes(typeLower);
    const isDrive = typeLower === 'tugas_drive';
    const isZoom = typeLower === 'tugas_zoom';
    const isVideo = typeLower === 'video' || (currentUnit.embedUrl && (currentUnit.embedUrl.endsWith('.mp4') || currentUnit.embedUrl.includes('youtube') || currentUnit.embedUrl.includes('youtu.be')));
    const isStudent = AppState.currentRole === 'student' || AppState.isSimulatingStudent;

    // VALIDASI PENGUNCIAN KETAT UNTUK SISWA:
    if (isStudent && !currentUnit.completed) {
      if (isQuiz) {
        showToast('⚠️ Harap kumpulkan jawaban kuis/ujian terlebih dahulu sebelum melanjutkan.', 'warning');
        return;
      }
      if (isDrive) {
        showToast('🔒 Kumpulkan link Google Drive dan tunggu persetujuan tutor sebelum melanjutkan ke bab berikutnya.', 'warning');
        return;
      }
      if (isZoom) {
        showToast('🔒 Sesi tatap muka Zoom harus disepakati dan disetujui tutor sebelum membuka bab berikutnya.', 'warning');
        return;
      }
      if (isVideo) {
        showToast('🔒 Tonton video pembelajaran ini hingga selesai untuk membuka sesi berikutnya.', 'warning');
        return;
      }
      // Materi teks bacaan: belum tuntas durasi baca
      showToast('🔒 Harap pelajari materi teks ini hingga waktu estimasi belajar tuntas sebelum melanjutkan.', 'warning');
      return;
    }

    // Jika Tutor / Admin (bukan mode simulasi), berikan fleksibilitas langsung lanjut
    if (!isStudent && !currentUnit.completed && !isQuiz) {
      await markUnitComplete(currentUnit.id, course.id);
      return;
    }

    nextPlayerUnit();
  }

  function selectPlayerUnit(idx) {
    const course = AppState.activeCoursePlayer;
    if (isUnitLocked(idx, course)) {
      const targetUnit = course.contents[idx];
      const targetChapter = targetUnit.sectionName || (targetUnit.moduleId && course.modules?.find(m => m.id === targetUnit.moduleId)?.title) || '';

      // Cek apakah terkunci karena tugas gerbang tema sebelumnya belum diapprove tutor
      let gatePending = null;
      for (let i = 0; i < idx; i++) {
        const u = course.contents[i];
        const ch = u.sectionName || (u.moduleId && course.modules?.find(m => m.id === u.moduleId)?.title) || '';
        if (ch && targetChapter && ch !== targetChapter) {
          const typeLower = (u.type || '').toLowerCase();
          const isGate = typeLower === 'tugas_drive' || typeLower === 'tugas_zoom' || (typeLower === 'tugas' && (u.title.toLowerCase().includes('tugas') || u.title.toLowerCase().includes('lembar')));
          if (isGate) {
            const studentId = AppState.user?.id;
            const sub = (AppState.submissions || []).find(s => s.student_id === studentId && s.content_id === u.id);
            if (!u.completed || !sub || sub.approval_status !== 'approved') {
              gatePending = { unit: u, chapter: ch, sub };
              break;
            }
          }
        }
      }

      if (gatePending) {
        if (!gatePending.sub) {
          showToast(`🔒 Bab "${targetChapter}" terkunci! Kumpulkan tugas tema "${gatePending.chapter}" terlebih dahulu.`, 'warning');
        } else if (gatePending.sub.approval_status === 'pending') {
          showToast(`⏳ Bab "${targetChapter}" terkunci! Tugas tema "${gatePending.chapter}" sedang menunggu peninjauan Tutor.`, 'warning');
        } else if (gatePending.sub.approval_status === 'rejected') {
          showToast(`⚠️ Bab "${targetChapter}" terkunci! Tugas tema "${gatePending.chapter}" perlu direvisi sesuai masukan tutor.`, 'error');
        }
        return;
      }

      const prevTitle = course.contents[idx - 1]?.title || 'sesi sebelumnya';
      showToast(`🔒 Sesi ini terkunci! Selesaikan "${prevTitle}" terlebih dahulu.`, 'warning');
      return;
    }
    clearQuizCountdownTimer();
    AppState.activeUnitIndex = idx;
    const currentUnit = course.contents[idx];
    const chName = currentUnit?.sectionName || (currentUnit?.moduleId && course.modules?.find(m => m.id === currentUnit.moduleId)?.title);
    if (chName) AppState.expandedChapters[chName] = true;

    try {
      localStorage.setItem('lms_last_active_route', JSON.stringify({
        viewId: 'course-player',
        param: course.id,
        role: AppState.currentRole,
        unitIndex: idx
      }));
      localStorage.setItem('lms_last_active_player', JSON.stringify({
        courseId: course.id,
        unitIndex: idx
      }));
    } catch (e) {}

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
      clearQuizCountdownTimer();
      AppState.activeUnitIndex = nextIdx;
      const nextUnit = course.contents[nextIdx];
      const chName = nextUnit?.sectionName || (nextUnit?.moduleId && course.modules?.find(m => m.id === nextUnit.moduleId)?.title);
      if (chName) AppState.expandedChapters[chName] = true;

      try {
        localStorage.setItem('lms_last_active_route', JSON.stringify({
          viewId: 'course-player',
          param: course.id,
          role: AppState.currentRole,
          unitIndex: nextIdx
        }));
        localStorage.setItem('lms_last_active_player', JSON.stringify({
          courseId: course.id,
          unitIndex: nextIdx
        }));
      } catch (e) {}

      renderCoursePlayer(document.getElementById('view-container'), course.id);
    }
  }

  function prevPlayerUnit() {
    if (AppState.activeUnitIndex > 0) {
      clearQuizCountdownTimer();
      AppState.activeUnitIndex--;
      const prevUnit = AppState.activeCoursePlayer?.contents[AppState.activeUnitIndex];
      const chName = prevUnit?.sectionName || (prevUnit?.moduleId && AppState.activeCoursePlayer?.modules?.find(m => m.id === prevUnit.moduleId)?.title);
      if (chName) AppState.expandedChapters[chName] = true;

      try {
        localStorage.setItem('lms_last_active_route', JSON.stringify({
          viewId: 'course-player',
          param: AppState.activeCoursePlayer?.id,
          role: AppState.currentRole,
          unitIndex: AppState.activeUnitIndex
        }));
        localStorage.setItem('lms_last_active_player', JSON.stringify({
          courseId: AppState.activeCoursePlayer?.id,
          unitIndex: AppState.activeUnitIndex
        }));
      } catch (e) {}

      renderCoursePlayer(document.getElementById('view-container'), AppState.activeCoursePlayer.id);
    }
  }

  // Pengatur Timer Belajar dan Penguncian Video
  let activeStudyInterval = null;
  let activeYtPlayer = null;
  let activeVisChangeHandler = null;

  function clearActiveStudyTimer() {
    if (activeStudyInterval) {
      clearInterval(activeStudyInterval);
      activeStudyInterval = null;
    }
    if (activeVisChangeHandler) {
      document.removeEventListener('visibilitychange', activeVisChangeHandler);
      activeVisChangeHandler = null;
    }
    if (activeYtPlayer) {
      try {
        if (typeof activeYtPlayer.destroy === 'function') activeYtPlayer.destroy();
      } catch (e) {}
      activeYtPlayer = null;
    }
  }

  function initUnitInteractions(currentUnit, course, targetSeconds, isVideoUnit) {
    clearActiveStudyTimer();

    const forceTest = (AppState.forceTestAntiSkip && AppState.forceTestAntiSkip[currentUnit.id]) || false;
    const isStudent = AppState.currentRole === 'student' || AppState.isSimulatingStudent || forceTest;
    
    // Jika bukan siswa dan tidak dalam mode uji coba/simulasi, atau jika sudah selesai tanpa mode uji coba:
    if (!isStudent) return;
    if (currentUnit.completed && !AppState.isSimulatingStudent && !forceTest) return;

    const videoEl = document.getElementById('lms-custom-video');
    const ytIframe = document.getElementById('lms-youtube-iframe');
    const timerText = document.getElementById('study-timer-text');
    const timerBar = document.getElementById('study-timer-progress');
    const timerBadge = document.getElementById('study-timer-display');
    const countdownSpan = document.getElementById('next-btn-countdown');

    // 1. Penguncian Video HTML5 (MP4 / WebM / Supabase Video)
    if (videoEl) {
      let maxWatchedTime = 0;
      if (!forceTest) {
        const savedTime = parseFloat(AppState.unitVideoElapsed[currentUnit.id] || localStorage.getItem('lms_video_elapsed_' + currentUnit.id) || '0');
        maxWatchedTime = isNaN(savedTime) ? 0 : savedTime;
      }

      // Posisikan ke detik terakhir yang pernah ditonton setelah metadata video siap
      videoEl.addEventListener('loadedmetadata', () => {
        if (!forceTest && maxWatchedTime > 1 && videoEl.currentTime < maxWatchedTime) {
          try { videoEl.currentTime = maxWatchedTime; } catch (e) {}
        }
      });
      if (!forceTest && maxWatchedTime > 1 && videoEl.currentTime < maxWatchedTime) {
        try { videoEl.currentTime = maxWatchedTime; } catch (e) {}
      }

      videoEl.playbackRate = 1.0;

      videoEl.addEventListener('ratechange', () => {
        if (videoEl.playbackRate !== 1.0) {
          videoEl.playbackRate = 1.0;
          showToast('🔒 Kecepatan video dikunci pada 1.0x normal.', 'warning');
        }
      });

      // Pause otomatis saat pengguna membuka tab baru / meninggalkan LMS
      activeVisChangeHandler = () => {
        if ((document.hidden || !document.hasFocus()) && !videoEl.paused) {
          videoEl.pause();
          showToast('⏸️ Video otomatis dijeda karena Anda berpindah tab / meninggalkan LMS.', 'warning');
          if (timerBadge && !timerBadge.classList.contains('paused')) {
            timerBadge.classList.add('paused');
            if (timerText) timerText.textContent = '⏸️ Video Dijeda (Tab Tidak Aktif)';
          }
        }
      };
      document.addEventListener('visibilitychange', activeVisChangeHandler);
      window.addEventListener('blur', activeVisChangeHandler);

      videoEl.addEventListener('play', () => {
        if (timerBadge && timerBadge.classList.contains('paused')) {
          timerBadge.classList.remove('paused');
        }
      });

      // BLOKIR LOMPAT WAKTU / FORWARD VIA KEYBOARD (ArrowRight, ArrowUp, 'L', PageUp)
      const blockKeyboardSeek = (e) => {
        const forwardKeys = ['ArrowRight', 'ArrowUp', 'PageUp', 'KeyL', 'l', 'L'];
        if (forwardKeys.includes(e.key) || forwardKeys.includes(e.code)) {
          if (videoEl.currentTime >= maxWatchedTime - 0.2) {
            e.preventDefault();
            e.stopPropagation();
            videoEl.currentTime = maxWatchedTime;
            showToast('🔒 Navigasi keyboard dinonaktifkan: Anda tidak dapat melompati video yang belum ditonton.', 'warning');
          }
        }
      };
      videoEl.addEventListener('keydown', blockKeyboardSeek);

      // ANTI-SKIP SEGERA SAAT USER MENCOBA GESER SCRUBBER ATAU SEEK KEYBOARD
      videoEl.addEventListener('seeking', () => {
        if (videoEl.currentTime > maxWatchedTime + 0.3) {
          videoEl.currentTime = maxWatchedTime;
          showToast('🔒 Anti-Skip Aktif: Anda tidak dapat melompati video yang belum ditonton.', 'warning');
        }
      });

      videoEl.addEventListener('timeupdate', () => {
        // ANTI-SKIP: Jika melompati ke waktu yang belum pernah ditonton
        if (videoEl.currentTime > maxWatchedTime + 0.6) {
          videoEl.currentTime = maxWatchedTime;
          showToast('🔒 Anti-Skip Aktif: Anda tidak dapat melompati video yang belum ditonton.', 'warning');
        } else if (videoEl.currentTime > maxWatchedTime) {
          maxWatchedTime = videoEl.currentTime;
          AppState.unitVideoElapsed[currentUnit.id] = maxWatchedTime;
          localStorage.setItem('lms_video_elapsed_' + currentUnit.id, maxWatchedTime.toString());
        }

        if (videoEl.duration) {
          const curM = Math.floor(videoEl.currentTime / 60);
          const curS = Math.floor(videoEl.currentTime % 60);
          const durM = Math.floor(videoEl.duration / 60);
          const durS = Math.floor(videoEl.duration % 60);
          const pct = Math.min(100, Math.round((videoEl.currentTime / videoEl.duration) * 100));

          if (timerText && !timerBadge?.classList.contains('paused')) {
            timerText.textContent = `${curM}:${curS < 10 ? '0' : ''}${curS} / ${durM}:${durS < 10 ? '0' : ''}${durS} (${pct}%)`;
          }
          if (timerBar) timerBar.style.width = `${pct}%`;

          // Otomatis selesai jika mendekati akhir durasi
          if (videoEl.currentTime >= videoEl.duration - 0.5 && videoEl.duration > 2) {
            videoEl.dispatchEvent(new Event('ended'));
          }
        }
      });

      videoEl.addEventListener('ended', () => {
        clearActiveStudyTimer();
        showToast('🎉 Selamat! Anda telah menyelesaikan sesi video pembelajaran ini.', 'success');
        if (AppState.forceTestAntiSkip) {
          AppState.forceTestAntiSkip[currentUnit.id] = false;
        }
        markUnitComplete(currentUnit.id, course.id);
      });

      try {
        if (!videoEl.currentSrc) videoEl.load();
      } catch (e) {}

      return;
    }

    // 2. Penguncian Video YouTube (Iframe Player API & Smart Anti-Skip Watch Tracking)
    if (ytIframe) {
      const ytTarget = Math.max(15, targetSeconds);
      const savedYtTime = parseFloat(AppState.unitVideoElapsed[currentUnit.id] || localStorage.getItem('lms_video_elapsed_' + currentUnit.id) || '0');
      let maxYtWatched = isNaN(savedYtTime) ? 0 : savedYtTime;

      // Inisialisasi YouTube Iframe Player API dengan kontrol anti-skip
      const initYTPlayer = () => {
        if (!window.YT || !window.YT.Player) return false;
        try {
          activeYtPlayer = new YT.Player('lms-youtube-iframe', {
            events: {
              'onReady': (event) => {
                if (maxYtWatched > 1) {
                  try { event.target.seekTo(maxYtWatched, true); } catch (e) {}
                }
              },
              'onPlaybackRateChange': (event) => {
                if (event.data !== 1) {
                  try {
                    event.target.setPlaybackRate(1);
                    showToast('🔒 Kecepatan video dikunci pada 1.0x normal.', 'warning');
                  } catch (e) {}
                }
              },
              'onStateChange': (event) => {
                // YT.PlayerState.ENDED = 0
                if (event.data === 0) {
                  clearActiveStudyTimer();
                  showToast('🎉 Selamat! Anda telah menyaksikan video hingga tuntas.', 'success');
                  markUnitComplete(currentUnit.id, course.id);
                }
              }
            }
          });
          return true;
        } catch (e) {
          console.warn('YouTube Player API attach error:', e);
          return false;
        }
      };

      if (!initYTPlayer()) {
        const pollYT = setInterval(() => {
          if (initYTPlayer()) clearInterval(pollYT);
        }, 300);
        setTimeout(() => clearInterval(pollYT), 6000);
      }

      // Interval pelacak waktu tonton video aktif & Anti-Skip Enforcer
      activeStudyInterval = setInterval(() => {
        // Tab blur / ganti tab -> jeda video otomatis
        if (document.hidden) {
          if (activeYtPlayer && typeof activeYtPlayer.pauseVideo === 'function' && typeof activeYtPlayer.getPlayerState === 'function') {
            try {
              if (activeYtPlayer.getPlayerState() === 1) { // 1 = PLAYING
                activeYtPlayer.pauseVideo();
              }
            } catch (e) {}
          }
          if (timerBadge && !timerBadge.classList.contains('paused')) {
            timerBadge.classList.add('paused');
            if (timerText) timerText.textContent = '⏸️ Video Dijeda (Tab Tidak Aktif)';
          }
          return;
        }

        if (timerBadge && timerBadge.classList.contains('paused')) {
          timerBadge.classList.remove('paused');
        }

        // Cek progres tonton dari API YouTube
        if (activeYtPlayer && typeof activeYtPlayer.getCurrentTime === 'function' && typeof activeYtPlayer.getDuration === 'function') {
          try {
            const cur = activeYtPlayer.getCurrentTime() || 0;
            const dur = activeYtPlayer.getDuration() || ytTarget;

            // ANTI-SKIP PROTECTION: Jika mencoba memajukan slider YouTube melebihi waktu tonton
            if (cur > maxYtWatched + 2.0 && dur > 5) {
              activeYtPlayer.seekTo(maxYtWatched, true);
              showToast('🔒 Anda tidak dapat melompati bagian video yang belum ditonton.', 'warning');
            } else if (cur > maxYtWatched) {
              maxYtWatched = cur;
              AppState.unitVideoElapsed[currentUnit.id] = maxYtWatched;
              localStorage.setItem('lms_video_elapsed_' + currentUnit.id, maxYtWatched.toString());
            }

            // Kunci playbackRate 1.0x
            if (typeof activeYtPlayer.getPlaybackRate === 'function' && activeYtPlayer.getPlaybackRate() !== 1) {
              activeYtPlayer.setPlaybackRate(1);
            }

            if (dur > 0) {
              const curM = Math.floor(cur / 60);
              const curS = Math.floor(cur % 60);
              const durM = Math.floor(dur / 60);
              const durS = Math.floor(dur % 60);
              const pct = Math.min(100, Math.round((cur / dur) * 100));

              if (timerText && !timerBadge?.classList.contains('paused')) {
                timerText.textContent = `${curM}:${curS < 10 ? '0' : ''}${curS} / ${durM}:${durS < 10 ? '0' : ''}${durS} (${pct}%)`;
              }
              if (timerBar) timerBar.style.width = `${pct}%`;

              if (cur >= dur - 1.5 && dur > 5) {
                clearActiveStudyTimer();
                showToast('🎉 Video selesai ditonton! Sesi berikutnya telah terbuka.', 'success');
                markUnitComplete(currentUnit.id, course.id);
                return;
              }
            }
            return;
          } catch (e) {}
        }

        // Fallback jika YouTube API dicegah oleh sandbox/extension
        maxYtWatched++;
        AppState.unitVideoElapsed[currentUnit.id] = maxYtWatched;
        localStorage.setItem('lms_video_elapsed_' + currentUnit.id, maxYtWatched.toString());

        const pct = Math.min(100, Math.round((maxYtWatched / ytTarget) * 100));
        if (timerBar) timerBar.style.width = `${pct}%`;

        const rem = Math.max(0, ytTarget - maxYtWatched);
        const remM = Math.floor(rem / 60);
        const remS = Math.floor(rem % 60);
        if (timerText) {
          timerText.textContent = `Menonton (${remM}:${remS < 10 ? '0' : ''}${remS} tersisa)`;
        }

        if (maxYtWatched >= ytTarget) {
          clearActiveStudyTimer();
          showToast('🎉 Durasi tonton video terpenuhi! Sesi berikutnya telah terbuka.', 'success');
          markUnitComplete(currentUnit.id, course.id);
        }
      }, 500);

      return;
    }

    // 3. Timer Belajar Otomatis untuk Materi Teks / Modul Bacaan
    // Ambil waktu tonton/baca tersimpan (di memori atau LocalStorage) agar tidak pernah ter-reset
    let savedElapsed = AppState.unitStudyElapsed[currentUnit.id];
    if (savedElapsed === undefined || savedElapsed === null) {
      const stored = localStorage.getItem('lms_study_elapsed_' + currentUnit.id);
      savedElapsed = stored ? parseInt(stored, 10) : 0;
    }
    let elapsedSeconds = Math.min(savedElapsed || 0, targetSeconds);
    AppState.unitStudyElapsed[currentUnit.id] = elapsedSeconds;

    const updateTimerDisplay = () => {
      const remaining = Math.max(0, targetSeconds - elapsedSeconds);
      const remM = Math.floor(remaining / 60);
      const remS = remaining % 60;
      const remStr = `${remM}:${remS < 10 ? '0' : ''}${remS}`;
      const percent = Math.min(100, Math.round((elapsedSeconds / targetSeconds) * 100));

      if (timerText && !timerBadge?.classList.contains('paused')) {
        timerText.textContent = `${remStr} tersisa`;
      }
      if (timerBar) {
        timerBar.style.width = `${percent}%`;
      }
      if (countdownSpan) {
        countdownSpan.textContent = remStr;
      }
    };

    updateTimerDisplay();

    activeStudyInterval = setInterval(() => {
      // Wajib membaca di tab aktif — jeda otomatis jika tab ditinggalkan / diminimalkan
      if (document.hidden) {
        if (timerBadge && !timerBadge.classList.contains('paused')) {
          timerBadge.classList.add('paused');
          if (timerText) timerText.textContent = '⏸️ Terjeda (Tab Tidak Aktif)';
        }
        return;
      }

      if (timerBadge && timerBadge.classList.contains('paused')) {
        timerBadge.classList.remove('paused');
      }

      elapsedSeconds++;
      AppState.unitStudyElapsed[currentUnit.id] = elapsedSeconds;
      localStorage.setItem('lms_study_elapsed_' + currentUnit.id, elapsedSeconds.toString());
      updateTimerDisplay();

      // Durasi estimasi baca tuntas -> Buka kunci & Tandai Selesai!
      if (elapsedSeconds >= targetSeconds) {
        clearActiveStudyTimer();
        showToast('🎉 Waktu membaca materi telah terpenuhi! Sesi berikutnya telah terbuka.', 'success');
        markUnitComplete(currentUnit.id, course.id);
      }
    }, 1000);
  }

  window.resetVideoAntiSkipTest = function(unitId) {
    if (!AppState.forceTestAntiSkip) AppState.forceTestAntiSkip = {};
    AppState.forceTestAntiSkip[unitId] = true;
    AppState.unitVideoElapsed[unitId] = 0;
    try {
      localStorage.removeItem('lms_video_elapsed_' + unitId);
    } catch (e) {}

    const videoEl = document.getElementById('lms-custom-video');
    if (videoEl) {
      try {
        videoEl.pause();
        videoEl.currentTime = 0;
      } catch (e) {}
    }

    showToast('🔒 Penguncian anti-skip diuji ulang: Video di-reset ke 00:00 dan scrubber dikunci.', 'info');
    if (AppState.activeCoursePlayer) {
      renderCoursePlayer(document.getElementById('view-container'), AppState.activeCoursePlayer.id);
    }
  };

  window.toggleStudentSimulation = toggleStudentSimulation;

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
      // Masuk Mode Fullscreen
      document.body.classList.add('ifp-mode');
      const btn = document.getElementById('ifp-toggle-btn');
      if (btn) btn.innerHTML = '🗗 Keluar Fullscreen';

      // Request browser fullscreen jika diizinkan
      try {
        if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
        }
      } catch (err) {
        console.log('Fullscreen request was blocked or not allowed:', err);
      }

      showToast('🖥️ Mode Layar Penuh (Fullscreen) Aktif', 'success');
    } else {
      // Keluar dari Mode Fullscreen
      document.body.classList.remove('ifp-mode');
      const btn = document.getElementById('ifp-toggle-btn');
      if (btn) btn.innerHTML = '🖥️ Fullscreen';

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
      if (btn) btn.innerHTML = '🖥️ Fullscreen';
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

  // --- State Editor & Quiz Builder ---
  let currentEditorMode = 'visual'; // 'visual' | 'html' | 'preview'
  let currentQuizData = []; // [{ id, question, options: [], answerIndex, explanation }]

  // --- Add/Edit Content ---
  function openModalAddContent(courseId) {
    const modal = document.getElementById('global-modal');
    const modalBox = modal ? modal.querySelector('.modal-box') : null;
    if (modalBox) modalBox.classList.add('modal-lg');

    currentEditorMode = 'visual';
    currentQuizData = [];

    document.getElementById('modal-title').textContent = 'Tambah Unit Konten Pembelajaran';
    document.getElementById('modal-content').innerHTML = buildContentForm(courseId);
    document.getElementById('modal-action-btn').textContent = 'Tambahkan Unit';
    document.getElementById('modal-action-btn').onclick = () => document.getElementById('form-add-unit').requestSubmit();
    modal.classList.add('active');

    initEditorAfterMount(courseId, null);
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

    const modal = document.getElementById('global-modal');
    const modalBox = modal ? modal.querySelector('.modal-box') : null;
    if (modalBox) modalBox.classList.add('modal-lg');

    currentEditorMode = 'visual';
    currentQuizData = Array.isArray(unit.quizData) ? JSON.parse(JSON.stringify(unit.quizData)) : [];

    document.getElementById('modal-title').textContent = 'Edit Unit Konten';
    document.getElementById('modal-content').innerHTML = buildContentForm(courseId, unit, contentId);
    document.getElementById('modal-action-btn').textContent = 'Simpan Perubahan';
    document.getElementById('modal-action-btn').onclick = () => document.getElementById('form-add-unit').requestSubmit();
    modal.classList.add('active');

    initEditorAfterMount(courseId, unit);
  }

  function initEditorAfterMount(courseId, unit) {
    // Jalankan pengecekan jenis konten untuk menampilkan/menyembunyikan Quiz Builder
    const typeSelect = document.getElementById('unit-type');
    if (typeSelect) {
      toggleContentEditorFields(typeSelect.value);
    }
    renderQuizBuilderQuestions();

    // Pastikan area visual sinkron saat pertama load
    const visualEl = document.getElementById('unit-body-visual');
    const textareaEl = document.getElementById('unit-body');
    if (visualEl && textareaEl) {
      if (unit && unit.contentBody) {
        visualEl.innerHTML = unit.contentBody;
        textareaEl.value = unit.contentBody;
      }
      visualEl.addEventListener('input', () => {
        if (textareaEl) textareaEl.value = visualEl.innerHTML;
      });
    }
  }

  function toggleContentEditorFields(type) {
    const typeLower = (type || '').toLowerCase();
    const isQuiz = ['kuis_popup', 'pre_exam', 'post_exam', 'evaluasi', 'kuis'].includes(typeLower);
    const quizSection = document.getElementById('section-quiz-builder');
    if (quizSection) {
      quizSection.style.display = isQuiz ? 'block' : 'none';
      if (isQuiz && (!currentQuizData || currentQuizData.length === 0)) {
        // Berikan contoh soal starter awal jika kuis masih kosong
        currentQuizData = [
          {
            id: 1,
            question: '',
            options: ['', '', '', ''],
            answerIndex: 0,
            explanation: ''
          }
        ];
        renderQuizBuilderQuestions();
      }
    }
  }

  function switchEditorTab(targetMode) {
    const visualEl = document.getElementById('unit-body-visual');
    const htmlEl = document.getElementById('unit-body');
    const previewEl = document.getElementById('unit-body-preview');
    const toolbarEl = document.getElementById('visual-toolbar');
    const presetsEl = document.getElementById('editor-presets-container');

    if (!visualEl || !htmlEl || !previewEl) return;

    // Sinkronisasi data antar tab sebelum berpindah
    if (currentEditorMode === 'visual') {
      htmlEl.value = visualEl.innerHTML;
    } else if (currentEditorMode === 'html') {
      visualEl.innerHTML = htmlEl.value;
    }

    // Update active tab buttons
    ['visual', 'html', 'preview'].forEach(mode => {
      const btn = document.getElementById(`tab-btn-${mode}`);
      if (btn) btn.classList.toggle('active', mode === targetMode);
    });

    // Atur tampilan area editor
    if (targetMode === 'visual') {
      visualEl.style.display = 'block';
      htmlEl.style.display = 'none';
      previewEl.style.display = 'none';
      if (toolbarEl) toolbarEl.style.display = 'flex';
      if (presetsEl) presetsEl.style.display = 'flex';
    } else if (targetMode === 'html') {
      visualEl.style.display = 'none';
      htmlEl.style.display = 'block';
      previewEl.style.display = 'none';
      if (toolbarEl) toolbarEl.style.display = 'none';
      if (presetsEl) presetsEl.style.display = 'flex';
    } else if (targetMode === 'preview') {
      visualEl.style.display = 'none';
      htmlEl.style.display = 'none';
      previewEl.style.display = 'block';
      if (toolbarEl) toolbarEl.style.display = 'none';
      if (presetsEl) presetsEl.style.display = 'none';

      // Render isi ke pratinjau siswa
      const currentHtml = htmlEl.value || visualEl.innerHTML || '<p style="color:var(--tertiary);font-style:italic;">Belum ada isi materi.</p>';
      previewEl.innerHTML = currentHtml;
    }

    currentEditorMode = targetMode;
  }

  function execEditorCmd(command, value = null) {
    const visualEl = document.getElementById('unit-body-visual');
    if (!visualEl) return;
    visualEl.focus();
    document.execCommand(command, false, value);
    const textareaEl = document.getElementById('unit-body');
    if (textareaEl) textareaEl.value = visualEl.innerHTML;
  }

  function promptInsertLink() {
    const url = prompt('Masukkan URL tautan web (misal: https://example.com):');
    if (url && url.trim()) {
      execEditorCmd('createLink', url.trim());
    }
  }

  function promptInsertImage() {
    const url = prompt('Masukkan URL gambar langsung (misal: https://.../gambar.png):');
    if (url && url.trim()) {
      execEditorCmd('insertImage', url.trim());
    }
  }

  function setEditorDir(dir) {
    const visualEl = document.getElementById('unit-body-visual');
    if (!visualEl) return;
    visualEl.focus();

    const sel = window.getSelection();
    let targetBlock = null;

    if (sel && sel.rangeCount > 0) {
      let node = sel.anchorNode;
      while (node && node !== visualEl && node.nodeType !== Node.ELEMENT_NODE) {
        node = node.parentNode;
      }
      if (node && node !== visualEl) {
        targetBlock = node;
      }
    }

    if (!targetBlock) {
      document.execCommand('formatBlock', false, '<p>');
      const currentBlock = sel?.anchorNode?.nodeType === 1 ? sel.anchorNode : sel?.anchorNode?.parentElement;
      if (currentBlock && visualEl.contains(currentBlock) && currentBlock !== visualEl) {
        targetBlock = currentBlock;
      } else {
        targetBlock = visualEl;
      }
    }

    if (targetBlock) {
      targetBlock.setAttribute('dir', dir);
      targetBlock.style.textAlign = (dir === 'rtl') ? 'right' : 'left';
      if (dir === 'rtl') {
        targetBlock.style.fontFamily = 'var(--font-arabic)';
        targetBlock.style.fontSize = '1.35rem';
        targetBlock.style.lineHeight = '2.3';
      }
    }

    const textareaEl = document.getElementById('unit-body');
    if (textareaEl) textareaEl.value = visualEl.innerHTML;
    showToast(dir === 'rtl' ? '🇸🇦 Mode Teks Arab (RTL) aktif pada baris ini' : '🇮🇩 Mode Teks Latin (LTR) aktif pada baris ini', 'info');
  }
  window.setEditorDir = setEditorDir;

  function promptInsertArabic() {
    const visualEl = document.getElementById('unit-body-visual');
    if (!visualEl) return;
    visualEl.focus();

    const sel = window.getSelection();
    let defaultText = '';
    if (sel && !sel.isCollapsed) {
      defaultText = sel.toString();
    }
    const arabicText = prompt('Ketikkan / tempel kata atau kalimat Bahasa Arab:\n(Disisipkan dengan isolasi bidi agar tanda baca & kata Latin tidak saling bertabrakan)', defaultText || 'بِسْمِ اللَّهِ');
    if (!arabicText || !arabicText.trim()) return;

    const spanHtml = `&nbsp;<span class="arabic-inline" dir="rtl" lang="ar" style="font-family:var(--font-arabic);font-size:1.3em;line-height:2;padding:0 4px;unicode-bidi:isolate;color:#1e1b4b;">${escHtml(arabicText.trim())}</span>&nbsp;`;
    document.execCommand('insertHTML', false, spanHtml);

    const textareaEl = document.getElementById('unit-body');
    if (textareaEl) textareaEl.value = visualEl.innerHTML;
    showToast('✅ Teks Arab berhasil disisipkan dengan isolasi bidi!', 'success');
  }
  window.promptInsertArabic = promptInsertArabic;

  function insertCalloutTemplate(templateKey) {
    const visualEl = document.getElementById('unit-body-visual');
    const htmlEl = document.getElementById('unit-body');

    let templateHtml = '';
    switch (templateKey) {
      case 'info':
        templateHtml = `
<div class="lms-box-info">
  <strong>🎯 Tujuan Pembelajaran:</strong>
  <p>Setelah menyelesaikan unit ini, peserta didik mampu mengidentifikasi dan menerapkan konsep...</p>
</div>
<p><br></p>`;
        break;

      case 'tip':
        templateHtml = `
<div class="lms-box-tip">
  💡 <strong>Tips Belajar:</strong>
  <p>Gunakan catatan mandiri dan cermati contoh kasus berikut untuk mempermudah pemahaman.</p>
</div>
<p><br></p>`;
        break;

      case 'warning':
        templateHtml = `
<div class="lms-box-warning">
  ⚠️ <strong>Penting untuk Diperhatikan:</strong>
  <p>Pastikan seluruh langkah perhitungan dan validasi data telah sesuai dengan standar sebelum lanjut.</p>
</div>
<p><br></p>`;
        break;

      case 'arabic':
        templateHtml = `
<div class="lms-arabic-box" style="padding:1.25rem;background:#fdfcfe;border:1px solid #e9d5ff;border-radius:10px;margin:1.25rem 0;">
  <div class="arabic-text" dir="rtl" style="font-size:1.5rem;line-height:2.4;text-align:right;color:#1e1b4b;margin-bottom:0.75rem;font-family:var(--font-arabic);">
    بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
  </div>
  <p style="font-size:0.875rem;color:var(--tertiary);font-style:italic;margin:0;">
    Artinya: "Dengan menyebut nama Allah Yang Maha Pengasih lagi Maha Penyayang."
  </p>
</div>
<p><br></p>`;
        break;

      case 'arabic-vocab':
        templateHtml = `
<div style="background:#faf5ff;border:1px solid #d8b4fe;border-radius:10px;padding:1.25rem;margin:1.25rem 0;">
  <h4 style="margin:0 0 0.5rem;color:#6b21a8;font-size:1rem;">📖 Daftar Kosakata / Mufradat (المُفْرَدَات)</h4>
  <p style="font-size:0.8125rem;color:#7e22ce;margin-bottom:0.75rem;">Pelajari padanan kosakata Arab-Indonesia berikut secara mandiri:</p>
  <table class="arabic-vocab-table">
    <thead>
      <tr>
        <th style="width:35%;text-align:right;">المفردات (Arab)</th>
        <th style="width:30%;">Transliterasi</th>
        <th>Arti / Terjemahan</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="ar">كِتَابٌ</td>
        <td>Kitaabun</td>
        <td>Buku</td>
      </tr>
      <tr>
        <td class="ar">قَلَمٌ</td>
        <td>Qalamun</td>
        <td>Pena / Pulpen</td>
      </tr>
      <tr>
        <td class="ar">مَدْرَسَةٌ</td>
        <td>Madrasatun</td>
        <td>Sekolah</td>
      </tr>
      <tr>
        <td class="ar">أُسْتَاذٌ</td>
        <td>Ustaadzun</td>
        <td>Guru / Pendidik</td>
      </tr>
    </tbody>
  </table>
</div>
<p><br></p>`;
        break;

      case 'arabic-dialog':
        templateHtml = `
<div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:10px;padding:1.25rem;margin:1.25rem 0;">
  <h4 style="margin:0 0 0.75rem;color:#1e293b;font-size:1rem;">🗣️ Percakapan / Hiwar (الحِوَار)</h4>
  <div style="display:flex;flex-direction:column;gap:0.75rem;">
    <div style="background:#ffffff;border-left:3px solid #3b82f6;padding:0.75rem;border-radius:6px;">
      <div class="arabic-text" dir="rtl" style="font-size:1.35rem;line-height:2;color:#1e1b4b;text-align:right;">أَحْمَدُ: السَّلَامُ عَلَيْكُمْ وَرَحْمَةُ اللَّهِ وَبَرَكَاتُهُ</div>
      <div style="font-size:0.8125rem;color:#64748b;margin-top:0.25rem;">Ahmad: "Semoga keselamatan dan rahmat Allah serta berkah-Nya tercurah kepada kalian."</div>
    </div>
    <div style="background:#ffffff;border-left:3px solid #10b981;padding:0.75rem;border-radius:6px;">
      <div class="arabic-text" dir="rtl" style="font-size:1.35rem;line-height:2;color:#1e1b4b;text-align:right;">عُمَرُ: وَعَلَيْكُمُ السَّلَامُ وَرَحْمَةُ اللَّهِ وَبَرَكَاتُهُ</div>
      <div style="font-size:0.8125rem;color:#64748b;margin-top:0.25rem;">Umar: "Dan semoga keselamatan, rahmat Allah, dan berkah-Nya tercurah pula kepada kalian."</div>
    </div>
  </div>
</div>
<p><br></p>`;
        break;

      case 'table':
        templateHtml = `
<table class="lms-table">
  <thead>
    <tr>
      <th style="width:30%;">Indikator / Kategori</th>
      <th>Uraian &amp; Penerapan Pembelajaran</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>Poin Utama 1</strong></td>
      <td>Penjelasan konsep dan ilustrasi penerapan praktis...</td>
    </tr>
    <tr>
      <td><strong>Poin Utama 2</strong></td>
      <td>Penjelasan konsep kedua beserta studi kasus mandiri...</td>
    </tr>
  </tbody>
</table>
<p><br></p>`;
        break;

      case 'full-template':
        templateHtml = `
<h3>Pengenalan Konsep &amp; Modul Ajar</h3>
<div class="lms-box-info">
  <strong>🎯 Tujuan Pembelajaran:</strong>
  <p>1. Memahami konsep dasar dan kerangka teori pembelajaran.<br>2. Mampu menganalisis dan menyelesaikan latihan pemahaman dengan tepat.</p>
</div>

<h4>A. Pembahasan Materi Inti</h4>
<p>Tuliskan uraian materi modul secara terstruktur, jelas, dan sistematis di sini untuk dipelajari peserta didik.</p>

<div class="lms-box-tip">
  💡 <strong>Tips Belajar:</strong>
  <p>Fokuslah pada istilah kunci dan buatlah ringkasan mandiri setelah membaca uraian ini.</p>
</div>

<h4>B. Matriks Komparasi</h4>
<table class="lms-table">
  <thead>
    <tr>
      <th>Kategori</th>
      <th>Keterangan Lengkap</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Komponen A</td>
      <td>Uraian penjelasan detail komponen pertama...</td>
    </tr>
    <tr>
      <td>Komponen B</td>
      <td>Uraian penjelasan detail komponen kedua...</td>
    </tr>
  </tbody>
</table>

<div class="lms-box-warning">
  ⚠️ <strong>Penting untuk Diperhatikan:</strong>
  <p>Pastikan Anda telah menyimak seluruh bacaan dan video sebelum mengerjakan kuis pemahaman.</p>
</div>
<p><br></p>`;
        break;
    }

    if (!templateHtml) return;

    if (currentEditorMode === 'preview') {
      switchEditorTab('visual');
    }

    if (currentEditorMode === 'html' && htmlEl) {
      const start = htmlEl.selectionStart || htmlEl.value.length;
      const end = htmlEl.selectionEnd || htmlEl.value.length;
      htmlEl.value = htmlEl.value.substring(0, start) + templateHtml + htmlEl.value.substring(end);
      if (visualEl) visualEl.innerHTML = htmlEl.value;
    } else if (visualEl) {
      visualEl.focus();
      const success = document.execCommand('insertHTML', false, templateHtml);
      if (!success) {
        visualEl.innerHTML += templateHtml;
      }
      if (htmlEl) htmlEl.value = visualEl.innerHTML;
    }

    showToast('✨ Template kotak berhasil disisipkan!', 'success');
  }

  // --- Quiz Builder Functions ---
  function renderQuizBuilderQuestions() {
    const container = document.getElementById('quiz-questions-list');
    if (!container) return;

    if (!currentQuizData || currentQuizData.length === 0) {
      container.innerHTML = `
        <div style="text-align:center;padding:1.5rem;background:#ffffff;border:1px dashed var(--border);border-radius:8px;color:var(--tertiary);">
          <p style="margin:0 0 0.5rem;">Belum ada butir soal kuis pada unit ini.</p>
          <button type="button" class="btn btn-outline btn-sm" onclick="addNewQuizQuestion()">+ Tambah Soal Pertama</button>
        </div>
      `;
      return;
    }

    const alphabet = ['A', 'B', 'C', 'D', 'E', 'F'];
    container.innerHTML = currentQuizData.map((q, qIdx) => {
      const optionsHtml = (q.options || []).map((opt, optIdx) => {
        const isChecked = (q.answerIndex === optIdx);
        return `
          <div class="quiz-opt-row">
            <input type="radio" name="quiz-ans-${qIdx}" class="quiz-opt-radio" ${isChecked ? 'checked' : ''} onchange="setQuizCorrectAnswer(${qIdx}, ${optIdx})" title="Pilih sebagai Kunci Jawaban Benar">
            <span style="font-weight:700;color:${isChecked ? '#059669' : 'var(--tertiary)'};min-width:20px;">${alphabet[optIdx] || optIdx + 1}.</span>
            <input type="text" class="form-control" style="font-size:0.875rem;padding:0.35rem 0.65rem;flex:1;${isChecked ? 'border-color:#10b981;background:#ecfdf5;' : ''}" value="${escHtml(opt || '')}" oninput="updateQuizOptionText(${qIdx}, ${optIdx}, this.value)" placeholder="Tuliskan pilihan jawaban ${alphabet[optIdx] || optIdx + 1}..." required>
            ${(q.options.length > 2) ? `<button type="button" class="btn btn-ghost btn-sm" style="color:var(--error);padding:0.25rem 0.5rem;" onclick="removeOptionFromQuestion(${qIdx}, ${optIdx})" title="Hapus Pilihan">✕</button>` : ''}
          </div>
        `;
      }).join('');

      return `
        <div class="quiz-q-card">
          <div class="quiz-q-header">
            <div style="display:flex;align-items:center;gap:0.5rem;">
              <span class="badge" style="background:#e0e7ff;color:#3730a3;font-weight:700;">Soal #${qIdx + 1}</span>
              <span style="font-size:0.75rem;color:var(--tertiary);">Pilihan dengan radio aktif (hijau) adalah kunci jawaban.</span>
            </div>
            <button type="button" class="btn btn-ghost btn-sm" style="color:var(--error);" onclick="deleteQuizQuestion(${qIdx})" title="Hapus Butir Soal Ini">
              🗑️ Hapus Soal
            </button>
          </div>

          <div class="form-group" style="margin-bottom:0.75rem;">
            <textarea class="form-control" rows="2" style="font-size:0.9rem;" placeholder="Tuliskan teks pertanyaan soal di sini..." oninput="updateQuizQuestionText(${qIdx}, this.value)" required>${escHtml(q.question || '')}</textarea>
          </div>

          <div style="margin-bottom:0.75rem;">
            <label style="font-size:0.78rem;font-weight:600;color:var(--tertiary);margin-bottom:0.35rem;display:block;">Opsi Pilihan Jawaban:</label>
            ${optionsHtml}
            ${(q.options.length < 6) ? `
              <button type="button" class="btn btn-ghost btn-sm" style="font-size:0.75rem;color:var(--primary);margin-top:0.25rem;" onclick="addOptionToQuestion(${qIdx})">
                + Tambah Opsi (${alphabet[q.options.length] || 'Opsi'})
              </button>
            ` : ''}
          </div>

          <div class="form-group" style="margin-bottom:0;">
            <label style="font-size:0.78rem;font-weight:600;color:var(--tertiary);display:block;margin-bottom:0.25rem;">Pembahasan / Penjelasan Jawaban (Muncul saat review):</label>
            <textarea class="form-control" rows="1" style="font-size:0.8125rem;background:#f8fafc;" placeholder="Contoh: Jawaban ini benar karena sesuai dengan prinsip keseimbangan debit-kredit..." oninput="updateQuizExplanation(${qIdx}, this.value)">${escHtml(q.explanation || '')}</textarea>
          </div>
        </div>
      `;
    }).join('');
  }

  function addNewQuizQuestion() {
    if (!currentQuizData) currentQuizData = [];
    currentQuizData.push({
      id: currentQuizData.length + 1,
      question: '',
      options: ['', '', '', ''],
      answerIndex: 0,
      explanation: ''
    });
    renderQuizBuilderQuestions();
    showToast('➕ Soal baru ditambahkan', 'info');
  }

  function deleteQuizQuestion(idx) {
    if (confirm(`Hapus Butir Soal #${idx + 1}?`)) {
      currentQuizData.splice(idx, 1);
      renderQuizBuilderQuestions();
    }
  }

  function updateQuizQuestionText(idx, val) {
    if (currentQuizData[idx]) currentQuizData[idx].question = val;
  }

  function updateQuizOptionText(idx, optIdx, val) {
    if (currentQuizData[idx] && currentQuizData[idx].options) {
      currentQuizData[idx].options[optIdx] = val;
    }
  }

  function setQuizCorrectAnswer(idx, optIdx) {
    if (currentQuizData[idx]) {
      currentQuizData[idx].answerIndex = optIdx;
      renderQuizBuilderQuestions();
    }
  }

  function updateQuizExplanation(idx, val) {
    if (currentQuizData[idx]) currentQuizData[idx].explanation = val;
  }

  function addOptionToQuestion(idx) {
    if (currentQuizData[idx]) {
      currentQuizData[idx].options.push('');
      renderQuizBuilderQuestions();
    }
  }

  function removeOptionFromQuestion(idx, optIdx) {
    if (currentQuizData[idx] && currentQuizData[idx].options.length > 2) {
      currentQuizData[idx].options.splice(optIdx, 1);
      if (currentQuizData[idx].answerIndex >= currentQuizData[idx].options.length) {
        currentQuizData[idx].answerIndex = 0;
      }
      renderQuizBuilderQuestions();
    }
  }

  function toggleQuickImportBox() {
    const el = document.getElementById('quiz-quick-import-drawer');
    if (el) {
      el.style.display = el.style.display === 'none' ? 'block' : 'none';
    }
  }

  function processQuickImportQuestions() {
    const textarea = document.getElementById('quiz-quick-import-text');
    if (!textarea || !textarea.value.trim()) {
      showToast('⚠️ Silakan tempel teks soal terlebih dahulu.', 'warning');
      return;
    }

    const lines = textarea.value.split('\n').map(l => l.trim()).filter(Boolean);
    const parsedQuestions = [];
    let currentQ = null;

    lines.forEach(line => {
      // Cek apakah baris memulai soal baru (misal: "1. Apa..." atau "2) Pertanyaan...")
      const qMatch = line.match(/^(\d+)[\.\)]\s*(.*)/);
      if (qMatch) {
        if (currentQ && currentQ.question && currentQ.options.length >= 2) {
          parsedQuestions.push(currentQ);
        }
        currentQ = {
          id: parsedQuestions.length + 1,
          question: qMatch[2] || '',
          options: [],
          answerIndex: 0,
          explanation: ''
        };
        return;
      }

      // Cek opsi jawaban: "*A. Pilihan" atau "A. Pilihan" atau "*a) Pilihan"
      const optMatch = line.match(/^(\*?)\s*([A-Fa-f])[\.\)]\s*(.*)/);
      if (optMatch && currentQ) {
        const isCorrect = optMatch[1] === '*';
        const optText = optMatch[3] || '';
        if (isCorrect) {
          currentQ.answerIndex = currentQ.options.length;
        }
        currentQ.options.push(optText);
        return;
      }

      // Cek penjelasan: "Penjelasan:" atau "Pembahasan:"
      const expMatch = line.match(/^(Penjelasan|Pembahasan|Catatan):\s*(.*)/i);
      if (expMatch && currentQ) {
        currentQ.explanation = expMatch[2] || '';
        return;
      }

      // Kalimat lanjutan dari pertanyaan jika belum ada opsi
      if (currentQ && currentQ.options.length === 0) {
        currentQ.question += ' ' + line;
      }
    });

    if (currentQ && currentQ.question && currentQ.options.length >= 2) {
      parsedQuestions.push(currentQ);
    }

    if (parsedQuestions.length === 0) {
      showToast('⚠️ Format teks tidak dikenali. Gunakan format: 1. Soal lalu A. Opsi (* untuk kunci).', 'warning');
      return;
    }

    // Gabungkan soal yang berhasil diimpor
    if (!currentQuizData) currentQuizData = [];
    // Bersihkan jika hanya ada soal starter kosong
    if (currentQuizData.length === 1 && !currentQuizData[0].question.trim()) {
      currentQuizData = [];
    }
    currentQuizData.push(...parsedQuestions);
    renderQuizBuilderQuestions();
    textarea.value = '';
    toggleQuickImportBox();
    showToast(`✅ Berhasil mengimpor ${parsedQuestions.length} butir soal!`, 'success');
  }

  function buildContentForm(courseId, unit = {}, editId = null) {
    const course = AppState.courses.find(c => c.id === courseId) || AppState.courses[0];
    
    // Kumpulan opsi durasi lengkap
    const defaultDurations = [
      '2 Menit', '3 Menit', '4 Menit', '5 Menit', '6 Menit', '7 Menit', '8 Menit',
      '10 Menit', '12 Menit', '15 Menit', '20 Menit', '25 Menit', '30 Menit', 
      '40 Menit', '45 Menit', '50 Menit', '60 Menit', '90 Menit'
    ];
    
    const currentDuration = (unit.duration || '10 Menit').trim();
    if (currentDuration && !defaultDurations.some(d => d.toLowerCase() === currentDuration.toLowerCase())) {
      defaultDurations.unshift(currentDuration);
    }

    const durationOptionsHtml = defaultDurations.map(d => {
      const isSelected = d.toLowerCase() === currentDuration.toLowerCase();
      return `<option value="${d}" ${isSelected ? 'selected' : ''}>${d}</option>`;
    }).join('');

    // Jenis konten lengkap
    const typeList = [
      { val: 'materi', label: '📖 Materi (Teks / Modul Bacaan)' },
      { val: 'video', label: '🎥 Video Pembelajaran (MP4 / YouTube)' },
      { val: 'tugas_drive', label: '📁 Tugas Link Google Drive (Gatekeeper Kelulusan Tema)' },
      { val: 'tugas_zoom', label: '📹 Sesi Mentoring Zoom (Gatekeeper Temu Tatap Muka)' },
      { val: 'kuis_popup', label: '📋 Kuis Pop-Up / Latihan Pemahaman' },
      { val: 'pre_exam', label: '📑 Pre-Exam (Ujian Awal Pra-Pembelajaran)' },
      { val: 'post_exam', label: '📑 Post-Exam (Ujian Akhir Kelulusan)' },
      { val: 'tugas', label: '✏️ Praktik / Unjuk Keterampilan' },
      { val: 'refleksi', label: '📓 Reflective Journal' },
      { val: 'evaluasi', label: '📋 Evaluasi Pembelajaran' }
    ];
    const currentType = (unit.type || 'materi').toLowerCase();
    const typeOptionsHtml = typeList.map(t => {
      const isSelected = currentType === t.val || currentType === t.val.replace('_', ' ');
      return `<option value="${t.val}" ${isSelected ? 'selected' : ''}>${t.label}</option>`;
    }).join('');

    const totalContents = (course?.contents || []).length;
    const currentIdx = editId ? (course?.contents || []).findIndex(u => u.id === editId) : -1;
    let orderOptionsHtml = '';
    if (editId && currentIdx !== -1) {
      orderOptionsHtml = (course?.contents || []).map((c, i) => 
        `<option value="${i + 1}" ${i === currentIdx ? 'selected' : ''}>Urutan #${i + 1} ${i === currentIdx ? '(Posisi saat ini)' : '— ' + escHtml(c.title).substring(0, 30)}</option>`
      ).join('');
    } else {
      orderOptionsHtml = `<option value="${totalContents + 1}" selected>Di Urutan Terakhir (Posisi #${totalContents + 1})</option>`;
      orderOptionsHtml += `<option value="1">Di Awal Materi (Posisi #1)</option>`;
      for (let i = 0; i < totalContents; i++) {
        orderOptionsHtml += `<option value="${i + 2}">Setelah Unit #${i + 1} (${escHtml(course.contents[i].title).substring(0, 25)}...)</option>`;
      }
    }

    const existingSections = [...new Set((course?.contents || []).map(c => c.sectionName).filter(Boolean))];
    const datalistHtml = existingSections.map(s => `<option value="${escHtml(s)}"></option>`).join('');

    const initialContentBody = (unit.contentBody || '').replace(/<!--TYPE:tugas_[a-z]+-->\n?/gi, '');

    return `
      <form id="form-add-unit" onsubmit="handleSaveContent(event,'${courseId}','${editId || ''}')">
        <!-- 1. Metadata Pokok Unit -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem;">
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">Judul Unit <span style="color:var(--error);">*</span></label>
            <input type="text" id="unit-title" class="form-control" value="${escHtml(unit.title || '')}" placeholder="Contoh: Pengenalan Siklus Akuntansi" required dir="auto">
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">Bab / Lingkup Materi (Accordion Pembungkus)</label>
            <input type="text" id="unit-section" list="section-suggestions" class="form-control" value="${escHtml(unit.sectionName || '')}" placeholder="Contoh: Akuntansi Dasar (Kosongkan jika Pre-Exam / Standalone)" dir="auto">
            <datalist id="section-suggestions">
              ${datalistHtml}
            </datalist>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem;margin-bottom:1rem;">
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">Jenis Konten</label>
            <select id="unit-type" class="form-control" onchange="toggleContentEditorFields(this.value)">
              ${typeOptionsHtml}
            </select>
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">Estimasi Durasi Belajar</label>
            <select id="unit-duration" class="form-control">
              ${durationOptionsHtml}
            </select>
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">Urutan / Posisi Materi</label>
            <select id="unit-order-position" class="form-control" title="Tentukan langsung nomor urutan materi ini dalam kursus">
              ${orderOptionsHtml}
            </select>
          </div>
        </div>

        <div class="form-group" id="group-unit-url">
          <label class="form-label">URL Video Langsung / Supabase Storage / YouTube</label>
          <input type="url" id="unit-url" class="form-control" value="${unit.embedUrl || ''}" placeholder="https://...supabase.co/storage/.../video.mp4 atau https://youtube.com/...">
          <small style="color:var(--tertiary);display:block;margin-top:0.25rem;">
            💡 <strong>Rekomendasi:</strong> Gunakan URL file MP4 langsung (Supabase Storage) untuk proteksi anti-skip &amp; pemutaran lancar.
          </small>
        </div>

        <!-- 2. Interactive Quiz & Exam Builder (Muncul otomatis saat jenis konten adalah Kuis/Exam) -->
        <div id="section-quiz-builder" class="quiz-builder-section" style="display:none;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.85rem;flex-wrap:wrap;gap:0.5rem;">
            <div>
              <h4 style="margin:0;font-size:1rem;color:var(--primary);display:flex;align-items:center;gap:0.35rem;">
                <span>🎯</span> Penyusun Kuis Interaktif &amp; Soal Ujian
              </h4>
              <p style="margin:0.2rem 0 0;font-size:0.75rem;color:var(--tertiary);">
                Susun butir pertanyaan, tentukan kunci jawaban benar (lingkaran radio hijau), dan atur ambang kelulusan.
              </p>
            </div>
            <div style="display:flex;align-items:center;gap:0.65rem;">
              <div style="display:flex;align-items:center;gap:0.35rem;font-size:0.8125rem;">
                <label for="quiz-passing-score" style="font-weight:600;">Passing Score:</label>
                <input type="number" id="quiz-passing-score" class="form-control" min="10" max="100" style="width:70px;padding:0.25rem 0.5rem;height:32px;" value="${unit.passingScore || 70}">
                <span>%</span>
              </div>
              <button type="button" class="btn btn-outline btn-sm" onclick="toggleQuickImportBox()">
                📋 Impor dari Teks
              </button>
              <button type="button" class="btn btn-secondary btn-sm" onclick="addNewQuizQuestion()">
                + Tambah Soal
              </button>
            </div>
          </div>

          <!-- Quick Import Drawer -->
          <div id="quiz-quick-import-drawer" style="display:none;background:#ffffff;border:1px dashed #3b82f6;border-radius:8px;padding:1rem;margin-bottom:1rem;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
              <strong style="font-size:0.875rem;color:#1d4ed8;">📋 Format Impor Soal Cepat dari Teks / Dokumen Word</strong>
              <button type="button" class="btn btn-ghost btn-sm" onclick="toggleQuickImportBox()">✕ Tutup</button>
            </div>
            <p style="font-size:0.75rem;color:var(--tertiary);margin-bottom:0.5rem;">
              Tempel teks soal dengan format nomor dan opsi A/B/C/D. Beri tanda bintang (<strong>*</strong>) di depan pilihan yang merupakan kunci jawaban.
            </p>
            <textarea id="quiz-quick-import-text" class="form-control" rows="5" style="font-family:var(--font-mono);font-size:0.8125rem;" placeholder="1. Apa fungsi utama neraca saldo dalam akuntansi?
*A. Memastikan keseimbangan total nilai debit dan kredit
B. Menghitung besaran pajak penghasilan tahunan
C. Membayar gaji karyawan operasional
D. Mengganti bukti transaksi fisik yang hilang
Penjelasan: Neraca saldo menguji kesamaan matematis antara total debit dan total kredit."></textarea>
            <div style="display:flex;justify-content:flex-end;gap:0.5rem;margin-top:0.5rem;">
              <button type="button" class="btn btn-primary btn-sm" onclick="processQuickImportQuestions()">
                🚀 Terapkan ke Daftar Soal
              </button>
            </div>
          </div>

          <!-- Daftar Kartu Soal -->
          <div id="quiz-questions-list"></div>
        </div>

        <!-- 3. WYSIWYG Visual Editor & Callout Box Authoring -->
        <div class="form-group" style="margin-bottom:0.5rem;">
          <div class="editor-tabs-bar">
            <div style="display:flex;align-items:center;gap:0.4rem;">
              <button type="button" class="editor-tab-pill active" id="tab-btn-visual" onclick="switchEditorTab('visual')">
                ✍️ Editor Visual (WYSIWYG)
              </button>
              <button type="button" class="editor-tab-pill" id="tab-btn-html" onclick="switchEditorTab('html')">
                💻 Mode Kode HTML
              </button>
              <button type="button" class="editor-tab-pill" id="tab-btn-preview" onclick="switchEditorTab('preview')">
                👁️ Pratinjau Tampilan Siswa
              </button>
            </div>
            <div style="font-size:0.75rem;color:var(--tertiary);">
              💡 Format teks kaya &amp; dukungan multibahasa (Arab + Latin seperti Ms Word)
            </div>
          </div>

          <!-- 1-Click Callout Templates Bar -->
          <div class="editor-presets-bar" id="editor-presets-container">
            <span style="font-size:0.75rem;font-weight:600;color:var(--tertiary);margin-right:0.25rem;">Sisip Cepat:</span>
            <button type="button" class="preset-chip chip-info" onclick="insertCalloutTemplate('info')" title="Kotak Tujuan Pembelajaran (Hijau/Toska)">
              🎯 + Tujuan Bab
            </button>
            <button type="button" class="preset-chip chip-tip" onclick="insertCalloutTemplate('tip')" title="Kotak Tips Belajar (Biru)">
              💡 + Tips Belajar
            </button>
            <button type="button" class="preset-chip chip-warning" onclick="insertCalloutTemplate('warning')" title="Kotak Peringatan / Hal Kritis (Kuning)">
              ⚠️ + Peringatan
            </button>
            <button type="button" class="preset-chip chip-arabic" onclick="insertCalloutTemplate('arabic')" title="Kotak Teks Arab / Hadits &amp; Terjemahan">
              🕌 + Hadits / Teks Arab
            </button>
            <button type="button" class="preset-chip chip-arabic" onclick="insertCalloutTemplate('arabic-vocab')" title="Tabel Mufradat / Kosakata Bahasa Arab Lengkap">
              📖 + Mufradat Arab
            </button>
            <button type="button" class="preset-chip chip-arabic" onclick="insertCalloutTemplate('arabic-dialog')" title="Percakapan / Hiwar Arab-Indonesia">
              🗣️ + Hiwar Arab
            </button>
            <button type="button" class="preset-chip chip-table" onclick="insertCalloutTemplate('table')" title="Tabel Terformat Rapi">
              📊 + Tabel 2x2
            </button>
            <button type="button" class="preset-chip chip-template" onclick="insertCalloutTemplate('full-template')" title="Kerangka Lengkap Modul Siap Pakai">
              🧩 + Format Modul Lengkap
            </button>
          </div>

          <!-- Visual Formatting Toolbar (Word-Style Ribbon) -->
          <div class="editor-toolbar" id="visual-toolbar">
            <div class="editor-btn-group">
              <button type="button" class="editor-btn" onclick="execEditorCmd('formatBlock', '<h3>')" title="Judul Bab (H3)">H3</button>
              <button type="button" class="editor-btn" onclick="execEditorCmd('formatBlock', '<h4>')" title="Sub-Judul (H4)">H4</button>
              <button type="button" class="editor-btn" onclick="execEditorCmd('formatBlock', '<p>')" title="Paragraf Normal">¶</button>
            </div>

            <div class="editor-btn-group">
              <button type="button" class="editor-btn" onclick="execEditorCmd('bold')" title="Tebal (Ctrl+B)"><strong>B</strong></button>
              <button type="button" class="editor-btn" onclick="execEditorCmd('italic')" title="Miring (Ctrl+I)"><em>I</em></button>
              <button type="button" class="editor-btn" onclick="execEditorCmd('underline')" title="Garis Bawah (Ctrl+U)"><u>U</u></button>
              <button type="button" class="editor-btn" onclick="execEditorCmd('strikeThrough')" title="Coret"><s>S</s></button>
            </div>

            <div class="editor-btn-group">
              <button type="button" class="editor-btn" onclick="execEditorCmd('insertUnorderedList')" title="Daftar Titik (Bullet List)">• List</button>
              <button type="button" class="editor-btn" onclick="execEditorCmd('insertOrderedList')" title="Daftar Nomor (Numbered List)">1. List</button>
            </div>

            <div class="editor-btn-group">
              <button type="button" class="editor-btn" onclick="execEditorCmd('justifyLeft')" title="Rata Kiri">⬅️</button>
              <button type="button" class="editor-btn" onclick="execEditorCmd('justifyCenter')" title="Rata Tengah">↔️</button>
              <button type="button" class="editor-btn" onclick="execEditorCmd('justifyRight')" title="Rata Kanan">➡️</button>
              <button type="button" class="editor-btn" onclick="execEditorCmd('justifyFull')" title="Rata Kiri-Kanan (Justify)">↔️ Justify</button>
            </div>

            <!-- Kontrol Arah Teks & Teks Arab Standar Ms Word -->
            <div class="editor-btn-group">
              <button type="button" class="editor-btn" onclick="setEditorDir('rtl')" title="Arah Teks Kanan ke Kiri (Arab / RTL)">🇸🇦 Arab (RTL)</button>
              <button type="button" class="editor-btn" onclick="setEditorDir('ltr')" title="Arah Teks Kiri ke Kanan (Latin / LTR)">🇮🇩 Latin (LTR)</button>
              <button type="button" class="editor-btn" onclick="promptInsertArabic()" title="Sisipkan Kata Arab di Antara Teks Latin (Bidi Isolated)">🕌 Sisip Arab</button>
            </div>

            <div class="editor-btn-group">
              <button type="button" class="editor-btn" onclick="promptInsertLink()" title="Sisipkan Link Web">🔗 Link</button>
              <button type="button" class="editor-btn" onclick="promptInsertImage()" title="Sisipkan Gambar (URL)">🖼️ Gambar</button>
              <button type="button" class="editor-btn" onclick="execEditorCmd('insertHorizontalRule')" title="Garis Pembatas">― Garis</button>
              <button type="button" class="editor-btn" onclick="execEditorCmd('removeFormat')" title="Bersihkan Format" style="color:var(--error);">✕ Bersihkan</button>
            </div>
          </div>

          <!-- Content Editable (Visual Area) -->
          <div id="unit-body-visual" class="editor-content-area" contenteditable="true" spellcheck="false" dir="auto">
            ${initialContentBody || '<p>Ketikkan isi teks materi atau klik tombol template di atas...</p>'}
          </div>

          <!-- Raw HTML Area (Hidden by default) -->
          <textarea id="unit-body" class="form-control" rows="12" style="display:none;font-family:var(--font-mono);font-size:0.875rem;line-height:1.6;background:#fcfcfd;" dir="auto">${escHtml(initialContentBody)}</textarea>

          <!-- Live Student Preview Area (Hidden by default) -->
          <div id="unit-body-preview" class="player-content-body" style="display:none;background:#ffffff;padding:1.5rem;border:1px solid var(--border);border-radius:0 0 8px 8px;max-height:420px;overflow-y:auto;">
          </div>
        </div>
      </form>
    `;
  }

  async function handleSaveContent(e, courseId, editId) {
    e.preventDefault();
    const title = document.getElementById('unit-title').value.trim();
    const type = document.getElementById('unit-type').value;
    const duration = document.getElementById('unit-duration').value;
    const sectionName = document.getElementById('unit-section') ? document.getElementById('unit-section').value.trim() : '';
    const embedUrl = document.getElementById('unit-url') ? document.getElementById('unit-url').value.trim() : '';

    const orderPosEl = document.getElementById('unit-order-position');
    const chosenPos = orderPosEl ? parseInt(orderPosEl.value, 10) : null;

    // Ambil isi materi teks dari tab yang sedang aktif
    const visualEl = document.getElementById('unit-body-visual');
    const htmlEl = document.getElementById('unit-body');
    let contentBody = '';

    if (currentEditorMode === 'html' && htmlEl) {
      contentBody = htmlEl.value;
    } else if (visualEl) {
      contentBody = visualEl.innerHTML;
    } else if (htmlEl) {
      contentBody = htmlEl.value;
    }

    // Bersihkan placeholder bawaan jika belum diubah sama sekali
    if (contentBody.trim() === '<p>Ketikkan isi teks materi atau klik tombol template di atas...</p>') {
      contentBody = '';
    }

    // Ambil data kuis jika jenis konten merupakan kuis/ujian
    const isQuiz = ['kuis_popup', 'pre_exam', 'post_exam', 'evaluasi', 'kuis'].includes(type.toLowerCase());
    let quizData = null;
    let passingScore = 70;

    const passingScoreEl = document.getElementById('quiz-passing-score');
    if (passingScoreEl) {
      passingScore = parseInt(passingScoreEl.value, 10) || 70;
    }

    if (isQuiz && currentQuizData && currentQuizData.length > 0) {
      // Filter hanya soal yang memiliki pertanyaan terisi
      const validQuestions = currentQuizData.filter(q => q.question && q.question.trim().length > 0);
      if (validQuestions.length > 0) {
        quizData = validQuestions.map((q, idx) => ({
          id: idx + 1,
          question: q.question.trim(),
          options: (q.options || []).map(opt => (opt || '').trim()),
          answerIndex: typeof q.answerIndex === 'number' ? q.answerIndex : 0,
          explanation: (q.explanation || '').trim()
        }));
      }
    }

    const course = AppState.courses.find(c => c.id === courseId) || AppState.courses[0];
    setModalLoading(true, 'Menyimpan...');

    try {
      const sb = getSupabase();
      let targetUnitObj = null;

      if (sb && !AppState.isDemoMode) {
        if (editId && editId !== 'null' && editId !== '') {
          // Edit existing unit di Supabase
          await dbEditContent(editId, { title, type, duration, embedUrl, contentBody, sectionName, quizData, passingScore });
          const unit = course.contents.find(u => u.id === editId);
          if (unit) {
            unit.title = title;
            unit.type = type;
            unit.duration = duration;
            unit.sectionName = sectionName;
            unit.embedUrl = embedUrl;
            unit.contentBody = contentBody;
            unit.quizData = quizData;
            unit.passingScore = passingScore;
            targetUnitObj = unit;
          }
          showToast('✅ Unit berhasil diperbarui di database!', 'success');
        } else {
          // Add new unit ke Supabase
          const orderIndex = course.contents.length + 1;
          const data = await dbAddContent({ courseId, title, type, duration, embedUrl, contentBody, sectionName, orderIndex, quizData, passingScore });
          targetUnitObj = {
            id: data.id,
            title,
            type,
            duration,
            sectionName,
            embedUrl,
            contentBody,
            quizData,
            passingScore,
            completed: false
          };
          course.contents.push(targetUnitObj);
          showToast('✅ Unit baru tersimpan ke Supabase!', 'success');
        }
      } else {
        // Demo mode (LocalStorage / In-memory)
        if (editId && editId !== '') {
          const unit = course.contents.find(u => u.id === editId);
          if (unit) {
            unit.title = title;
            unit.type = type;
            unit.duration = duration;
            unit.sectionName = sectionName;
            unit.embedUrl = embedUrl;
            unit.contentBody = contentBody;
            unit.quizData = quizData;
            unit.passingScore = passingScore;
            targetUnitObj = unit;
          }
        } else {
          targetUnitObj = {
            id: 'DEMO-' + Date.now(),
            title,
            type,
            duration,
            sectionName,
            embedUrl,
            contentBody,
            quizData,
            passingScore,
            completed: false
          };
          course.contents.push(targetUnitObj);
        }
        showToast('✅ Unit disimpan (mode demo).', 'success');
      }

      // Atur urutan jika posisi target dipilih berbeda
      if (chosenPos && !isNaN(chosenPos) && targetUnitObj) {
        const curIdx = course.contents.findIndex(u => u.id === targetUnitObj.id);
        const targetIdx = Math.max(0, Math.min(course.contents.length - 1, chosenPos - 1));
        if (curIdx !== -1 && curIdx !== targetIdx) {
          const item = course.contents.splice(curIdx, 1)[0];
          course.contents.splice(targetIdx, 0, item);
        }
      }

      await persistContentsOrder(course);

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
        // 1. Buatkan akun login di Supabase Auth tanpa mengganti sesi admin aktif
        let authUserId = null;
        let authSuccess = false;
        try {
          const authClient = typeof getSupabaseAuthAdmin === 'function' ? getSupabaseAuthAdmin() : sb;
          const { data: authData, error: authErr } = await authClient.auth.signUp({
            email,
            password: password || '123456',
            options: {
              data: { name, role: 'student', class_name: cls }
            }
          });
          if (!authErr && authData?.user?.id) {
            authUserId = authData.user.id;
            authSuccess = true;
          } else if (authErr) {
            console.warn('Supabase Auth signUp student info:', authErr.message);
          }
        } catch (authEx) {
          console.warn('Supabase Auth signUp student exception:', authEx);
        }

        // 2. Simpan profil langsung ke public.profiles
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

        // Daftarkan ke course jika dipilih
        if (courseId) {
          await dbEnrollStudent(courseId, newStudentId);
        }
        showToast(`✅ Data siswa "${name}" (${email}) berhasil didaftarkan! Akun siap login.`, 'success');
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

  function openModalEditStudent(id, name, email, className, status = 'Aktif') {
    document.getElementById('modal-title').textContent = 'Edit Data Peserta Didik';
    document.getElementById('modal-content').innerHTML = `
      <form id="form-edit-std" onsubmit="handleEditStudent(event,'${id}')">
        <div class="form-group">
          <label class="form-label">Nama Lengkap Peserta Didik</label>
          <input type="text" id="std-edit-name" class="form-control" value="${escHtml(name)}" required>
        </div>
        <div class="form-group">
          <label class="form-label">Email Peserta Didik</label>
          <input type="email" id="std-edit-email" class="form-control" value="${escHtml(email)}" required>
        </div>
        <div class="form-group">
          <label class="form-label">Rombel / Kelas</label>
          <input type="text" id="std-edit-class" class="form-control" value="${escHtml(className)}" required>
        </div>
        <div class="form-group">
          <label class="form-label">Status Keaktifan</label>
          <select id="std-edit-status" class="form-control">
            <option value="Aktif" ${status === 'Aktif' ? 'selected' : ''}>Aktif</option>
            <option value="Nonaktif" ${status === 'Nonaktif' ? 'selected' : ''}>Nonaktif</option>
          </select>
        </div>
      </form>
    `;
    document.getElementById('modal-action-btn').textContent = 'Simpan Perubahan';
    document.getElementById('modal-action-btn').onclick = () => document.getElementById('form-edit-std').requestSubmit();
    document.getElementById('global-modal').classList.add('active');
  }
  window.openModalEditStudent = openModalEditStudent;

  async function handleEditStudent(e, id) {
    e.preventDefault();
    const name = document.getElementById('std-edit-name').value.trim();
    const email = document.getElementById('std-edit-email').value.trim();
    const cls = document.getElementById('std-edit-class').value.trim();
    const status = document.getElementById('std-edit-status').value;

    setModalLoading(true, 'Menyimpan...');
    try {
      const sb = getSupabase();
      if (sb && !AppState.isDemoMode) {
        const { error } = await sb.from('profiles').update({ name, email, class_name: cls, status }).eq('id', id);
        if (error) throw error;
      }

      const st = AppState.students.find(s => s.id === id);
      if (st) {
        st.name = name;
        st.email = email;
        st.class = cls;
        st.status = status;
      }

      showToast(`✅ Data siswa "${name}" berhasil diperbarui!`, 'success');
      closeModal();
      renderStudentManagement(document.getElementById('view-container'));
    } catch (err) {
      showToast('❌ Gagal perbarui data siswa: ' + err.message, 'error');
    } finally {
      setModalLoading(false, 'Simpan Perubahan');
    }
  }
  window.handleEditStudent = handleEditStudent;

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
        // 1. Coba buatkan akun login di Supabase Auth untuk pendidik ini tanpa mengganti sesi admin
        let authUserId = null;
        let authSuccess = false;
        try {
          const authClient = typeof getSupabaseAuthAdmin === 'function' ? getSupabaseAuthAdmin() : sb;
          const { data: authData, error: authErr } = await authClient.auth.signUp({
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
    const assignedCourses = AppState.courses.filter(c => c.authorId === id || c.author_id === id);
    let confirmMsg = `Apakah Anda yakin ingin menghapus akun pendidik "${name}"?`;
    if (assignedCourses.length > 0) {
      confirmMsg += `\n\n⚠️ Pendidik ini tercatat mengampu ${assignedCourses.length} course. Relasi pengampu pada course akan dilepas terlebih dahulu.`;
    }
    confirmMsg += '\n\nTindakan ini permanen. Lanjutkan?';

    if (!confirm(confirmMsg)) return;

    try {
      showToast('Sedang menghapus akun pendidik...', 'info');
      const sb = getSupabase();
      if (sb && !AppState.isDemoMode) {
        // Coba panggil stored procedure RPC delete_user_account jika sudah diinstal di Supabase
        let rpcDeleted = false;
        try {
          const { data: rpcRes, error: rpcErr } = await sb.rpc('delete_user_account', { target_user_id: id });
          if (!rpcErr && rpcRes && rpcRes.success) {
            rpcDeleted = true;
          }
        } catch (_) {}

        if (!rpcDeleted) {
          // 1. Lepaskan keterkaitan author_id di tabel courses agar tidak memicu foreign key violation
          try {
            await sb.from('courses').update({ author_id: null, author_name: 'Belum Ditentukan' }).eq('author_id', id);
          } catch (e) {
            console.warn('Gagal lepas author_id di courses:', e);
          }

          // 2. Bersihkan pendaftaran, progress, atau submissions terkait jika ada
          try { await sb.from('enrollments').delete().eq('student_id', id); } catch (_) {}
          try { await sb.from('progress').delete().eq('student_id', id); } catch (_) {}
          try { await sb.from('submissions').delete().eq('tutor_id', id); } catch (_) {}
          try { await sb.from('submissions').delete().eq('student_id', id); } catch (_) {}

          // 3. Hapus profil dari tabel profiles
          const { error } = await sb.from('profiles').delete().eq('id', id);
          if (error) throw error;
        }

        showToast(`✅ Akun pendidik "${name}" berhasil dihapus dari database.`, 'success');
      } else {
        showToast(`✅ Akun pendidik "${name}" dihapus (mode demo).`, 'success');
      }

      // Update data kursus di memori
      AppState.courses.forEach(c => {
        if (c.authorId === id || c.author_id === id) {
          c.authorId = null;
          c.author_id = null;
          c.authorName = 'Belum Ditentukan';
        }
      });

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

  // --- Delete Student ---
  async function confirmDeleteStudent(studentId, studentName) {
    if (AppState.currentRole !== 'admin') {
      showToast('⛔ Akses Ditolak: Hanya Administrator yang berwenang menghapus data peserta didik.', 'error');
      return;
    }
    const confirmed = confirm(
      `⚠️ PERINGATAN: Anda akan menghapus akun peserta didik "${studentName}".\n\n` +
      `• Riwayat pengerjaan materi & nilai kuis\n` +
      `• Pendaftaran ke seluruh course (enrollments)\n` +
      `• Profil akun peserta didik & autentikasi sistem\n\n` +
      `Tindakan ini permanen. Lanjutkan?`
    );
    if (!confirmed) return;

    try {
      showToast('Sedang menghapus peserta didik...', 'info');
      const sb = getSupabase();
      if (sb && !AppState.isDemoMode) {
        // Coba panggil stored procedure RPC delete_user_account jika sudah diinstal di Supabase
        let rpcDeleted = false;
        try {
          const { data: rpcRes, error: rpcErr } = await sb.rpc('delete_user_account', { target_user_id: studentId });
          if (!rpcErr && rpcRes && rpcRes.success) {
            rpcDeleted = true;
          }
        } catch (_) {}

        if (!rpcDeleted) {
          // 1. Hapus entitas relasi terlebih dahulu dengan kolom yang tepat (student_id)
          const { error: prErr } = await sb.from('progress').delete().eq('student_id', studentId);
          if (prErr) console.warn('Pembersihan progress siswa:', prErr);

          const { error: enErr } = await sb.from('enrollments').delete().eq('student_id', studentId);
          if (enErr) console.warn('Pembersihan enrollments siswa:', enErr);

          try { await sb.from('submissions').delete().eq('student_id', studentId); } catch (_) {}
          
          // 2. Hapus profil dari tabel profiles
          const { error } = await sb.from('profiles').delete().eq('id', studentId);
          if (error) throw error;
        }

        showToast(`✅ Data peserta didik "${studentName}" berhasil dihapus dari database.`, 'success');
      } else {
        showToast(`✅ Data peserta didik "${studentName}" dihapus (mode demo).`, 'success');
      }

      // 3. Perbarui daftar siswa di state memori
      AppState.students = AppState.students.filter(s => s.id !== studentId);

      // 4. Sinkronisasi status jumlah siswa terdaftar di course secara realtime (Catatan 3)
      if (sb && !AppState.isDemoMode) {
        await loadEnrollmentCounts(sb);
      } else {
        (AppState.courses || []).forEach(c => {
          c.enrolledStudents = Math.max(0, (c.enrolledStudents || 1) - 1);
        });
      }

      renderStudentManagement(document.getElementById('view-container'));
    } catch (err) {
      showToast('❌ Gagal menghapus peserta didik: ' + err.message, 'error');
    }
  }
  window.confirmDeleteStudent = confirmDeleteStudent;

  // --- Enrollment View ---
  function openEnrollModal(courseId) {
    if (AppState.currentRole !== 'admin') {
      showToast('⛔ Akses Ditolak: Pengelolaan pendaftaran peserta hanya dapat dilakukan oleh Administrator.', 'warning');
      return;
    }
    const course = AppState.courses.find(c => c.id === courseId);
    const studentOptions = AppState.students.map(s =>
      `<option value="${s.id}">${escHtml(s.name)} (${escHtml(s.class)})</option>`
    ).join('');

    document.getElementById('modal-title').textContent = `Daftarkan Siswa: ${course?.title || ''}`;
    document.getElementById('modal-content').innerHTML = `
      <p style="margin-bottom:1rem;color:var(--tertiary);">Pilih siswa yang akan didaftarkan ke course ini secara langsung.</p>
      <div class="form-group">
        <label class="form-label">Pilih Siswa</label>
        <select id="enroll-student-select" class="form-control" required>
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
      if (!studentId || !student) {
        showToast('Pilih siswa terlebih dahulu.', 'error');
        return;
      }

      setModalLoading(true, 'Mendaftarkan...');
      try {
        const sb = getSupabase();
        if (sb && !AppState.isDemoMode) {
          await dbEnrollStudent(courseId, studentId);
        }
        AppState.enrollments[courseId] = (AppState.enrollments[courseId] || 0) + 1;
        if (course) course.enrolledStudents = AppState.enrollments[courseId];
        showToast(`✅ ${student.name} berhasil didaftarkan ke course "${course?.title || ''}"!`, 'success');
        closeModal();
        if (AppState.currentRole === 'educator') renderEducatorDashboard(document.getElementById('view-container'));
        else if (AppState.currentRole === 'admin') renderAdminCourses(document.getElementById('view-container'));
      } catch (err) {
        showToast('❌ Gagal daftarkan siswa: ' + err.message, 'error');
      } finally {
        setModalLoading(false, 'Daftarkan ke Course');
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
        
        // Hapus profiles kecuali akun saat ini
        if (AppState.user?.email) {
          await sb.from('profiles').delete().neq('email', AppState.user.email);
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
   * VIEW: PUSAT PERSETUJUAN TUGAS & SESI ZOOM (TUTOR & ADMIN)
   * ========================================================= */
  function renderTutorApprovals(container) {
    if (!container) return;
    try {
      const sb = typeof getSupabase === 'function' ? getSupabase() : null;
      if (sb && (!AppState.submissions || AppState.submissions.length === 0)) {
        loadAssignmentSubmissions(sb).then(() => {
          if (AppState.currentView === 'tutor-approvals') {
            renderTutorApprovals(container);
          }
        });
      }

      const isEducator = AppState.currentRole === 'educator';
      const tutorId = AppState.user?.id;
      const tutorName = AppState.user?.name;
      const myCourseIds = isEducator
        ? AppState.courses
            .filter(c => c.authorId === tutorId || c.author_id === tutorId || c.instructor_id === tutorId || c.authorName === tutorName)
            .map(c => c.id)
        : null;

      let allSubs = AppState.submissions || [];
      if (isEducator && myCourseIds) {
        allSubs = allSubs.filter(s => myCourseIds.includes(s.course_id));
      }
      const subs = allSubs;
      const activeTab = AppState.activeApprovalTab || 'all';

      // Hitung ringkasan statistik
      const totalCount = subs.length;
      const pendingCount = subs.filter(s => s.approval_status === 'pending').length;
      const rejectedCount = subs.filter(s => s.approval_status === 'rejected').length;
      const approvedCount = subs.filter(s => s.approval_status === 'approved').length;
      const zoomCount = subs.filter(s => s.type === 'zoom').length;
      const driveCount = subs.filter(s => s.type === 'drive').length;

      // Filter submissions sesuai active tab
      let filteredSubs = [...subs];
      if (activeTab === 'pending') {
        filteredSubs = filteredSubs.filter(s => s.approval_status === 'pending');
      } else if (activeTab === 'drive') {
        filteredSubs = filteredSubs.filter(s => s.type === 'drive');
      } else if (activeTab === 'zoom') {
        filteredSubs = filteredSubs.filter(s => s.type === 'zoom');
      }

      // Courses untuk dropdown filter
      const coursesForDropdown = isEducator && myCourseIds
        ? AppState.courses.filter(c => myCourseIds.includes(c.id))
        : AppState.courses;
      const courseOptions = coursesForDropdown.map(c => 
        `<option value="${c.id}">${escHtml(c.title)}</option>`
      ).join('');

      // Render baris tabel
      const rowsHtml = filteredSubs.length === 0 ? `
        <tr>
          <td colspan="7" style="text-align:center;padding:3rem 1rem;color:var(--tertiary);">
            <div style="font-size:2.5rem;margin-bottom:0.5rem;">📂</div>
            <strong style="font-size:1rem;color:var(--primary);display:block;">Tidak ada data pengajuan pada filter ini</strong>
            <p style="font-size:0.875rem;margin:0.25rem 0 1rem;">Pengajuan tugas Google Drive dan usulan jadwal Zoom peserta akan tampil di sini.</p>
            <div style="display:flex;gap:0.75rem;justify-content:center;flex-wrap:wrap;">
              <button type="button" class="btn btn-primary btn-sm" onclick="demoTestApprovalModal(null, null)">
                ⚡ Uji Coba Form Persetujuan (Simulasi Tugas Siswa)
              </button>
              <button type="button" class="btn btn-outline btn-sm" onclick="refreshApprovalsView()">
                🔄 Sinkronkan Data dari Server
              </button>
            </div>
          </td>
        </tr>
      ` : filteredSubs.map(s => {
        const course = AppState.courses.find(c => c.id === s.course_id);
        const unit = course?.contents?.find(u => u.id === s.content_id);
        const isZoom = s.type === 'zoom';
        const student = AppState.students.find(st => st.id === s.student_id || st.email === s.student_email);
        const studentPhone = student?.whatsapp || student?.phone || '085712345678';
        const safeStudentName = (s.student_name && s.student_name.trim()) || 'Peserta';
        const initials = safeStudentName.split(/\s+/).slice(0, 2).map(w => w ? w[0].toUpperCase() : 'S').join('') || 'P';

        // Status approval badge
        let approvalBadge = '';
        if (s.approval_status === 'approved') {
          approvalBadge = `<span class="badge" style="background:#dcfce7;color:#166534;font-weight:700;">✅ Disetujui (Lulus)</span>`;
        } else if (s.approval_status === 'rejected') {
          approvalBadge = `<span class="badge" style="background:#fee2e2;color:#991b1b;font-weight:700;">⚠️ Perlu Revisi</span>`;
        } else {
          approvalBadge = `<span class="badge" style="background:#fef3c7;color:#92400e;font-weight:700;">⏳ Menunggu Review</span>`;
        }

        // Schedule badge for zoom
        let scheduleBadge = '';
        if (isZoom) {
          if (s.schedule_status === 'confirmed') {
            scheduleBadge = `<span class="badge" style="background:#e0e7ff;color:#3730a3;font-size:0.75rem;">🤝 Jadwal Disetujui</span>`;
          } else if (s.schedule_status === 'rescheduled') {
            scheduleBadge = `<span class="badge" style="background:#fef3c7;color:#92400e;font-size:0.75rem;">🔄 Dijadwalkan Ulang</span>`;
          } else {
            scheduleBadge = `<span class="badge" style="background:#f1f5f9;color:#475569;font-size:0.75rem;">🕒 Menunggu Konfirmasi</span>`;
          }
        }

        // Meeting time string - safe toLocaleString
        const dateDisplay = isZoom 
          ? (s.zoom_meeting_time ? new Date(s.zoom_meeting_time).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) + ' WIB' : 'Waktu belum diatur')
          : (s.submitted_at ? new Date(s.submitted_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '-');

        // WhatsApp message for tutor to contact student
        const tutorName = AppState.user?.name || 'Tutor';
        const courseTitle = course?.title || 'Course';
        const unitTitle = unit?.title || 'Tema Materi';
        let waStudentMsg = '';
        if (isZoom) {
          waStudentMsg = `Halo ${safeStudentName}, saya Coach ${tutorName} dari kelas "${courseTitle}". Mengenai sesi tatap muka Zoom pada materi "${unitTitle}" yang dijadwalkan pada ${dateDisplay}, saya mengonfirmasi kesiapan pertemuan virtual kita. Sampai jumpa di ruang Zoom!\n\nLink Zoom: ${s.zoom_url || ''}`;
        } else {
          waStudentMsg = `Halo ${safeStudentName}, saya Coach ${tutorName} dari kelas "${courseTitle}". Saya telah memeriksa tugas link Google Drive Anda untuk tema "${unitTitle}". ${s.approval_status === 'approved' ? 'Selamat, tugas Anda telah disetujui!' : (s.approval_status === 'rejected' ? 'Mohon periksa catatan revisi di LMS dan kirimkan kembali perbaikannya ya.' : 'Tugas Anda sedang dalam proses peninjauan.')}`;
        }
        const waStudentUrl = buildWhatsAppLink(studentPhone, waStudentMsg);

        return `
          <tr data-submission-id="${s.id}" data-course-id="${s.course_id || ''}" data-status="${s.approval_status || 'pending'}" data-type="${s.type}">
            <td>
              <div style="display:flex;align-items:center;gap:0.75rem;">
                <div style="width:36px;height:36px;border-radius:50%;background:#e2e8f0;color:#1e293b;font-weight:700;display:flex;align-items:center;justify-content:center;font-size:0.8125rem;flex-shrink:0;">
                  ${initials}
                </div>
                <div>
                  <div style="font-weight:600;color:var(--primary);">${escHtml(safeStudentName)}</div>
                  <div style="font-size:0.75rem;color:var(--tertiary);">${escHtml(student?.class || s.student_email || 'Siswa')}</div>
                </div>
              </div>
            </td>
            <td>
              <div style="font-weight:600;color:var(--primary);max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escHtml(course?.title || '')}">
                ${escHtml(course?.title || 'Course')}
              </div>
              <div style="font-size:0.75rem;color:var(--tertiary);max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                ${escHtml(unit?.sectionName || 'Tema')} › ${escHtml(unit?.title || s.type)}
              </div>
            </td>
            <td>
              ${isZoom ? `
                <div style="display:flex;flex-direction:column;gap:0.25rem;">
                  <span class="badge" style="background:#dbeafe;color:#1e40af;font-weight:600;width:fit-content;">📹 Sesi Zoom</span>
                  <a href="${escHtml(s.zoom_url || '#')}" target="_blank" rel="noopener noreferrer" style="font-size:0.75rem;color:var(--secondary-hover);word-break:break-all;max-width:180px;overflow:hidden;text-overflow:ellipsis;display:inline-block;" title="${escHtml(s.zoom_url || '')}">
                    🔗 ${escHtml(s.zoom_url || 'Link Zoom')}
                  </a>
                </div>
              ` : `
                <div style="display:flex;flex-direction:column;gap:0.25rem;">
                  <span class="badge" style="background:#f0fdf4;color:#166534;font-weight:600;width:fit-content;">📁 Google Drive</span>
                  <a href="${escHtml(s.drive_url || '#')}" target="_blank" rel="noopener noreferrer" style="font-size:0.75rem;color:#16a34a;word-break:break-all;max-width:180px;overflow:hidden;text-overflow:ellipsis;display:inline-block;" title="${escHtml(s.drive_url || '')}">
                    📂 Buka Google Drive ↗
                  </a>
                </div>
              `}
            </td>
            <td>
              <div style="font-size:0.8125rem;font-weight:600;color:var(--primary);">${dateDisplay}</div>
              ${isZoom ? `<div style="margin-top:0.2rem;">${scheduleBadge}</div>` : `<div style="font-size:0.75rem;color:var(--tertiary);">Dikirim oleh siswa</div>`}
            </td>
            <td>
              ${approvalBadge}
              ${!isZoom && s.score !== null && s.score !== undefined ? `<div style="font-size:0.75rem;font-weight:700;color:var(--primary);margin-top:0.25rem;">Nilai: ${s.score}/100</div>` : ''}
            </td>
            <td style="max-width:180px;">
              ${s.tutor_feedback ? `
                <div style="font-size:0.75rem;color:var(--on-surface);background:#f8fafc;padding:0.4rem 0.6rem;border-radius:6px;border-left:3px solid var(--primary);white-space:normal;">
                  "${escHtml(s.tutor_feedback)}"
                </div>
              ` : `
                <span style="font-size:0.75rem;color:var(--tertiary);font-style:italic;">Belum ada catatan</span>
              `}
            </td>
            <td>
              <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">
                <button class="btn btn-primary btn-sm" onclick="openModalReviewSubmission('${s.id}')" title="${isZoom ? 'Konfirmasi kehadiran & pelaksanaan sesi Zoom' : 'Periksa berkas & beri keputusan kelulusan tema'}">
                  ${isZoom ? '📝 Konfirmasi Selesai' : '✏️ Review'}
                </button>
                ${isZoom ? `
                  <button class="btn btn-outline btn-sm" onclick="openModalConfirmZoomSchedule('${s.id}')" title="Konfirmasi atau jadwalkan ulang sesi Zoom">
                    📅 Jadwal
                  </button>
                ` : ''}
                <a href="${waStudentUrl}" target="_blank" rel="noopener noreferrer" class="btn-whatsapp" style="padding:0.35rem 0.65rem;font-size:0.75rem;" title="Hubungi siswa via WhatsApp">
                  <svg viewBox="0 0 24 24" style="width:14px;height:14px;"><path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.711 2.598 2.664-.698c.969.584 1.761.813 2.796.814 3.183 0 5.769-2.587 5.769-5.767 0-3.181-2.586-5.768-5.769-5.768zm7.969 5.766c0 4.398-3.572 7.969-7.969 7.969-1.393 0-2.696-.36-3.83-1l-4.181 1.095 1.115-4.083c-.724-1.189-1.104-2.56-1.104-3.981 0-4.398 3.572-7.969 7.969-7.969 4.397 0 7.969 3.571 7.969 7.969z"/></svg>
                  WA
                </a>
              </div>
            </td>
          </tr>
        `;
      }).join('');

      container.innerHTML = `
        <div style="max-width:1200px;margin:0 auto;">
          <!-- Header Info -->
          <div style="background:linear-gradient(135deg, #1e1b4b 0%, #312e81 100%);color:#ffffff;border-radius:var(--radius-lg);padding:1.5rem 1.75rem;margin-bottom:1.5rem;box-shadow:var(--shadow-2);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1rem;">
            <div>
              <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.35rem;">
                <span style="font-size:1.5rem;">👨‍🏫</span>
                <h2 style="margin:0;font-size:1.35rem;font-weight:700;color:#ffffff;">Pusat Persetujuan Tugas & Mentoring Zoom</h2>
              </div>
              <p style="margin:0;font-size:0.875rem;color:#c7d2fe;line-height:1.5;">
                Tinjau pengajuan tugas Drive peserta, setujui kelulusan tema untuk membuka bab berikutnya, dan koordinasikan jadwal sesi tatap muka virtual via WhatsApp.
              </p>
            </div>
            <div style="display:flex;align-items:center;gap:0.75rem;">
              <button class="btn btn-sm" style="background:rgba(255,255,255,0.15);color:#ffffff;border:1px solid rgba(255,255,255,0.25);" onclick="refreshApprovalsView()">
                🔄 Muat Ulang Data
              </button>
            </div>
          </div>

          <!-- Metric Stat Cards -->
          <div class="approval-stats-grid">
            <div class="approval-stat-card">
              <div class="approval-stat-icon" style="background:#eff6ff;color:#2563eb;">📑</div>
              <div>
                <div class="approval-stat-val">${totalCount}</div>
                <div class="approval-stat-lbl">Total Seluruh Pengajuan</div>
              </div>
            </div>
            <div class="approval-stat-card" style="border-left:4px solid #f59e0b;">
              <div class="approval-stat-icon" style="background:#fef3c7;color:#d97706;">⏳</div>
              <div>
                <div class="approval-stat-val" style="color:#b45309;">${pendingCount}</div>
                <div class="approval-stat-lbl">Menunggu Persetujuan</div>
              </div>
            </div>
            <div class="approval-stat-card" style="border-left:4px solid #ef4444;">
              <div class="approval-stat-icon" style="background:#fee2e2;color:#dc2626;">⚠️</div>
              <div>
                <div class="approval-stat-val" style="color:#b91c1c;">${rejectedCount}</div>
                <div class="approval-stat-lbl">Perlu Revisi Siswa</div>
              </div>
            </div>
            <div class="approval-stat-card" style="border-left:4px solid #10b981;">
              <div class="approval-stat-icon" style="background:#dcfce7;color:#059669;">✅</div>
              <div>
                <div class="approval-stat-val" style="color:#15803d;">${approvedCount}</div>
                <div class="approval-stat-lbl">Disetujui (Lulus Tema)</div>
              </div>
            </div>
            <div class="approval-stat-card">
              <div class="approval-stat-icon" style="background:#f3e8ff;color:#7c3aed;">📹</div>
              <div>
                <div class="approval-stat-val">${zoomCount}</div>
                <div class="approval-stat-lbl">Sesi Mentoring Zoom</div>
              </div>
            </div>
          </div>

          <!-- Tabs Filter & Action Bar -->
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1rem;margin-bottom:1rem;">
            <div class="approval-tabs-bar" style="margin-bottom:0;">
              <button class="approval-tab-btn ${activeTab === 'all' ? 'active' : ''}" onclick="setApprovalFilterTab('all')">
                <span>Semua</span>
                <span class="badge" style="background:#e2e8f0;color:#334155;font-size:0.75rem;">${totalCount}</span>
              </button>
              <button class="approval-tab-btn ${activeTab === 'pending' ? 'active' : ''}" onclick="setApprovalFilterTab('pending')">
                <span>Menunggu Review</span>
                <span class="badge" style="background:#fef3c7;color:#92400e;font-size:0.75rem;">${pendingCount}</span>
              </button>
              <button class="approval-tab-btn ${activeTab === 'drive' ? 'active' : ''}" onclick="setApprovalFilterTab('drive')">
                <span>📁 Tugas Drive</span>
                <span class="badge" style="background:#f0fdf4;color:#166534;font-size:0.75rem;">${driveCount}</span>
              </button>
              <button class="approval-tab-btn ${activeTab === 'zoom' ? 'active' : ''}" onclick="setApprovalFilterTab('zoom')">
                <span>📹 Sesi Zoom</span>
                <span class="badge" style="background:#eff6ff;color:#1e40af;font-size:0.75rem;">${zoomCount}</span>
              </button>
            </div>

            <!-- Quick Filters: Course & Search -->
            <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;">
              <select id="filter-approval-course" class="form-control" style="width:200px;font-size:0.8125rem;padding:0.4rem 0.65rem;" onchange="filterApprovalsTable()">
                <option value="">— Semua Course —</option>
                ${courseOptions}
              </select>
              <input type="text" id="filter-approval-search" class="form-control" placeholder="🔍 Cari siswa atau tema..." style="width:200px;font-size:0.8125rem;padding:0.4rem 0.65rem;" oninput="filterApprovalsTable()">
            </div>
          </div>

          <!-- Modern Table List -->
          <div class="table-container-responsive">
            <table class="table-modern" id="table-approvals-list">
              <thead>
                <tr>
                  <th style="width:20%;">Peserta Didik</th>
                  <th style="width:20%;">Course &amp; Tema</th>
                  <th style="width:16%;">Tautan Tugas</th>
                  <th style="width:14%;">Jadwal / Waktu</th>
                  <th style="width:12%;">Status Tema</th>
                  <th style="width:10%;">Masukan Tutor</th>
                  <th style="width:8%;">Aksi</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
              </tbody>
            </table>
          </div>
        </div>
      `;
    } catch (err) {
      console.error('Error rendering tutor approvals:', err);
      container.innerHTML = `
        <div style="padding:2.5rem;text-align:center;">
          <div style="display:inline-block;text-align:left;max-width:550px;background:#fef2f2;border:1px solid #f87171;border-radius:12px;padding:1.5rem;">
            <h4 style="margin:0 0 0.5rem;color:#991b1b;font-size:1.1rem;">⚠️ Kendala Menampilkan Pusat Persetujuan</h4>
            <p style="margin:0 0 1rem;font-size:0.875rem;color:#7f1d1d;">${escHtml(err.message)}</p>
            <button class="btn btn-primary btn-sm" onclick="refreshApprovalsView()">🔄 Coba Muat Ulang</button>
          </div>
        </div>
      `;
    }
  }

  /* =========================================================
   * VIEW: STATUS TUGAS & JADWAL ZOOM SAYA (PESERTA DIDIK)
   * ========================================================= */
  function renderStudentAssignments(container) {
    if (!container) return;
    const studentId = AppState.user?.id;
    const allSubs = AppState.submissions || [];
    
    // Filter submissions milik siswa yang sedang aktif
    const mySubs = allSubs.filter(s => s.student_id === studentId || s.student_email === AppState.user?.email || (!s.student_id && AppState.currentRole === 'student'));

    const totalCount = mySubs.length;
    const pendingCount = mySubs.filter(s => s.approval_status === 'pending').length;
    const rejectedCount = mySubs.filter(s => s.approval_status === 'rejected').length;
    const approvedCount = mySubs.filter(s => s.approval_status === 'approved').length;

    // Ambil tutor untuk course pertama yang diikuti siswa
    const sampleCourse = AppState.courses[0];
    const tutor = getTutorForCourse(sampleCourse);

    const cardsHtml = mySubs.length === 0 ? `
      <div style="text-align:center;padding:3.5rem 1rem;background:#ffffff;border-radius:var(--radius-lg);border:1px dashed var(--border);">
        <div style="font-size:3rem;margin-bottom:0.75rem;">📚</div>
        <h3 style="font-size:1.15rem;color:var(--primary);margin:0 0 0.5rem;">Belum Ada Tugas yang Dikirim</h3>
        <p style="font-size:0.875rem;color:var(--tertiary);max-width:500px;margin:0 auto 1.25rem;">
          Anda belum mengunggah tautan Google Drive atau mengajukan sesi tatap muka Zoom pada materi course yang Anda pelajari.
        </p>
        <button class="btn btn-primary" onclick="navigateTo('student-dashboard')">
          Buka Katalog Materi Belajar →
        </button>
      </div>
    ` : mySubs.map(s => {
      const course = AppState.courses.find(c => c.id === s.course_id);
      const unit = course?.contents?.find(u => u.id === s.content_id);
      const isZoom = s.type === 'zoom';
      const isApproved = s.approval_status === 'approved';
      const isRejected = s.approval_status === 'rejected';
      const isPending = s.approval_status === 'pending';

      const courseTutor = getTutorForCourse(course) || tutor;
      const meetingDateObj = s.zoom_meeting_time ? new Date(s.zoom_meeting_time) : null;
      const meetingTimeStr = meetingDateObj ? meetingDateObj.toLocaleString('id-ID', { dateStyle: 'full', timeStyle: 'short' }) : 'Belum ditentukan';

      const waConfirmUrl = buildWhatsAppZoomConfirmation(courseTutor, AppState.user || { name: 'Peserta' }, course, unit, meetingTimeStr, s.zoom_url, false);
      const waArrivedUrl = buildWhatsAppZoomConfirmation(courseTutor, AppState.user || { name: 'Peserta' }, course, unit, meetingTimeStr, s.zoom_url, true);

      return `
        <div class="assignment-card" style="margin-bottom:1.5rem;">
          <div class="assignment-card-header" style="background:${isApproved ? '#f0fdf4' : (isRejected ? '#fef2f2' : '#f8fafc')};border-bottom:1px solid ${isApproved ? '#bbf7d0' : (isRejected ? '#fecaca' : 'var(--border)')};">
            <div>
              <div style="font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:${isApproved ? '#166534' : (isRejected ? '#991b1b' : 'var(--tertiary)')};margin-bottom:0.25rem;">
                ${escHtml(course?.title || 'Course')} › ${escHtml(unit?.sectionName || 'Tema')}
              </div>
              <h3 class="assignment-card-title" style="margin:0;">
                <span>${isZoom ? '📹' : '📁'}</span> ${escHtml(unit?.title || 'Tugas Tema')}
              </h3>
            </div>
            <div>
              ${isApproved ? `
                <span class="badge badge-success" style="font-size:0.8125rem;">✅ Disetujui (Lulus Tema)</span>
              ` : (isRejected ? `
                <span class="badge badge-error" style="font-size:0.8125rem;">⚠️ Perlu Revisi / Mengulang</span>
              ` : `
                <span class="badge badge-warning" style="font-size:0.8125rem;">⏳ Menunggu Review Tutor</span>
              `)}
            </div>
          </div>

          <div class="assignment-card-body">
            ${isZoom ? `
              <!-- Detail Sesi Zoom -->
              <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:1.25rem;margin-bottom:1rem;">
                <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.75rem;margin-bottom:0.75rem;">
                  <div>
                    <div style="font-size:0.75rem;color:#1e40af;font-weight:600;">Jadwal Pertemuan Zoom Mentoring:</div>
                    <div style="font-size:1.05rem;font-weight:700;color:#1e3a8a;">${meetingTimeStr} WIB</div>
                    <div style="font-size:0.75rem;color:#3b82f6;margin-top:0.2rem;">
                      Status Jadwal: <strong>${s.schedule_status === 'confirmed' ? '🤝 Disetujui Tutor' : (s.schedule_status === 'rescheduled' ? '🔄 Dijadwalkan Ulang oleh Tutor' : '🕒 Menunggu Konfirmasi')}</strong>
                    </div>
                  </div>
                  <a href="${escHtml(s.zoom_url)}" target="_blank" rel="noopener noreferrer" class="btn-zoom-join">
                    🚀 Masuk Ruang Zoom ↗
                  </a>
                </div>
                <div style="font-size:0.8125rem;color:#475569;word-break:break-all;">
                  <strong>Link Room Peserta:</strong> <a href="${escHtml(s.zoom_url)}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;">${escHtml(s.zoom_url)}</a>
                </div>
              </div>
            ` : `
              <!-- Detail Tugas Google Drive -->
              <div style="background:#f8fafc;border:1px solid var(--border);border-radius:10px;padding:1.25rem;margin-bottom:1rem;">
                <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.5rem;">
                  <div>
                    <div style="font-size:0.75rem;color:var(--tertiary);">Berkas Google Drive Terkirim:</div>
                    <a href="${escHtml(s.drive_url)}" target="_blank" rel="noopener noreferrer" style="font-weight:600;color:var(--primary);text-decoration:underline;word-break:break-all;">
                      📂 ${escHtml(s.drive_url)} ↗
                    </a>
                  </div>
                  <a href="${escHtml(s.drive_url)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline btn-sm">
                    Buka Berkas Drive ↗
                  </a>
                </div>
                ${s.student_notes ? `
                  <div style="font-size:0.8125rem;color:var(--tertiary);margin-top:0.5rem;">
                    <strong>Catatan Anda:</strong> "${escHtml(s.student_notes)}"
                  </div>
                ` : ''}
              </div>
            `}

            <!-- Feedback & Keputusan Tutor -->
            ${isApproved ? `
              <div class="submission-status-card approved" style="margin-bottom:1rem;">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;margin-bottom:0.5rem;">
                  <strong style="color:#166534;">🎉 Kelulusan Tema Telah Diberikan</strong>
                  <span class="badge badge-success">Nilai: ${s.score || 90}/100</span>
                </div>
                <div class="submission-feedback-box" style="background:#ffffff;">
                  <strong>Masukan & Evaluasi Tutor (${escHtml(courseTutor.name)}):</strong><br>
                  ${escHtml(s.tutor_feedback || 'Pengerjaan tugas Anda telah disetujui. Tema berikutnya telah terbuka otomatis.')}
                </div>
                <div style="margin-top:0.75rem;">
                  <button class="btn btn-primary btn-sm" onclick="navigateTo('course-player', '${s.course_id}')">
                    Lanjut Belajar Materi Bab Selanjutnya →
                  </button>
                </div>
              </div>
            ` : (isRejected ? `
              <div class="submission-status-card rejected" style="margin-bottom:1rem;">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;margin-bottom:0.5rem;">
                  <strong style="color:#991b1b;">⚠️ Tugas Memerlukan Revisi Perbaikan</strong>
                  <span class="badge" style="background:#fee2e2;color:#991b1b;font-weight:700;">Wajib Mengulang</span>
                </div>
                <p style="font-size:0.875rem;margin:0 0 0.5rem;color:#7f1d1d;">
                  Tutor meminta Anda memperbaiki tugas ini sebelum tema berikutnya dapat dibuka.
                </p>
                <div class="submission-feedback-box" style="background:#ffffff;border-color:#fca5a5;">
                  <strong style="color:#991b1b;">Catatan Revisi Tutor (${escHtml(courseTutor.name)}):</strong><br>
                  ${escHtml(s.tutor_feedback || 'Mohon cermati kembali instruksi dan kirimkan revisi tugas Anda.')}
                </div>
                <div style="margin-top:0.75rem;display:flex;gap:0.5rem;flex-wrap:wrap;">
                  <button class="btn btn-primary btn-sm" onclick="navigateTo('course-player', '${s.course_id}')">
                    🔄 Buka Halaman Materi & Kirimkan Revisi
                  </button>
                </div>
              </div>
            ` : `
              <div class="submission-status-card pending" style="margin-bottom:1rem;">
                <strong style="color:#92400e;display:block;margin-bottom:0.35rem;">⏳ Sedang Dalam Pemeriksaan Tutor</strong>
                <p style="font-size:0.875rem;margin:0;color:#78350f;">
                  Tugas Anda telah masuk dalam antrean review Tutor <strong>${escHtml(courseTutor.name)}</strong>. Begitu tugas ini disetujui, bab materi berikutnya akan otomatis terbuka untuk Anda.
                </p>
              </div>
            `)}

            <!-- Hubungi Tutor via WhatsApp -->
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.75rem;padding-top:0.75rem;border-top:1px solid var(--border);">
              <div style="font-size:0.8125rem;color:var(--tertiary);">
                👨‍🏫 Tutor Pengampu: <strong>${escHtml(courseTutor.name)}</strong>
              </div>
              <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
                ${isZoom ? `
                  <a href="${waConfirmUrl}" target="_blank" rel="noopener noreferrer" class="btn-whatsapp" style="font-size:0.8125rem;padding:0.4rem 0.85rem;">
                    <svg viewBox="0 0 24 24" style="width:16px;height:16px;"><path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.711 2.598 2.664-.698c.969.584 1.761.813 2.796.814 3.183 0 5.769-2.587 5.769-5.767 0-3.181-2.586-5.768-5.769-5.768zm7.969 5.766c0 4.398-3.572 7.969-7.969 7.969-1.393 0-2.696-.36-3.83-1l-4.181 1.095 1.115-4.083c-.724-1.189-1.104-2.56-1.104-3.981 0-4.398 3.572-7.969 7.969-7.969 4.397 0 7.969 3.571 7.969 7.969z"/></svg>
                    Konfirmasi Jadwal via WA
                  </a>
                  <a href="${waArrivedUrl}" target="_blank" rel="noopener noreferrer" class="btn-whatsapp" style="background:#0f766e;font-size:0.8125rem;padding:0.4rem 0.85rem;">
                    <svg viewBox="0 0 24 24" style="width:16px;height:16px;"><path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.711 2.598 2.664-.698c.969.584 1.761.813 2.796.814 3.183 0 5.769-2.587 5.769-5.767 0-3.181-2.586-5.768-5.769-5.768zm7.969 5.766c0 4.398-3.572 7.969-7.969 7.969-1.393 0-2.696-.36-3.83-1l-4.181 1.095 1.115-4.083c-.724-1.189-1.104-2.56-1.104-3.981 0-4.398 3.572-7.969 7.969-7.969 4.397 0 7.969 3.571 7.969 7.969z"/></svg>
                    ⏰ Sudah Waktunya Zoom!
                  </a>
                ` : `
                  <a href="${buildWhatsAppLink(courseTutor.whatsapp || courseTutor.phone, `Halo Coach ${courseTutor.name}, saya ${AppState.user?.name || 'Peserta'} dari kelas "${course?.title || 'Course'}". Saya ingin menanyakan status review tugas Drive saya pada tema "${unit?.title || 'Tugas'}". Terima kasih! 🙏`)}" target="_blank" rel="noopener noreferrer" class="btn-whatsapp" style="font-size:0.8125rem;padding:0.4rem 0.85rem;">
                    <svg viewBox="0 0 24 24" style="width:16px;height:16px;"><path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.711 2.598 2.664-.698c.969.584 1.761.813 2.796.814 3.183 0 5.769-2.587 5.769-5.767 0-3.181-2.586-5.768-5.769-5.768zm7.969 5.766c0 4.398-3.572 7.969-7.969 7.969-1.393 0-2.696-.36-3.83-1l-4.181 1.095 1.115-4.083c-.724-1.189-1.104-2.56-1.104-3.981 0-4.398 3.572-7.969 7.969-7.969 4.397 0 7.969 3.571 7.969 7.969z"/></svg>
                    Chat Tutor via WhatsApp
                  </a>
                `}
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div style="max-width:960px;margin:0 auto;">
        <!-- Banner Edukasi Sistem Gatekeeping Tema -->
        <div style="background:linear-gradient(135deg, #047857 0%, #065f46 100%);color:#ffffff;border-radius:var(--radius-lg);padding:1.5rem 1.75rem;margin-bottom:1.5rem;box-shadow:var(--shadow-2);">
          <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.5rem;">
            <span style="font-size:1.75rem;">🎓</span>
            <div>
              <h2 style="margin:0;font-size:1.35rem;font-weight:700;color:#ffffff;">Status Tugas &amp; Persetujuan Tema Belajar</h2>
              <div style="font-size:0.8125rem;color:#a7f3d0;">Sistem Pembelajaran Terpandu &amp; Mentoring Intensif</div>
            </div>
          </div>
          <p style="margin:0;font-size:0.875rem;color:#ecfdf5;line-height:1.6;">
            Dalam LMS ini, Anda belajar secara terstruktur dari tema ke tema. Untuk melangkah ke tema berikutnya, tugas praktik Google Drive atau sesi temu tatap muka virtual Zoom Anda <strong>wajib disetujui oleh Tutor pengampu</strong>. Jika belum disetujui atau memerlukan revisi, Anda dapat menyempurnakan tugas Anda kembali.
          </p>
        </div>

        <!-- Kartu Ringkasan Status -->
        <div class="approval-stats-grid" style="grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));margin-bottom:1.5rem;">
          <div class="approval-stat-card">
            <div class="approval-stat-icon" style="background:#eff6ff;color:#2563eb;">📚</div>
            <div>
              <div class="approval-stat-val">${totalCount}</div>
              <div class="approval-stat-lbl">Tugas Terkirim</div>
            </div>
          </div>
          <div class="approval-stat-card" style="border-left:4px solid #f59e0b;">
            <div class="approval-stat-icon" style="background:#fef3c7;color:#d97706;">⏳</div>
            <div>
              <div class="approval-stat-val" style="color:#b45309;">${pendingCount}</div>
              <div class="approval-stat-lbl">Menunggu Review</div>
            </div>
          </div>
          <div class="approval-stat-card" style="border-left:4px solid #ef4444;">
            <div class="approval-stat-icon" style="background:#fee2e2;color:#dc2626;">⚠️</div>
            <div>
              <div class="approval-stat-val" style="color:#b91c1c;">${rejectedCount}</div>
              <div class="approval-stat-lbl">Perlu Revisi</div>
            </div>
          </div>
          <div class="approval-stat-card" style="border-left:4px solid #10b981;">
            <div class="approval-stat-icon" style="background:#dcfce7;color:#059669;">✅</div>
            <div>
              <div class="approval-stat-val" style="color:#15803d;">${approvedCount}</div>
              <div class="approval-stat-lbl">Tema Disetujui</div>
            </div>
          </div>
        </div>

        <!-- Daftar Tugas -->
        <div style="margin-bottom:1rem;display:flex;align-items:center;justify-content:space-between;">
          <h3 style="margin:0;font-size:1.1rem;color:var(--primary);">Daftar Penugasan &amp; Riwayat Mentoring</h3>
          <button class="btn btn-outline btn-sm" onclick="navigateTo('student-dashboard')">
            ← Kembali ke Katalog Kelas
          </button>
        </div>

        <div>
          ${cardsHtml}
        </div>
      </div>
    `;
  }

  // --- Handlers Interaktif Filter & Table Approvals ---
  window.setApprovalFilterTab = function(tabName) {
    AppState.activeApprovalTab = tabName;
    renderTutorApprovals(document.getElementById('view-container'));
  };

  window.refreshApprovalsView = async function() {
    showToast('Memperbarui data pengajuan...', 'info');
    const sb = typeof getSupabase === 'function' ? getSupabase() : null;
    await loadAssignmentSubmissions(sb);
    renderTutorApprovals(document.getElementById('view-container'));
    showToast('Data pengajuan berhasil diperbarui.', 'success');
  };

  window.filterApprovalsTable = function() {
    const courseId = document.getElementById('filter-approval-course')?.value || '';
    const search = (document.getElementById('filter-approval-search')?.value || '').toLowerCase().trim();
    const rows = document.querySelectorAll('#table-approvals-list tbody tr');

    rows.forEach(tr => {
      const trCourse = tr.getAttribute('data-course-id') || '';
      const text = tr.innerText.toLowerCase();

      let matchCourse = !courseId || trCourse === courseId;
      let matchSearch = !search || text.includes(search);

      tr.style.display = (matchCourse && matchSearch) ? '' : 'none';
    });
  };

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
    const modal = document.getElementById('global-modal');
    if (modal) {
      modal.classList.remove('active');
      modal.style.display = 'none';
      const box = modal.querySelector('.modal-box');
      if (box) box.classList.remove('modal-lg');
    }
  }

  window.closeModal = closeModal;

  function setModalLoading(loading, defaultText) {
    const btn = document.getElementById('modal-action-btn');
    if (!btn) return;
    btn.disabled = loading;
    btn.textContent = loading ? 'Menyimpan...' : defaultText;
  }

  function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = '✅';
    if (type === 'error') icon = '❌';
    else if (type === 'warning') icon = '⚠️';
    else if (type === 'info') icon = 'ℹ️';

    toast.innerHTML = `
      <div class="toast-content-wrapper">
        <span class="toast-icon">${icon}</span>
        <span class="toast-message">${message}</span>
      </div>
      <div class="toast-progress-bar"></div>
    `;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('toast-fade-out');
      setTimeout(() => toast.remove(), 250);
    }, 3250);
  }

  // --- UI/UX Helpers: Global Search & Arabic Typography Engine ---
  function handleGlobalSearch(query) {
    if (!query) {
      const cards = document.querySelectorAll('.card-course-elevated, .stat-card-elevated');
      cards.forEach(c => c.style.display = '');
      const rows = document.querySelectorAll('.data-table tbody tr');
      rows.forEach(r => r.style.display = '');
      return;
    }

    const q = query.trim().toLowerCase();

    // Filter kartu kursus yang ada di halaman saat ini
    const courseCards = document.querySelectorAll('.card-course-elevated');
    if (courseCards.length > 0) {
      courseCards.forEach(card => {
        const text = card.textContent.toLowerCase();
        card.style.display = text.includes(q) ? '' : 'none';
      });
    }

    // Filter baris tabel jika sedang di halaman manajemen atau rekap
    const tableRows = document.querySelectorAll('.data-table tbody tr');
    if (tableRows.length > 0) {
      tableRows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(q) ? '' : 'none';
      });
    }
  }
  window.handleGlobalSearch = handleGlobalSearch;

  // Shortcut keyboard Ctrl + K / Cmd + K untuk quick search
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      const searchInput = document.getElementById('global-search-input');
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
    }
  });

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

  // --- 12. MESIN CETAK & EKSPOR PDF RESMI FORMAT A4 (PIXEL-PERFECT A4 PRINT ENGINE) ---
  function printReportHTML(htmlContent, docTitle = 'Laporan_CourseHub') {
    let iframe = document.getElementById('lms-print-frame');
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.id = 'lms-print-frame';
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      iframe.style.visibility = 'hidden';
      document.body.appendChild(iframe);
    }

    const frameDoc = iframe.contentWindow || iframe.contentDocument;
    const doc = frameDoc.document || frameDoc;
    doc.open();
    doc.write(htmlContent);
    doc.close();

    showToast('📄 Menyiapkan dokumen format A4 untuk dicetak / disimpan PDF...', 'info');

    setTimeout(() => {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        showToast('✅ Dokumen PDF format A4 siap diunduh!', 'success');
      } catch (err) {
        console.warn('Gagal cetak via iframe, fallback window:', err);
        const win = window.open('', '_blank');
        if (win) {
          win.document.write(htmlContent);
          win.document.close();
          win.focus();
          win.print();
        }
      }
    }, 450);
  }

  async function exportPDF(studentName, courseId = null, studentId = null) {
    const student = (studentId && AppState.students.find(s => s.id === studentId)) ||
      AppState.students.find(s => s.name?.toLowerCase() === (studentName || '').toLowerCase()) ||
      (AppState.user?.name === studentName ? AppState.user : null) ||
      { id: studentId || AppState.user?.id, name: studentName || 'Peserta Didik', email: 'siswa@coursehub.sch.id', class: 'Kelas X' };

    const course = (courseId && AppState.courses.find(c => c.id === courseId)) ||
      AppState.activeCoursePlayer ||
      AppState.courses[0] ||
      { title: 'Pelatihan Terstruktur', contents: [] };

    const tutor = getTutorForCourse(course);
    const contents = course.contents || [];
    const totalUnits = contents.length;

    // Ambil data progress nyata dari database Supabase untuk siswa ini
    const sb = typeof getSupabase === 'function' ? getSupabase() : null;
    let studentProgressRecords = [];
    if (sb && !AppState.isDemoMode && student.id) {
      try {
        const { data, error } = await sb.from('progress').select('*').eq('student_id', student.id);
        if (!error && Array.isArray(data)) {
          studentProgressRecords = data;
        }
      } catch (err) {
        console.warn('Gagal memuat progress individual di exportPDF:', err);
      }
    }
    if (studentProgressRecords.length === 0 && AppState.allProgressRecords) {
      studentProgressRecords = AppState.allProgressRecords.filter(p => p.student_id === student.id);
    }

    const studentSubmissions = (AppState.submissions || []).filter(sub => sub.student_id === student.id);
    const isCurrentActiveStudent = (AppState.user?.id === student.id);

    // Evaluasi data capaian per materi
    let completedCount = 0;
    let totalScore = 0;
    let scoreCount = 0;

    const unitRows = contents.map((u, idx) => {
      const typeLower = (u.type || '').toLowerCase();
      const isQuiz = ['kuis', 'kuis_popup', 'pre_exam', 'post_exam', 'evaluasi'].includes(typeLower);
      const isDrive = typeLower === 'tugas_drive' || typeLower === 'tugas';
      const isZoom = typeLower === 'tugas_zoom';

      const progItem = studentProgressRecords.find(p => p.content_id === u.id);
      const subItem = studentSubmissions.find(s => s.content_id === u.id && s.approval_status === 'approved');

      const isDone = Boolean(
        (progItem && (progItem.status === 'Selesai' || progItem.is_passed !== false)) ||
        subItem ||
        (isCurrentActiveStudent && (u.completed || AppState.progressMap?.[u.id]))
      );
      if (isDone) completedCount++;

      let scoreLabel = '-';
      if (isQuiz) {
        let sc = null;
        if (progItem && typeof progItem.score === 'number') sc = progItem.score;
        else if (isCurrentActiveStudent && AppState.lastQuizResults?.[u.id]?.score !== undefined) sc = AppState.lastQuizResults[u.id].score;
        else if (isCurrentActiveStudent && AppState.progressData?.[u.id]?.score !== undefined) sc = AppState.progressData[u.id].score;
        else if (isDone) sc = 85;

        if (sc !== null) {
          scoreLabel = `${sc} / 100`;
          totalScore += sc;
          scoreCount++;
        } else {
          scoreLabel = '-';
        }
      } else if (isDrive) {
        let sc = subItem?.score ?? (progItem?.score ?? (isDone ? 90 : null));
        if (sc !== null) {
          scoreLabel = `${sc} / 100`;
          totalScore += sc;
          scoreCount++;
        } else {
          scoreLabel = isDone ? '100 / 100' : '-';
        }
      } else if (isZoom) {
        // Catatan 4: Sesi Zoom tidak menggunakan skor nilai
        scoreLabel = isDone ? 'Terlaksana' : '-';
      } else if (isDone) {
        scoreLabel = '100 / 100';
      }

      let typeBadge = 'Materi';
      if (typeLower === 'video') typeBadge = 'Video';
      else if (typeLower === 'pre_exam') typeBadge = 'Pre-Exam';
      else if (typeLower === 'post_exam') typeBadge = 'Post-Exam';
      else if (isQuiz) typeBadge = 'Kuis';
      else if (isDrive) typeBadge = 'Tugas Drive';
      else if (isZoom) typeBadge = 'Tatap Muka Zoom';

      return `
        <tr>
          <td style="text-align:center;font-weight:600;color:#64748b;">${idx + 1}</td>
          <td><span style="font-size:7.5pt;background:#f1f5f9;color:#475569;padding:2px 5px;border-radius:4px;font-weight:600;">${escHtml(u.sectionName || 'Modul Umum')}</span></td>
          <td style="font-weight:600;color:#1e293b;">${escHtml(u.title)}</td>
          <td style="text-align:center;">${typeBadge}</td>
          <td style="text-align:center;font-weight:700;color:#0f766e;">${scoreLabel}</td>
          <td style="text-align:center;">
            ${isDone 
              ? '<span class="tag-selesai">✅ Selesai</span>' 
              : '<span class="tag-proses">⏳ Proses</span>'}
          </td>
        </tr>
      `;
    }).join('');

    const progressPct = totalUnits > 0 ? Math.round((completedCount / totalUnits) * 100) : 0;
    const avgScore = scoreCount > 0 ? Math.round(totalScore / scoreCount) : (completedCount > 0 ? 85 : 0);
    const isGraduated = progressPct >= 100;
    const todayStr = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    const docId = `CH/REP/${new Date().getFullYear()}/${String(Math.abs(course.id.split('-')[0].hashCode?.() || 7421)).substring(0, 4)}/${Math.floor(1000 + Math.random() * 9000)}`;

    const htmlDoc = `
      <!DOCTYPE html>
      <html lang="id">
      <head>
        <meta charset="UTF-8">
        <title>Laporan Capaian Belajar - ${escHtml(student.name)}</title>
        <style>
          @page {
            size: A4 portrait;
            margin: 12mm 15mm 15mm 15mm;
          }
          * { box-sizing: border-box; }
          body {
            font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Arial, sans-serif;
            color: #1e293b;
            background: #ffffff;
            margin: 0;
            padding: 0;
            font-size: 9.5pt;
            line-height: 1.45;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .report-sheet {
            width: 100%;
            max-width: 210mm;
            margin: 0 auto;
          }
          .inst-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 2.5px solid #1e3a5f;
            padding-bottom: 10px;
            margin-bottom: 14px;
          }
          .inst-logo-box {
            display: flex;
            align-items: center;
            gap: 12px;
          }
          .inst-crest {
            width: 44px;
            height: 44px;
            background: linear-gradient(135deg, #1e3a5f 0%, #14b8a6 100%);
            color: #ffffff;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 22px;
            font-weight: 800;
          }
          .inst-title {
            font-size: 14pt;
            font-weight: 800;
            color: #1e3a5f;
            margin: 0;
            letter-spacing: -0.3px;
          }
          .inst-subtitle {
            font-size: 8pt;
            color: #64748b;
            margin: 2px 0 0;
            font-weight: 500;
          }
          .doc-meta {
            text-align: right;
            font-size: 8pt;
            color: #475569;
            line-height: 1.4;
          }
          .doc-title-container {
            text-align: center;
            margin-bottom: 14px;
            padding: 7px 0;
            background: #f8fafc;
            border-radius: 6px;
            border: 1px solid #e2e8f0;
          }
          .doc-title {
            font-size: 12pt;
            font-weight: 800;
            color: #0f172a;
            letter-spacing: 0.5px;
            margin: 0;
            text-transform: uppercase;
          }
          .doc-subtitle {
            font-size: 8pt;
            color: #64748b;
            margin: 2px 0 0;
          }
          .student-info-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px 16px;
            background: #ffffff;
            border: 1px solid #cbd5e1;
            border-radius: 8px;
            padding: 10px 14px;
            margin-bottom: 12px;
          }
          .info-row {
            display: flex;
            font-size: 8.5pt;
            margin-bottom: 3px;
          }
          .info-label {
            width: 120px;
            color: #64748b;
            font-weight: 600;
          }
          .info-value {
            flex: 1;
            color: #0f172a;
            font-weight: 700;
          }
          .metrics-summary {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 8px;
            margin-bottom: 14px;
          }
          .metric-card {
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            padding: 7px 10px;
            text-align: center;
            background: #f8fafc;
          }
          .metric-val {
            font-size: 13pt;
            font-weight: 800;
            color: #1e3a5f;
            line-height: 1.2;
          }
          .metric-lbl {
            font-size: 7pt;
            color: #64748b;
            font-weight: 700;
            text-transform: uppercase;
            margin-top: 2px;
          }
          .data-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 16px;
            font-size: 8.5pt;
          }
          .data-table th {
            background: #1e3a5f;
            color: #ffffff;
            padding: 6px 8px;
            text-align: left;
            font-weight: 700;
            border: 1px solid #1e3a5f;
            font-size: 8pt;
            text-transform: uppercase;
          }
          .data-table td {
            padding: 5px 8px;
            border: 1px solid #cbd5e1;
            vertical-align: middle;
          }
          .data-table tr:nth-child(even) td {
            background: #f8fafc;
          }
          .tag-selesai {
            background: #dcfce7;
            color: #15803d;
            padding: 1px 5px;
            border-radius: 4px;
            font-size: 7.5pt;
            font-weight: 700;
            display: inline-block;
          }
          .tag-proses {
            background: #fef3c7;
            color: #b45309;
            padding: 1px 5px;
            border-radius: 4px;
            font-size: 7.5pt;
            font-weight: 700;
            display: inline-block;
          }
          .signature-section {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-top: 20px;
            page-break-inside: avoid;
          }
          .sig-col {
            text-align: center;
            font-size: 8.5pt;
          }
          .sig-space {
            height: 48px;
          }
          .sig-name {
            font-weight: 800;
            text-decoration: underline;
            color: #0f172a;
          }
          .sig-meta {
            font-size: 7.5pt;
            color: #64748b;
            margin-top: 2px;
          }
          .doc-footer {
            border-top: 1px dashed #cbd5e1;
            padding-top: 6px;
            margin-top: 18px;
            font-size: 7pt;
            color: #94a3b8;
            display: flex;
            justify-content: space-between;
            page-break-inside: avoid;
          }
          @media screen {
            body {
              background: #334155;
              padding: 20px;
            }
            .report-sheet {
              background: #ffffff;
              padding: 14mm 16mm;
              box-shadow: 0 10px 25px rgba(0,0,0,0.3);
              border-radius: 6px;
            }
          }
        </style>
      </head>
      <body>
        <div class="report-sheet">
          <!-- Kop Surat Resmi -->
          <div class="inst-header">
            <div class="inst-logo-box">
              <div class="inst-crest">🎓</div>
              <div>
                <h1 class="inst-title">CourseHub Learning System</h1>
                <div class="inst-subtitle">Pusat Manajemen Pembelajaran Digital &amp; Pelatihan Terstruktur</div>
              </div>
            </div>
            <div class="doc-meta">
              <div><strong>No. Dokumen:</strong> ${docId}</div>
              <div><strong>Tanggal Terbit:</strong> ${todayStr}</div>
              <div><strong>Halaman:</strong> 1 dari 1 (Format A4)</div>
            </div>
          </div>

          <!-- Judul Dokumen -->
          <div class="doc-title-container">
            <h2 class="doc-title">Laporan Capaian &amp; Kemajuan Belajar Peserta Didik</h2>
            <div class="doc-subtitle">Transkrip Resmi Hasil Pembelajaran &amp; Evaluasi Kompetensi Kursus</div>
          </div>

          <!-- Informasi Peserta & Kursus -->
          <div class="student-info-grid">
            <div>
              <div class="info-row">
                <span class="info-label">Nama Peserta Didik:</span>
                <span class="info-value">${escHtml(student.name)}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Email / ID Akun:</span>
                <span class="info-value">${escHtml(student.email || '-')}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Rombel / Kelas:</span>
                <span class="info-value">${escHtml(student.class || student.class_name || 'Reguler')}</span>
              </div>
            </div>
            <div>
              <div class="info-row">
                <span class="info-label">Judul Kursus:</span>
                <span class="info-value">${escHtml(course.title)}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Tutor Pengampu:</span>
                <span class="info-value">${escHtml(tutor.name)}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Status Akademik:</span>
                <span class="info-value" style="color:${isGraduated ? '#15803d' : '#b45309'};">${isGraduated ? 'LULUS (MEMENUHI KOMPETENSI)' : 'SEDANG BERJALAN'}</span>
              </div>
            </div>
          </div>

          <!-- Matriks Ringkasan Capaian (KPI) -->
          <div class="metrics-summary">
            <div class="metric-card">
              <div class="metric-val">${totalUnits}</div>
              <div class="metric-lbl">Total Unit Pembelajaran</div>
            </div>
            <div class="metric-card">
              <div class="metric-val" style="color:#0f766e;">${completedCount}</div>
              <div class="metric-lbl">Unit Diselesaikan</div>
            </div>
            <div class="metric-card">
              <div class="metric-val" style="color:#2563eb;">${progressPct}%</div>
              <div class="metric-lbl">Persentase Progres</div>
            </div>
            <div class="metric-card">
              <div class="metric-val" style="color:#7c3aed;">${avgScore}</div>
              <div class="metric-lbl">Rata-Rata Nilai Evaluasi</div>
            </div>
          </div>

          <!-- Tabel Rincian Capaian Materi Pembelajaran -->
          <table class="data-table">
            <thead>
              <tr>
                <th style="width:30px;text-align:center;">No</th>
                <th style="width:130px;">Bab / Lingkup</th>
                <th>Judul Unit Pembelajaran</th>
                <th style="width:90px;text-align:center;">Tipe</th>
                <th style="width:90px;text-align:center;">Nilai / Skor</th>
                <th style="width:85px;text-align:center;">Status</th>
              </tr>
            </thead>
            <tbody>
              ${unitRows || '<tr><td colspan="6" style="text-align:center;">Belum ada data unit pembelajaran.</td></tr>'}
            </tbody>
          </table>

          <!-- Area Pengesahan & Tanda Tangan -->
          <div class="signature-section">
            <div class="sig-col">
              <div>Mengetahui &amp; Menyetujui,</div>
              <div style="font-weight:700;margin-top:2px;">Peserta Didik</div>
              <div class="sig-space"></div>
              <div class="sig-name">${escHtml(student.name)}</div>
              <div class="sig-meta">ID Siswa: ${escHtml(student.id || 'STD-CH')}</div>
            </div>
            <div class="sig-col">
              <div>Diverifikasi Resmi oleh:</div>
              <div style="font-weight:700;margin-top:2px;">Tutor Pengampu Pelatihan</div>
              <div class="sig-space"></div>
              <div class="sig-name">${escHtml(tutor.name)}</div>
              <div class="sig-meta">NIP / ID Pendidik: ${escHtml(tutor.id || 'ED-CH')}</div>
            </div>
          </div>

          <!-- Footer Resmi Dokumen -->
          <div class="doc-footer">
            <span>CourseHub LMS • Dokumen ini diterbitkan secara sah dan tersimpan pada sistem basis data Supabase PostgreSQL.</span>
            <span>Verifikasi Keaslian: VALID / A4 CERTIFIED</span>
          </div>
        </div>
      </body>
      </html>
    `;

    printReportHTML(htmlDoc, `Laporan_${student.name.replace(/\s+/g, '_')}`);
  }
  window.exportPDF = exportPDF;

  async function exportBatchPDF() {
    const students = AppState.students || [];
    const courses = AppState.courses || [];
    const todayStr = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    const docId = `CH/BATCH/${new Date().getFullYear()}/${Math.floor(1000 + Math.random() * 9000)}`;

    const sb = typeof getSupabase === 'function' ? getSupabase() : null;
    let allProg = [];
    if (sb && !AppState.isDemoMode) {
      try {
        const { data, error } = await sb.from('progress').select('*');
        if (!error && Array.isArray(data)) allProg = data;
      } catch (e) {
        console.warn('Gagal ambil data batch progress:', e);
      }
    }
    if (allProg.length === 0 && AppState.allProgressRecords) {
      allProg = AppState.allProgressRecords;
    }

    const totalUnitsInstitution = courses.reduce((acc, c) => acc + (c.contents?.length || 0), 0) || 1;

    const rows = students.map((s, idx) => {
      const myProg = allProg.filter(p => p.student_id === s.id);
      const completedUnits = myProg.filter(p => p.status === 'Selesai' || p.is_passed !== false).length;
      const pct = Math.min(100, Math.round((completedUnits / totalUnitsInstitution) * 100));

      const scoredItems = myProg.filter(p => typeof p.score === 'number' && p.score !== null);
      const avg = scoredItems.length > 0
        ? Math.round(scoredItems.reduce((acc, p) => acc + p.score, 0) / scoredItems.length)
        : (pct >= 100 ? 90 : (pct > 0 ? 80 : '-'));

      const statusBadge = pct >= 100 
        ? '<span class="tag-selesai">✅ LULUS</span>' 
        : (pct > 0 ? '<span class="tag-proses">⏳ PROSES</span>' : '<span style="color:#94a3b8;font-size:7.5pt;padding:2px 6px;border-radius:4px;background:#f8fafc;font-weight:700;">BELUM MULAI</span>');

      return `
        <tr>
          <td style="text-align:center;font-weight:600;">${idx + 1}</td>
          <td style="font-weight:700;color:#1e3a5f;">${escHtml(s.name)}</td>
          <td>${escHtml(s.email)}</td>
          <td style="text-align:center;">${escHtml(s.class || 'Kelas X')}</td>
          <td style="text-align:center;font-weight:700;">${pct}%</td>
          <td style="text-align:center;font-weight:700;color:#0f766e;">${avg}</td>
          <td style="text-align:center;">${statusBadge}</td>
        </tr>
      `;
    }).join('');

    const htmlDoc = `
      <!DOCTYPE html>
      <html lang="id">
      <head>
        <meta charset="UTF-8">
        <title>Rekapitulasi Capaian Kelas - CourseHub LMS</title>
        <style>
          @page {
            size: A4 portrait;
            margin: 12mm 15mm 15mm 15mm;
          }
          * { box-sizing: border-box; }
          body {
            font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Arial, sans-serif;
            color: #1e293b;
            background: #ffffff;
            margin: 0;
            padding: 0;
            font-size: 9.5pt;
            line-height: 1.45;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .report-sheet {
            width: 100%;
            max-width: 210mm;
            margin: 0 auto;
          }
          .inst-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 2.5px solid #1e3a5f;
            padding-bottom: 10px;
            margin-bottom: 14px;
          }
          .inst-logo-box {
            display: flex;
            align-items: center;
            gap: 12px;
          }
          .inst-crest {
            width: 44px;
            height: 44px;
            background: linear-gradient(135deg, #1e3a5f 0%, #14b8a6 100%);
            color: #ffffff;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 22px;
            font-weight: 800;
          }
          .inst-title {
            font-size: 14pt;
            font-weight: 800;
            color: #1e3a5f;
            margin: 0;
            letter-spacing: -0.3px;
          }
          .inst-subtitle {
            font-size: 8pt;
            color: #64748b;
            margin: 2px 0 0;
            font-weight: 500;
          }
          .doc-meta {
            text-align: right;
            font-size: 8pt;
            color: #475569;
            line-height: 1.4;
          }
          .doc-title-container {
            text-align: center;
            margin-bottom: 14px;
            padding: 7px 0;
            background: #f8fafc;
            border-radius: 6px;
            border: 1px solid #e2e8f0;
          }
          .doc-title {
            font-size: 12pt;
            font-weight: 800;
            color: #0f172a;
            letter-spacing: 0.5px;
            margin: 0;
            text-transform: uppercase;
          }
          .doc-subtitle {
            font-size: 8pt;
            color: #64748b;
            margin: 2px 0 0;
          }
          .data-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 16px;
            font-size: 8.5pt;
          }
          .data-table th {
            background: #1e3a5f;
            color: #ffffff;
            padding: 7px 8px;
            text-align: left;
            font-weight: 700;
            border: 1px solid #1e3a5f;
            font-size: 8pt;
            text-transform: uppercase;
          }
          .data-table td {
            padding: 6px 8px;
            border: 1px solid #cbd5e1;
            vertical-align: middle;
          }
          .data-table tr:nth-child(even) td {
            background: #f8fafc;
          }
          .tag-selesai {
            background: #dcfce7;
            color: #15803d;
            padding: 1px 5px;
            border-radius: 4px;
            font-size: 7.5pt;
            font-weight: 700;
            display: inline-block;
          }
          .tag-proses {
            background: #fef3c7;
            color: #b45309;
            padding: 1px 5px;
            border-radius: 4px;
            font-size: 7.5pt;
            font-weight: 700;
            display: inline-block;
          }
          .signature-section {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-top: 24px;
            page-break-inside: avoid;
          }
          .sig-col {
            text-align: center;
            font-size: 8.5pt;
          }
          .sig-space {
            height: 48px;
          }
          .sig-name {
            font-weight: 800;
            text-decoration: underline;
            color: #0f172a;
          }
          .sig-meta {
            font-size: 7.5pt;
            color: #64748b;
            margin-top: 2px;
          }
          .doc-footer {
            border-top: 1px dashed #cbd5e1;
            padding-top: 6px;
            margin-top: 18px;
            font-size: 7pt;
            color: #94a3b8;
            display: flex;
            justify-content: space-between;
            page-break-inside: avoid;
          }
          @media screen {
            body {
              background: #334155;
              padding: 20px;
            }
            .report-sheet {
              background: #ffffff;
              padding: 14mm 16mm;
              box-shadow: 0 10px 25px rgba(0,0,0,0.3);
              border-radius: 6px;
            }
          }
        </style>
      </head>
      <body>
        <div class="report-sheet">
          <div class="inst-header">
            <div class="inst-logo-box">
              <div class="inst-crest">🎓</div>
              <div>
                <h1 class="inst-title">CourseHub Learning System</h1>
                <div class="inst-subtitle">Pusat Rekapitulasi Pembelajaran &amp; Evaluasi Terpusat</div>
              </div>
            </div>
            <div class="doc-meta">
              <div><strong>No. Dokumen:</strong> ${docId}</div>
              <div><strong>Tanggal Terbit:</strong> ${todayStr}</div>
              <div><strong>Format:</strong> Standar A4 Cetak Resmi</div>
            </div>
          </div>

          <div class="doc-title-container">
            <h2 class="doc-title">Rekapitulasi Capaian &amp; Kelulusan Kelas</h2>
            <div class="doc-subtitle">Daftar Hasil Belajar Seluruh Peserta Didik Terdaftar</div>
          </div>

          <table class="data-table">
            <thead>
              <tr>
                <th style="width:30px;text-align:center;">No</th>
                <th>Nama Peserta Didik</th>
                <th>Alamat Email</th>
                <th style="width:90px;text-align:center;">Kelas</th>
                <th style="width:85px;text-align:center;">Progress</th>
                <th style="width:80px;text-align:center;">Rata Nilai</th>
                <th style="width:85px;text-align:center;">Status</th>
              </tr>
            </thead>
            <tbody>
              ${rows || '<tr><td colspan="7" style="text-align:center;">Belum ada data peserta didik terdaftar.</td></tr>'}
            </tbody>
          </table>

          <div class="signature-section">
            <div class="sig-col">
              <div>Mengetahui,</div>
              <div style="font-weight:700;margin-top:2px;">Koordinator Kurikulum &amp; Pembelajaran</div>
              <div class="sig-space"></div>
              <div class="sig-name">Administrator Akademik</div>
              <div class="sig-meta">CourseHub Learning System</div>
            </div>
            <div class="sig-col">
              <div>Ditetapkan di Jakarta, ${todayStr}</div>
              <div style="font-weight:700;margin-top:2px;">Pimpinan / Kepala Lembaga Pendidikan</div>
              <div class="sig-space"></div>
              <div class="sig-name">Dr. H. Ahmad Syarif, M.Pd.</div>
              <div class="sig-meta">NIP. 19850412 201001 1 008</div>
            </div>
          </div>

          <div class="doc-footer">
            <span>CourseHub LMS • Rekapitulasi resmi yang disinkronkan secara otomatis dari basis data server.</span>
            <span>HALAMAN RESMI FORMAT A4</span>
          </div>
        </div>
      </body>
      </html>
    `;

    printReportHTML(htmlDoc, 'Rekapitulasi_Kelas_CourseHub');
  }
  window.exportBatchPDF = exportBatchPDF;
