/**
 * CourseHub - Course & Content Services (CourseService.js)
 * Menangani operasi CRUD Course, manajemen unit materi, video embed, dan kuis.
 */

/**
 * Mengambil daftar course yang dapat diakses oleh user aktif
 */
function getCoursesList() {
  const currentUser = getCurrentUserProfile();
  const allCourses = getSheetDataAsObjects(DB_CONFIG.SHEETS.COURSES);
  const allContents = getSheetDataAsObjects(DB_CONFIG.SHEETS.COURSE_CONTENTS);
  const enrollments = getSheetDataAsObjects(DB_CONFIG.SHEETS.ENROLLMENT);
  const progressList = getSheetDataAsObjects(DB_CONFIG.SHEETS.PROGRESS);

  let visibleCourses = [];

  if (currentUser.role === 'admin') {
    // Admin melihat seluruh course
    visibleCourses = allCourses;
  } else if (currentUser.role === 'educator') {
    // Pendidik melihat course yang dibuatnya
    visibleCourses = allCourses.filter(c => c.authorId === currentUser.userId || c.authorName === currentUser.name);
  } else {
    // Peserta didik melihat course yang di-enroll
    const myEnrollments = enrollments.filter(e => e.studentId === currentUser.userId);
    const enrolledCourseIds = myEnrollments.map(e => e.courseId);
    visibleCourses = allCourses.filter(c => enrolledCourseIds.includes(c.courseId) || c.status === 'Aktif');
  }

  return visibleCourses.map(course => {
    const courseContents = allContents
      .filter(cnt => cnt.courseId === course.courseId)
      .sort((a, b) => (Number(a.orderIndex) || 0) - (Number(b.orderIndex) || 0));

    const completedUnits = courseContents.filter(cnt => {
      return progressList.some(p => p.contentId === cnt.contentId && p.studentId === currentUser.userId && p.status === 'Selesai');
    }).length;

    const enrolledStudentsCount = enrollments.filter(e => e.courseId === course.courseId).length;

    return {
      ...course,
      totalUnits: courseContents.length,
      completedUnits: completedUnits,
      enrolledStudents: enrolledStudentsCount || 30, // Fallback default rombel
      contents: courseContents
    };
  });
}

/**
 * Mengambil detail course beserta seluruh unit materi di dalamnya
 */
function getCourseDetail(courseId) {
  const currentUser = getCurrentUserProfile();
  const allCourses = getSheetDataAsObjects(DB_CONFIG.SHEETS.COURSES);
  const allContents = getSheetDataAsObjects(DB_CONFIG.SHEETS.COURSE_CONTENTS);
  const progressList = getSheetDataAsObjects(DB_CONFIG.SHEETS.PROGRESS);

  const course = allCourses.find(c => c.courseId === courseId);
  if (!course) throw new Error('Course tidak ditemukan');

  const contents = allContents
    .filter(cnt => cnt.courseId === courseId)
    .sort((a, b) => (Number(a.orderIndex) || 0) - (Number(b.orderIndex) || 0))
    .map(cnt => {
      const isCompleted = progressList.some(
        p => p.contentId === cnt.contentId && p.studentId === currentUser.userId && p.status === 'Selesai'
      );
      return {
        ...cnt,
        completed: isCompleted
      };
    });

  return {
    ...course,
    contents: contents
  };
}

/**
 * [Admin/Pendidik] Membuat Course baru
 */
function createCourse(courseData) {
  const currentUser = getCurrentUserProfile();
  if (currentUser.role !== 'admin' && currentUser.role !== 'educator') {
    throw new Error('Akses ditolak: Hanya Admin atau Pendidik yang dapat membuat course.');
  }

  const newCourseId = 'CRS-' + new Date().getTime();
  const gradients = [
    'linear-gradient(135deg, #1e3a5f 0%, #14b8a6 100%)',
    'linear-gradient(135deg, #0f766e 0%, #2a3a4f 100%)',
    'linear-gradient(135deg, #1e3a5f 0%, #3b82f6 100%)',
    'linear-gradient(135deg, #022448 0%, #006b5f 100%)'
  ];
  const randomGradient = gradients[Math.floor(Math.random() * gradients.length)];

  const newCourse = {
    courseId: newCourseId,
    title: courseData.title,
    description: courseData.description,
    authorId: currentUser.userId,
    authorName: courseData.authorName || currentUser.name,
    status: 'Aktif',
    createdAt: new Date().toISOString().split('T')[0],
    coverGradient: randomGradient
  };

  insertRow(DB_CONFIG.SHEETS.COURSES, newCourse);
  return { success: true, message: 'Course baru berhasil dibuat!', data: newCourse };
}

/**
 * [Admin/Pendidik] Menambah Unit Konten (Materi, Video, Kaidah, Latihan, Kuis)
 */
function addCourseContent(contentData) {
  const currentUser = getCurrentUserProfile();
  if (currentUser.role !== 'admin' && currentUser.role !== 'educator') {
    throw new Error('Akses ditolak: Tidak memiliki hak untuk menambah materi.');
  }

  const newContentId = 'CNT-' + new Date().getTime();
  const existingContents = getSheetDataAsObjects(DB_CONFIG.SHEETS.COURSE_CONTENTS).filter(c => c.courseId === contentData.courseId);

  const newContent = {
    contentId: newContentId,
    courseId: contentData.courseId,
    title: contentData.title,
    type: contentData.type || 'Materi',
    duration: contentData.duration || '15 Menit',
    orderIndex: existingContents.length + 1,
    embedUrl: contentData.embedUrl || '',
    driveFileId: contentData.driveFileId || '',
    contentBody: contentData.contentBody || '',
    createdAt: new Date().toISOString()
  };

  insertRow(DB_CONFIG.SHEETS.COURSE_CONTENTS, newContent);
  return { success: true, message: 'Unit materi berhasil ditambahkan!', data: newContent };
}

/**
 * [Admin/Pendidik] Menghapus Course
 */
function deleteCourse(courseId) {
  const currentUser = getCurrentUserProfile();
  if (currentUser.role !== 'admin' && currentUser.role !== 'educator') {
    throw new Error('Akses ditolak: Tidak memiliki hak untuk menghapus course.');
  }

  deleteRowByField(DB_CONFIG.SHEETS.COURSES, 'courseId', courseId);
  return { success: true, message: 'Course berhasil dihapus!' };
}
