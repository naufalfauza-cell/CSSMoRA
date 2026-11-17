const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('dist/admin.html','utf8');
const js=fs.readFileSync('dist/admin.js','utf8');
test('member without NIA can be shown, searched and updated later',()=>{
 assert.match(html,/<input id="member-nia" maxlength="40" placeholder="Belum ada NIA">/);
 assert.match(js,/nia:\$\('#member-nia'\)\.value\.trim\(\)\|\|null/);
 assert.match(js,/readOnly=Boolean\(member\.nia\)/);
 assert.match(js,/String\(row\.member\.nia\|\|''\)\.toLocaleLowerCase/);
});
