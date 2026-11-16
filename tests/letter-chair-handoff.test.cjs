const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const js = read('dist/letter-signatures.js');
const html = read('dist/admin.html');
const sql = read('supabase/migrations/20261113160000_letter_signature_chair_handoff.sql');

test('Secretary opens signing directly and can still request another signer', async () => {
  const events = new Map();
  const calls = [];
  const file = new Blob(['%PDF-test'], {type:'application/pdf'});
  const elements = new Map();
  const element = key => {
    if (!elements.has(key)) elements.set(key, {
      addEventListener: (type, handler) => events.set(key + ':' + type, handler),
      getContext: () => ({}), append() {}, replaceChildren() {}
    });
    return elements.get(key);
  };
  element('#letter-sign-pdf').files = [file];
  element('#letter-sign-letter').value = 'letter';
  element('#letter-sign-signer').value = 'other-signer';
  const button = {disabled:false};
  const form = {querySelectorAll: () => [button], reset() {}};
  const window = {
    addEventListener() {},
    CSSMORA_SUPABASE:{url:'https://example.invalid',publishableKey:'public'},
    CSSMoRAAdmin:{
      context: () => ({userId:'secretary',isSecretariatAdmin:true}),
      showMessage() {},
      request: async url => {calls.push(['storage',url.pathname]); return {ok:true};},
      api: async (route,{body}={}) => {
        calls.push([route,body]);
        return route.includes('create_letter_signature')?'request':[];
      }
    }
  };
  vm.runInNewContext(js.replace('  async function openViewer(item) {',
    '  async function openViewer(item) { captureViewer(item); return;'), {
    window, document:{querySelector:element,currentScript:{src:'https://example.invalid/letter-signatures.js'},createElement:()=>element('retry')},
    URL, Blob, TextDecoder, setInterval() {}, captureViewer: item => calls.push(['viewer',item.signer_id])
  });
  const submit = events.get('#letter-sign-request-form:submit');
  await submit({preventDefault() {},currentTarget:form,submitter:{id:'letter-sign-self'}});
  assert.equal(calls[0][1].p_signer_id,'secretary');
  assert.equal(calls[1][1],'/storage/v1/object/cssmora-letter-pdfs/request/original.pdf');
  assert.match(calls[2][0],/submit_letter_signature_request/);
  assert.deepEqual(calls[3],['viewer','secretary']);
  calls.length=0;
  await submit({preventDefault() {},currentTarget:form,submitter:{id:'letter-sign-send'}});
  assert.equal(calls[0][1].p_signer_id,'other-signer');
  assert.ok(!calls.some(([action])=>action==='viewer'));
});

test('Chair handoff uses the signed source and only permits one active child', () => {
  assert.match(sql,/source_request_id is not null and status in \('draft','pending','signed'\)/);
  assert.match(sql,/v_source\.signed_by is distinct from \(select auth\.uid\(\)\)/);
  assert.match(sql,/r\.role='ketua' and r\.is_active/);
  assert.match(sql,/v_source\.id::text\|\|'\/signed\.pdf'/);
  assert.match(sql,/values \(v_source\.letter_id,p_chair_id,auth\.uid\(\),'pending',now\(\),v_source\.id\)/);
  assert.match(js,/requestPath\(item\.source_request_id,'signed'\)/);
  assert.match(js,/download\(pdfBucket,originalPath\(item\)\)/);
});

test('saved stamp is previewed and stored at the signer-owned path', () => {
  assert.match(html,/id="letter-stamp-saved"/);
  assert.match(html,/Pakai stempel tersimpan/);
  assert.match(js,/assetPath = kind => \`\$\{admin\.context\(\)\.userId\}/);
  assert.match(js,/loadMark\('stamp',\{fresh:true\}\)/);
  assert.match(js,/await upload\(assetBucket,path,blob,true\);\s*if \(!isCurrent\(\) \|\| !await useLocalMark\('stamp'/);
});
