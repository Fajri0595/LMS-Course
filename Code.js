/**
 * CourseHub - Google Apps Script Master Entry Point (Code.js)
 * Menangani routing Web App doGet(e), template inclusion, dan bridge API client-server.
 */

function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('CourseHub - Platform Manajemen Pembelajaran & Media Interaktif')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Helper untuk menyisipkan file HTML modular ke dalam Index.html
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Menu otomatis saat Spreadsheet dibuka oleh Admin
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🚀 CourseHub LMS')
    .addItem('⚙️ Inisialisasi / Perbaiki Tabel Database', 'initDatabase')
    .addItem('📊 Buka Laporan Capaian PDF', 'openReportMenu')
    .addToUi();
}

function openReportMenu() {
  SpreadsheetApp.getUi().alert('Fitur ekspor PDF siap digunakan dari Web App CourseHub!');
}

/**
 * -------------------------------------------------------------
 * API DISPATCHER (Dipanggil oleh google.script.run dari Frontend)
 * -------------------------------------------------------------
 */

// Inisialisasi State Awal ke Frontend
function apiGetInitialData() {
  return {
    currentUser: getCurrentUserProfile(),
    courses: getCoursesList(),
    students: getStudentsList(),
    educators: getEducatorsList()
  };
}

// User & Role API
function apiGetCurrentUser() {
  return getCurrentUserProfile();
}

function apiGetEducators() {
  return getEducatorsList();
}

function apiAddEducator(data) {
  return addEducator(data);
}

function apiGetStudents() {
  return getStudentsList();
}

function apiAddStudent(data) {
  return addStudent(data);
}

// Course & Content API
function apiGetCourses() {
  return getCoursesList();
}

function apiGetCourseDetail(courseId) {
  return getCourseDetail(courseId);
}

function apiCreateCourse(data) {
  return createCourse(data);
}

function apiAddCourseContent(data) {
  return addCourseContent(data);
}

function apiDeleteCourse(courseId) {
  return deleteCourse(courseId);
}

// Progress & PDF API
function apiRecordProgress(courseId, contentId, score) {
  return recordUnitProgress(courseId, contentId, score);
}

function apiGetProgressReport() {
  return getProgressReportData();
}

function apiExportStudentPdf(studentName, courseTitle) {
  return generateStudentReportPdf(studentName, courseTitle);
}
