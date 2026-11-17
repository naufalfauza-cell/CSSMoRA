const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
test('attendance photo and PDF previews use a viewport-fixed dialog',()=>{
 const html=fs.readFileSync('dist/admin.html','utf8');const css=fs.readFileSync('dist/admin.css','utf8');
 assert.match(html,/<dialog class="attendance-proof-dialog" id="attendance-proof-dialog"/);
 assert.match(html,/<dialog class="attendance-proof-dialog" id="attendance-permission-preview"/);
 assert.match(css,/\.attendance-proof-dialog\{position:fixed;/);
});
