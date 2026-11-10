const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { stripTypeScriptTypes } = require('node:module');
const { runInNewContext } = require('node:vm');
const path = require('node:path');

const source = readFileSync(path.join(__dirname, '../supabase/functions/drive-integration/index.ts'), 'utf8');

function loadFunction(name, following, globals) {
  const start = source.indexOf(name);
  const end = source.indexOf(following, start);
  assert.ok(start >= 0 && end > start);
  return runInNewContext(stripTypeScriptTypes('(' + source.slice(start, end).trim() + ')'), globals);
}

test('proposal table formatting reads cell text and uses the Docs cell alignment field', () => {
  const format = loadFunction('function programTableFormatRequests(', 'async function resizeProgramTable(', {
    findProgramTable: () => ({ startIndex: 10 }),
    templateTableRows: () => [
      { tableCells: [{ text: 'Sumber Dana' }] },
      { tableCells: [{ text: 'Total Pemasukan' }] },
    ],
    templateTableHeaderIndex: () => 0,
    templateTableCellText: cell => cell.text,
    templateCellRange: () => ({ startIndex: 12, endIndex: 18 }),
  });
  const requests = format({}, ['Sumber Dana']);
  const style = requests[0].updateTableCellStyle;
  assert.equal(style.tableStartLocation.index, 10);
  assert.equal(style.tableCellStyle.contentAlignment, 'MIDDLE');
  assert.ok(style.fields.split(',').includes('contentAlignment'));
  assert.equal(requests[2].updateTextStyle.textStyle.bold, true);
});

test('a retry finds and updates the Google Doc tagged with the same draft ID', async () => {
  const requests = [];
  const mimeType = 'application/vnd.google-apps.document';
  let tagged = false;
  const importTemplate = loadFunction('async function importProgramTemplate(', 'function templateDocumentBody(', {
    URLSearchParams,
    AbortSignal,
    GOOGLE_DOC_MIME: mimeType,
    DOCX_MIME: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    Deno: { readTextFile: async () => 'template' },
    fromBase64: () => new Uint8Array(1000),
    googleJson: async (_token, url) => {
      if (url.includes('/files?')) {
        const query = new URL(url).searchParams.get('q');
        assert.match(query, /cssmoraProgramDocumentId.*draft-id/);
        return { data: { files: tagged ? [{ id: 'existing-doc' }] : [] } };
      }
      assert.match(url, /\/files\/existing-doc/);
      return { data: { mimeType } };
    },
    fetch: async (url, options) => {
      if (options.method === 'PUT') {
        return { ok: true, text: async () => JSON.stringify({ id: 'existing-doc', mimeType }) };
      }
      requests.push({ url, method: options.method });
      if (options.method === 'POST') {
        assert.equal(JSON.parse(options.body).appProperties.cssmoraProgramDocumentId, 'draft-id');
        tagged = true;
      }
      return { ok: true, headers: { get: () => 'https://example.com/upload' } };
    },
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await importTemplate('token', 'folder', 'proposal', 'CSS-SPORT', '', 'draft-id');
    assert.equal(result.documentId, 'existing-doc');
  }
  assert.deepEqual(requests.map(request => request.method), ['POST', 'PATCH']);
  assert.match(requests[1].url, /\/files\/existing-doc\?/);
});
