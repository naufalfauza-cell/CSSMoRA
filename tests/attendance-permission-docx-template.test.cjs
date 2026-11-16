const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

test('permission template is the supplied CSSMoRA DOCX and not the old RTF', () => {
  const html = fs.readFileSync(path.join(__dirname, '../dist/absen.html'), 'utf8');
  const documentName = 'template-surat-izin-cssmora-unair.docx';
  const source = fs.readFileSync(path.join(__dirname, '../dist', documentName));
  assert.ok(html.includes('href="./' + documentName + '"'));
  assert.ok(html.includes('download="Template Surat Izin CSSMoRA UNAIR.docx"'));
  assert.ok(!html.includes('href="./template-surat-izin.rtf"'));
  assert.equal(crypto.createHash('sha256').update(source).digest('hex'),
    'ead4fa70ef55de5705c737b9b70709711c3b7aa3c2ec3719ee98b7a0b7de7b18');
  assert.equal(source.subarray(0, 4).toString('hex'), '504b0304'); // OOXML ZIP
  assert.ok(source.includes(Buffer.from('word/document.xml')));
  assert.ok(source.includes(Buffer.from('word/media/image1.png')));
});
