const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { stripTypeScriptTypes } = require('node:module');
const { runInNewContext } = require('node:vm');
const path = require('node:path');

const source = readFileSync(path.join(__dirname, '../supabase/functions/drive-integration/index.ts'), 'utf8');

test('archive proposal formatting normalizes mixed heading numbering, preserves centered titles and justifies prose', () => {
  const start = source.indexOf('function proposalParagraphFormatRequests(');
  const end = source.indexOf('function committeeAppendixText(', start);
  const format = runInNewContext(stripTypeScriptTypes('(' + source.slice(start, end).trim() + ')'), {
    templateParagraphText: paragraph => paragraph.elements[0].textRun.content.trim(),
    templateTextKey: text => text.toLowerCase().replace(/^[a-h][.)]\s*/, ''),
    templateParagraphRange: paragraph => ({
      startIndex: paragraph.elements[0].startIndex,
      endIndex: paragraph.elements[0].endIndex - 1,
    }),
    textStyleFieldMask: style => Object.keys(style).join(','),
    PROGRAM_BODY_TEXT_STYLE: { weightedFontFamily: { fontFamily: 'Times New Roman' } },
  });
  const paragraph = (startIndex, text, alignment, bullet) => {
    const endIndex = startIndex + text.length + 1;
    return {
      startIndex, endIndex,
      paragraph: { bullet, paragraphStyle: { alignment }, elements: [{ startIndex, endIndex, textRun: { content: text + '\n' } }] },
    };
  };
  const requests = format([
    paragraph(1, 'PROPOSAL', 'CENTER'),
    paragraph(20, 'D. Tema Kegiatan'),
    paragraph(45, 'Tema kegiatan ini adalah “Sportif”.'),
    paragraph(100, 'Sasaran Kegiatan', 'START', { listId: 'legacy' }),
    paragraph(140, 'Lampiran 1'),
  ]);
  const style = index => requests.find(request => request.updateParagraphStyle?.range.startIndex === index).updateParagraphStyle.paragraphStyle;
  assert.equal(style(1).alignment, 'CENTER');
  assert.equal(style(45).alignment, 'JUSTIFIED');
  assert.equal(style(140).pageBreakBefore, true);
  assert.ok(requests.some(request => request.deleteParagraphBullets?.range.startIndex === 100));
  assert.equal(requests.filter(request => request.insertText).map(request => request.insertText.text).join(''), 'F. D. ');
  assert.equal(requests.find(request => request.updateTextStyle?.range.startIndex === 20).updateTextStyle.textStyle.bold, true);
  assert.equal(requests.find(request => request.updateTextStyle?.range.startIndex === 45).updateTextStyle.textStyle.bold, false);
});
