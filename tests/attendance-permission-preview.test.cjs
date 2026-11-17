const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('permission requests open the larger PDF preview', () => {
  const script = fs.readFileSync('dist/admin.js', 'utf8');
  const styles = fs.readFileSync('dist/admin.css', 'utf8');
  assert.match(script, /data-permission-preview=.*Lihat PDF/);
  assert.match(script, /attendance-permission-preview'\)\.showModal\(\)/);
  assert.doesNotMatch(script, /anchor\.download='surat-izin\.pdf'/);
  assert.match(styles, /#attendance-permission-preview\{width:min\(96vw,1200px\)/);
});
