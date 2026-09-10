/**
 * CourseHub - Database & Spreadsheet Helper (Database.js)
 * Menangani koneksi, inisialisasi tabel, dan operasi CRUD ke Google Sheets.
 */

const DB_CONFIG = {
  // Biarkan kosong jika terikat dengan container spreadsheet (Bound Script),
  // atau isi ID Spreadsheet jika standalone script:
  SPREADSHEET_ID: '', 
  
  SHEETS: {
    USERS: 'Users',
    COURSES: 'Courses',
    COURSE_CONTENTS: 'CourseContents',
    ENROLLMENT: 'Enrollment',
    PROGRESS: 'Progress'
  },
  
  HEADERS: {
    Users: ['userId', 'name', 'email', 'role', 'teacherId', 'subject', 'status', 'createdAt'],
    Courses: ['courseId', 'title', 'description', 'authorId', 'authorName', 'status', 'createdAt', 'coverGradient'],
    CourseContents: ['contentId', 'courseId', 'title', 'type', 'duration', 'orderIndex', 'embedUrl', 'driveFileId', 'contentBody', 'createdAt'],
    Enrollment: ['enrollmentId', 'courseId', 'studentId', 'studentName', 'className', 'enrolledAt'],
    Progress: ['progressId', 'enrollmentId', 'courseId', 'studentId', 'contentId', 'status', 'score', 'completedAt']
  }
};

/**
 * Mendapatkan referensi Spreadsheet aktif
 */
function getSpreadsheet() {
  if (DB_CONFIG.SPREADSHEET_ID && DB_CONFIG.SPREADSHEET_ID.trim() !== '') {
    return SpreadsheetApp.openById(DB_CONFIG.SPREADSHEET_ID);
  }
  try {
    return SpreadsheetApp.getActiveSpreadsheet();
  } catch (e) {
    throw new Error('Spreadsheet belum terhubung. Silakan atur SPREADSHEET_ID pada DB_CONFIG di Database.js');
  }
}

/**
 * Inisialisasi awal seluruh tabel (sheet) beserta header jika belum ada
 */
function initDatabase() {
  const ss = getSpreadsheet();
  const existingSheets = ss.getSheets().map(s => s.getName());

  Object.keys(DB_CONFIG.HEADERS).forEach(sheetName => {
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.appendRow(DB_CONFIG.HEADERS[sheetName]);
      // Format header
      const headerRange = sheet.getRange(1, 1, 1, DB_CONFIG.HEADERS[sheetName].length);
      headerRange.setBackground('#1E3A5F')
                 .setFontColor('#FFFFFF')
                 .setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
  });

  // Seed sample admin user jika sheet Users kosong
  const usersSheet = ss.getSheetByName(DB_CONFIG.SHEETS.USERS);
  if (usersSheet.getLastRow() <= 1) {
    const activeEmail = Session.getActiveUser().getEmail() || 'admin@institusi.sch.id';
    usersSheet.appendRow([
      'USR-ADMIN-01',
      'Administrator Institusi',
      activeEmail,
      'admin',
      '',
      'Super Admin',
      'Aktif',
      new Date().toISOString()
    ]);
  }

  return { success: true, message: 'Database LMS berhasil diinisialisasi!' };
}

/**
 * Helper: Membaca seluruh data dari sheet sebagai array of objects
 */
function getSheetDataAsObjects(sheetName) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];

  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];

  const headers = values[0];
  const rows = values.slice(1);

  return rows.map((row, rowIndex) => {
    const obj = { _rowNumber: rowIndex + 2 };
    headers.forEach((header, colIndex) => {
      obj[header] = row[colIndex];
    });
    return obj;
  });
}

/**
 * Helper: Menambahkan baris baru ke sheet
 */
function insertRow(sheetName, dataObj) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error(`Sheet ${sheetName} tidak ditemukan`);

  const headers = DB_CONFIG.HEADERS[sheetName];
  const rowData = headers.map(header => dataObj[header] !== undefined ? dataObj[header] : '');
  sheet.appendRow(rowData);
  return { success: true, rowData: dataObj };
}

/**
 * Helper: Mengupdate baris berdasarkan primary key
 */
function updateRowByField(sheetName, matchField, matchValue, updateDataObj) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error(`Sheet ${sheetName} tidak ditemukan`);

  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return { success: false, message: 'Sheet kosong' };

  const headers = values[0];
  const keyIndex = headers.indexOf(matchField);
  if (keyIndex === -1) throw new Error(`Field ${matchField} tidak ditemukan`);

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][keyIndex]) === String(matchValue)) {
      headers.forEach((header, hIdx) => {
        if (updateDataObj[header] !== undefined) {
          sheet.getRange(i + 1, hIdx + 1).setValue(updateDataObj[header]);
        }
      });
      return { success: true, updatedRow: i + 1 };
    }
  }

  return { success: false, message: 'Data tidak ditemukan' };
}

/**
 * Helper: Menghapus baris berdasarkan primary key
 */
function deleteRowByField(sheetName, matchField, matchValue) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error(`Sheet ${sheetName} tidak ditemukan`);

  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return { success: false, message: 'Sheet kosong' };

  const headers = values[0];
  const keyIndex = headers.indexOf(matchField);
  if (keyIndex === -1) throw new Error(`Field ${matchField} tidak ditemukan`);

  for (let i = values.length - 1; i >= 1; i--) {
    if (String(values[i][keyIndex]) === String(matchValue)) {
      sheet.deleteRow(i + 1);
      return { success: true, deletedRow: i + 1 };
    }
  }

  return { success: false, message: 'Data tidak ditemukan' };
}
