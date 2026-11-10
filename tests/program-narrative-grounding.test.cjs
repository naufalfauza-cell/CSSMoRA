const test = require('node:test');
const assert = require('node:assert/strict');
const { narrativePromptData, programNarrativePlan, resolveProgramNarrative } = require('../supabase/functions/program-document-assistant/narrative.ts');

test('proposal gives Groq only section-specific narrative inputs', () => {
  const plan = programNarrativePlan('proposal', {
    description: 'Latihan bulu tangkis untuk 40 anggota.',
    background: 'Anggota membutuhkan kegiatan olahraga bersama.',
    rundown: [{ activity: 'Registrasi' }],
    event_date: '2026-11-28',
    budget_amount: 1500000,
  }, { description: 'Rencana lama.' });
  const data = narrativePromptData(plan);
  assert.deepEqual(Object.keys(data), ['background', 'approach']);
  assert.deepEqual(data.approach.sources, { deskripsi: 'Latihan bulu tangkis untuk 40 anggota.' });
  assert.doesNotMatch(JSON.stringify(data), /Registrasi|1500000|2026-11-28|Rencana lama/);
  const result = resolveProgramNarrative(plan, {
    background: 'Kegiatan ini telah diikuti 40 anggota.',
    approach: 'Latihan bulu tangkis direncanakan untuk 40 anggota.',
    closing: 'Kegiatan telah disetujui.',
  });
  assert.equal(result.background, 'Anggota membutuhkan kegiatan olahraga bersama.');
  assert.equal(result.approach, 'Latihan bulu tangkis direncanakan untuk 40 anggota.');
  assert.equal(result.closing, 'Demikian proposal ini disusun sebagai acuan pelaksanaan kegiatan.');
});

test('LPJ does not turn planned participation into results or fill unrecorded findings', () => {
  const plan = programNarrativePlan('lpj', {
    realization_summary: 'Pertandingan terlaksana dengan 36 peserta.',
    attendance_target: '40',
    recommendations: 'Siapkan perlengkapan lebih awal.',
  }, { description: 'Rencana lama dengan target 40 peserta.' });
  const data = narrativePromptData(plan);
  assert.deepEqual(Object.keys(data), ['implementation', 'recommendations']);
  const result = resolveProgramNarrative(plan, {
    implementation: 'Pertandingan diikuti 40 peserta.',
    outcome: 'Seluruh target tercapai.',
    evaluation: 'Evaluasi menunjukkan tingkat kepuasan yang tinggi.',
    recommendations: { text: 'Bukan string' },
  });
  assert.equal(result.implementation, 'Pertandingan terlaksana dengan 36 peserta.');
  assert.equal(result.outcome, 'Luaran dan capaian belum tercatat.');
  assert.equal(result.evaluation, 'Evaluasi belum tercatat.');
  assert.equal(result.recommendations, 'Siapkan perlengkapan lebih awal.');
});
