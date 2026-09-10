/**
 * CourseHub - Auth & User Services (UserService.js)
 * Menangani verifikasi sesi pengguna, pengecekan RBAC, dan manajemen akun guru & siswa.
 */

/**
 * Mendapatkan profil dan hak akses pengguna yang sedang aktif
 */
function getCurrentUserProfile() {
  const activeEmail = Session.getActiveUser().getEmail();
  
  if (!activeEmail || activeEmail.trim() === '') {
    // Fallback mode jika dijalankan tanpa login Google Workspace
    return {
      userId: 'USR-GUEST',
      name: 'Pengguna Tamu',
      email: 'guest@institusi.sch.id',
      role: 'educator'
    };
  }

  const users = getSheetDataAsObjects(DB_CONFIG.SHEETS.USERS);
  const user = users.find(u => u.email.toLowerCase() === activeEmail.toLowerCase());

  if (user) {
    return user;
  }

  // Jika belum terdaftar, defaultkan sebagai Peserta Didik atau sesuaikan institusi
  return {
    userId: 'USR-' + new Date().getTime(),
    name: activeEmail.split('@')[0],
    email: activeEmail,
    role: 'student',
    status: 'Aktif'
  };
}

/**
 * [Admin/Pendidik] Mengambil seluruh daftar Pendidik
 */
function getEducatorsList() {
  const currentUser = getCurrentUserProfile();
  if (currentUser.role !== 'admin' && currentUser.role !== 'educator') {
    throw new Error('Akses ditolak: Hanya Admin/Pendidik yang dapat melihat daftar guru.');
  }

  const users = getSheetDataAsObjects(DB_CONFIG.SHEETS.USERS);
  const courses = getSheetDataAsObjects(DB_CONFIG.SHEETS.COURSES);

  return users
    .filter(u => u.role === 'educator' || u.role === 'admin')
    .map(u => {
      const totalCourses = courses.filter(c => c.authorId === u.userId || c.authorName === u.name).length;
      return {
        ...u,
        totalCourses: totalCourses
      };
    });
}

/**
 * [Admin] Menambahkan akun Pendidik baru
 */
function addEducator(educatorData) {
  const currentUser = getCurrentUserProfile();
  if (currentUser.role !== 'admin') {
    throw new Error('Akses ditolak: Hanya Admin yang dapat menambahkan Pendidik baru.');
  }

  const newId = 'EDU-' + new Date().getTime();
  const newEducator = {
    userId: newId,
    name: educatorData.name,
    email: educatorData.email,
    role: 'educator',
    teacherId: '',
    subject: educatorData.subject || 'Umum',
    status: 'Aktif',
    createdAt: new Date().toISOString()
  };

  insertRow(DB_CONFIG.SHEETS.USERS, newEducator);
  return { success: true, message: 'Pendidik berhasil ditambahkan!', data: newEducator };
}

/**
 * [Pendidik/Admin] Mengambil daftar peserta didik (siswa)
 */
function getStudentsList(teacherFilterId = null) {
  const currentUser = getCurrentUserProfile();
  const users = getSheetDataAsObjects(DB_CONFIG.SHEETS.USERS);
  const progressList = getSheetDataAsObjects(DB_CONFIG.SHEETS.PROGRESS);
  const contents = getSheetDataAsObjects(DB_CONFIG.SHEETS.COURSE_CONTENTS);

  let students = users.filter(u => u.role === 'student');

  if (teacherFilterId && currentUser.role !== 'admin') {
    students = students.filter(s => s.teacherId === teacherFilterId);
  }

  return students.map(s => {
    // Hitung persentase progres siswa
    const completedProgress = progressList.filter(p => p.studentId === s.userId && p.status === 'Selesai').length;
    const totalContents = contents.length || 1;
    const progressPercent = Math.min(100, Math.round((completedProgress / totalContents) * 100));

    return {
      ...s,
      progress: progressPercent,
      completedCourses: completedProgress > 0 ? 1 : 0
    };
  });
}

/**
 * [Pendidik/Admin] Mendaftarkan Peserta Didik baru
 */
function addStudent(studentData) {
  const currentUser = getCurrentUserProfile();
  const newId = 'STD-' + new Date().getTime();

  const newStudent = {
    userId: newId,
    name: studentData.name,
    email: studentData.email,
    role: 'student',
    teacherId: currentUser.userId,
    subject: studentData.className || 'Kelas XII',
    status: 'Aktif',
    createdAt: new Date().toISOString()
  };

  insertRow(DB_CONFIG.SHEETS.USERS, newStudent);
  return { success: true, message: 'Peserta didik berhasil didaftarkan!', data: newStudent };
}
