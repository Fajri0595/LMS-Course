const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const edgePaths = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
];

let browserPath = edgePaths.find(p => fs.existsSync(p));
if (!browserPath) {
  console.error('No suitable browser found for PDF export.');
  process.exit(1);
}

const htmlPath = path.resolve('panduan_tutor_cetak.html');
const pdfPath = path.resolve('PANDUAN_PENULISAN_KONTEN_TUTOR.pdf');
const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/');

const args = [
  `"${browserPath}"`,
  '--headless',
  '--disable-gpu',
  '--no-pdf-header-footer',
  `--print-to-pdf="${pdfPath}"`,
  `"${fileUrl}"`
];

console.log('Generating PDF from:', fileUrl);
try {
  execSync(args.join(' '), { stdio: 'inherit' });
  if (fs.existsSync(pdfPath)) {
    const stats = fs.statSync(pdfPath);
    console.log(`SUCCESS: PDF generated successfully (${stats.size} bytes) at: ${pdfPath}`);
  } else {
    console.error('PDF file not found after conversion.');
  }
} catch (err) {
  console.error('Error generating PDF:', err.message);
}
