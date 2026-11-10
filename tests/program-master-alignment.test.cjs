const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const read = file => readFileSync(join(__dirname, '..', file), 'utf8');

test('copying the official letterhead targets only the normal header and preserves image positions', async () => {
  const { programLetterheadRequests } = await import('../supabase/functions/drive-integration/program-letterhead.ts');
  const inline = inlineObjectId => ({ inlineObjectElement: { inlineObjectId } });
  const text = content => ({ textRun: { content, textStyle: { bold: true } } });
  const image = { inlineObjectProperties: { embeddedObject: { size: { width: { magnitude: 20, unit: 'PT' } }, imageProperties: { contentUri: 'https://example.test/logo.png' } } } };
  const source = { documentStyle: { defaultHeaderId: 'official' },
    headers: { official: { content: [
      { paragraph: { elements: [inline('a'), text('\n')] } },
      { paragraph: { elements: [text('CSSMoRA\n')] } },
      { paragraph: { elements: [inline('b'), text('\n')] } },
    ] } }, inlineObjects: { a: image, b: image } };
  const target = { documentStyle: { defaultHeaderId: 'kop', firstPageHeaderId: 'cover' },
    headers: { kop: { content: [{ endIndex: 4 }] }, cover: { content: [{ endIndex: 1 }] } } };
  const requests = programLetterheadRequests(source, target);
  assert.deepEqual(requests[0].deleteContentRange.range, { segmentId: 'kop', startIndex: 0, endIndex: 3 });
  assert.deepEqual(requests.filter(x => x.insertInlineImage).map(x => x.insertInlineImage.location.index), [9, 0]);
  assert.ok(requests.every(x => !JSON.stringify(x).includes('"cover"')));
});

test('master inputs persist and LPJ approval uses its own table with separate secretariat verification', () => {
  const client = read('dist/program-documents.js');
  const edge = read('supabase/functions/drive-integration/index.ts');
  assert.match(client, /\['background','description'/);
  assert.match(client, /\['opening','realization_summary'/);
  assert.match(client, /'closing','signer_identity_kind'/);
  assert.match(edge, /edits: lpjApprovalEdits\(document, committee\)/);
  assert.match(edge, /Verifikasi Sekretaris Umum CSSMoRA Universitas Airlangga/);
  assert.match(edge, /form_data\?\.signer_identity_kind === "NIM"/);
});
