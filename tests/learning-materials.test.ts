import assert from 'node:assert/strict';
import test from 'node:test';
import { createLearningMaterial, htmlText, publicIPv4, publicURL, readPublicMaterial } from '../server/learning-materials.js';

test('source reader rejects local, private, credentialed and non-web URLs including numeric aliases', async () => {
  for (const value of ['http://127.0.0.1/a', 'http://2130706433/a', 'http://0x7f000001/a', 'http://10.0.0.1/',
    'http://[::1]/', 'file:///etc/passwd', 'https://example.com:8000/', 'https://user:pass@example.com/', 'http://localhost/']) {
    assert.throws(() => publicURL(value));
    await assert.rejects(readPublicMaterial(value));
  }
  for (const address of ['0.0.0.0', '100.64.1.1', '169.254.169.254', '172.16.2.1', '192.168.1.1', '198.18.0.2', '224.0.0.1', '::ffff:127.0.0.1'])
    assert.equal(publicIPv4(address), false, address);
  assert.equal(publicIPv4('93.184.216.34'), true);
  assert.equal(publicURL('https://example.com/lesson#part').href, 'https://example.com/lesson');
});

test('HTML sources retain text and entities but omit scripts and navigation', () => {
  const result = htmlText('<title>Learning &amp; doing</title><nav>Menus</nav><main><h1>Energy</h1><p>Work &lt; force.</p><script>steal()</script><style>css</style></main>');
  assert.equal(result.title, 'Learning & doing');
  assert.match(result.text, /Energy\n+Work < force\./);
  assert.doesNotMatch(result.text, /steal|Menus|css/);
});

test('notes stay exact and invalid or excessive source content is rejected', async () => {
  const note = await createLearningMaterial({ title: 'My notes', kind: 'note', text: '# Music\nA major scale.' });
  assert.equal(note.text, '# Music\nA major scale.');
  assert.equal(note.kind, 'note');
  await assert.rejects(createLearningMaterial({ title: 'Empty', kind: 'note', text: ' ' }));
  await assert.rejects(createLearningMaterial({ title: 'Large', kind: 'note', text: 'a'.repeat(200001) }));
  await assert.rejects(createLearningMaterial({ title: 'Fake', kind: 'pdf', data: Buffer.from('not a pdf').toString('base64') }));
});

function samplePDF(): Buffer {
  const content = 'BT /F1 16 Tf 30 180 Td (A major scale has seven notes.) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 240] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((value, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${value}\nendobj\n`; });
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(pdf);
}

test('PDF uploads extract page-referenced text and preserve original bytes', async () => {
  const source = samplePDF();
  const data = `data:application/pdf;base64,${source.toString('base64')}`;
  const material = await createLearningMaterial({ title: 'Scale notes', kind: 'pdf', data, filename: '../notes.pdf' });
  assert.match(material.text, /\[Page 1\]/);
  assert.match(material.text, /major scale has seven notes/);
  assert.equal(material.sourceData, data);
  assert.equal(material.filename, 'notes.pdf');
});
