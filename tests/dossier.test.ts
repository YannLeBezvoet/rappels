import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { entre, lireDossier, lireNote, type OptionsLecture } from '../moteur/index.ts';

const OPTIONS: OptionsLecture = { fuseau: 'Europe/Paris', heureParDefaut: '08:00' };
const EXEMPLE = fileURLToPath(new URL('./notes-exemple', import.meta.url));

test('lit les notes .md du dossier, sauf les dossiers cachés et les autres fichiers', async () => {
  const lecture = await lireDossier(EXEMPLE, OPTIONS);
  assert.equal(lecture.notes, 2);
  assert.deepEqual(
    lecture.rappels.map((r) => `${r.quand.toISOString()} ${r.fichier}:${r.ligne} ${r.titre}`),
    [
      '2026-11-25T08:30:00.000Z perso/voiture.md:6 Appeler le garage',
      '2026-12-01T07:00:00.000Z admin.md:3 Renouveler le passeport',
      '2026-12-01T07:00:00.000Z perso/voiture.md:8 Changer les pneus neige',
      '2026-12-05T07:00:00.000Z admin.md:4 Payer le loyer',
    ],
  );
  assert.deepEqual(
    lecture.problemes.map((p) => `${p.fichier}:${p.ligne}`),
    ['admin.md:13'],
  );
});

test('entre : début exclu, fin incluse', () => {
  const { rappels } = lireNote(
    'n.md',
    ['- [ ] A ⏰ 2026-11-25 09:00', '- [ ] B ⏰ 2026-11-25 09:20', '- [ ] C ⏰ 2026-11-25 09:40'].join('\n'),
    OPTIONS,
  );
  const titres = (apres: string, jusqua: string) =>
    entre(rappels, new Date(apres), new Date(jusqua)).map((r) => r.titre);
  // 09:00 à Paris = 08:00 UTC.
  assert.deepEqual(titres('2026-11-25T08:00:00Z', '2026-11-25T08:20:00Z'), ['B']);
  assert.deepEqual(titres('2026-11-25T07:59:00Z', '2026-11-25T08:40:00Z'), ['A', 'B', 'C']);
  assert.deepEqual(titres('2026-11-25T08:40:00Z', '2026-11-25T09:00:00Z'), []);
});
