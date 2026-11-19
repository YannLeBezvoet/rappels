import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lireNote, type OptionsLecture } from '../moteur/lecture.ts';

const OPTIONS: OptionsLecture = { fuseau: 'Europe/Paris', heureParDefaut: '08:00' };
const lire = (contenu: string) => lireNote('note.md', contenu, OPTIONS);
const titres = (contenu: string) => lire(contenu).rappels.map((r) => r.titre);
const instants = (contenu: string) => lire(contenu).rappels.map((r) => r.quand.toISOString());

test("📅 seul : rappel le jour même, à l'heure par défaut", () => {
  const { rappels, problemes } = lire('- [ ] Renouveler le passeport 📅 2026-12-01');
  assert.equal(problemes.length, 0);
  assert.equal(rappels.length, 1);
  const r = rappels[0]!;
  assert.equal(r.titre, 'Renouveler le passeport');
  assert.equal(r.quand.toISOString(), '2026-12-01T07:00:00.000Z');
  assert.equal(r.heurePrecise, false);
  assert.equal(r.fichier, 'note.md');
  assert.equal(r.ligne, 1);
});

test('⏰ avec une heure', () => {
  const r = lire('- [ ] Appeler le garage ⏰ 2026-11-25 09:30').rappels[0]!;
  assert.equal(r.titre, 'Appeler le garage');
  assert.equal(r.quand.toISOString(), '2026-11-25T08:30:00.000Z');
  assert.equal(r.heurePrecise, true);
});

test('⏰ passe avant 📅 quand les deux sont écrits', () => {
  assert.deepEqual(instants('- [ ] Rendre le dossier 📅 2026-12-01 ⏰ 2026-11-30 18:00'), ['2026-11-30T17:00:00.000Z']);
});

test('⏰ sans heure, et 📅 avec une heure', () => {
  assert.deepEqual(instants('- [ ] A ⏰ 2026-11-25\n- [ ] B 📅 2026-11-26 14:15'), [
    '2026-11-25T07:00:00.000Z',
    '2026-11-26T13:15:00.000Z',
  ]);
});

test("en été, l'heure par défaut suit l'heure d'été", () => {
  assert.deepEqual(instants('- [ ] Fête 📅 2026-07-14'), ['2026-07-14T06:00:00.000Z']);
});

test('format par défaut du plugin Reminder : (@date heure)', () => {
  const r = lire('- [ ] Sortir les poubelles (@2026-11-25 19:45)').rappels[0]!;
  assert.equal(r.titre, 'Sortir les poubelles');
  assert.equal(r.quand.toISOString(), '2026-11-25T18:45:00.000Z');
});

test('tâches cochées ou annulées ignorées, tâche « en cours » gardée', () => {
  const contenu = [
    '- [x] Faite 📅 2026-12-01',
    '- [X] Faite aussi 📅 2026-12-01',
    '- [-] Annulée 📅 2026-12-01',
    '- [/] En cours 📅 2026-12-01',
    '- [ ] À faire 📅 2026-12-01',
  ].join('\n');
  assert.deepEqual(titres(contenu), ['En cours', 'À faire']);
});

test('tâches sans date et texte ordinaire ignorés, sans problème signalé', () => {
  const contenu = '# Titre\n\n- [ ] Sans date\n- Une simple liste 📅 2026-12-01\nDu texte 📅 2026-12-01';
  assert.deepEqual(lire(contenu), { rappels: [], problemes: [] });
});

test('blocs de code ignorés', () => {
  const contenu = [
    '```markdown',
    '- [ ] Exemple 📅 2026-12-01',
    '```',
    '~~~',
    '- [ ] Exemple avec tildes 📅 2026-12-01',
    '~~~',
    '````',
    '```',
    '- [ ] Dans un bloc à quatre accents 📅 2026-12-01',
    '````',
    '- [ ] Vrai rappel 📅 2026-12-02',
  ].join('\n');
  assert.deepEqual(titres(contenu), ['Vrai rappel']);
});

test('bloc de code jamais fermé : la suite de la note est ignorée', () => {
  assert.deepEqual(titres('- [ ] Avant 📅 2026-12-01\n```\n- [ ] Après 📅 2026-12-01'), ['Avant']);
});

test('en-tête YAML ignoré, numéros de ligne conservés', () => {
  const contenu = ['---', 'liste:', '- [ ] pas une tâche 📅 2026-12-01', '---', '- [ ] Vraie tâche 📅 2026-12-02'].join('\n');
  const { rappels } = lire(contenu);
  assert.deepEqual(
    rappels.map((r) => [r.titre, r.ligne]),
    [['Vraie tâche', 5]],
  );
});

test('titre nettoyé : répétition, priorité, étiquettes et identifiant de bloc', () => {
  const r = lire('- [ ] Payer le loyer #maison 📅 2026-12-05 🔁 every month ⏫ ^loyer-1').rappels[0]!;
  assert.equal(r.titre, 'Payer le loyer #maison');
  assert.equal(r.repetition, 'every month');
  assert.equal(r.priorite, 'haute');
});

test('étiquette après la date et autres champs du plugin Tasks', () => {
  const r = lire('- [ ] Acheter du pain ➕ 2026-11-01 📅 2026-12-01 #courses 🔺').rappels[0]!;
  assert.equal(r.titre, 'Acheter du pain #courses');
  assert.equal(r.priorite, 'maximale');
});

test("variantes d'écriture : puces, numéros, citations, retrait, sélecteur d'émoji", () => {
  const contenu = [
    '* [ ] Étoile 📅 2026-12-01',
    '+ [ ] Plus 📅 2026-12-01',
    '1. [ ] Numéro 📅 2026-12-01',
    '> - [ ] Citation 📅 2026-12-01',
    '> [!todo] Encadré',
    '> - [ ] Dans un encadré 📅 2026-12-01',
    '    - [ ] Avec retrait ⏰️ 2026-12-01 10:00',
  ].join('\n');
  assert.deepEqual(titres(contenu), ['Étoile', 'Plus', 'Numéro', 'Citation', 'Dans un encadré', 'Avec retrait']);
});

test('dates et heures impossibles signalées avec leur ligne', () => {
  const { rappels, problemes } = lire(
    [
      '- [ ] Correct 📅 2026-12-01',
      '- [ ] Mois 13 📅 2026-13-01',
      '- [ ] 30 février ⏰ 2026-02-30 10:00',
      '- [ ] 25 heures ⏰ 2026-12-01 25:00',
      '- [ ] Illisible 📅 demain',
    ].join('\n'),
  );
  assert.deepEqual(
    rappels.map((r) => r.titre),
    ['Correct'],
  );
  assert.deepEqual(
    problemes.map((p) => p.ligne),
    [2, 3, 4, 5],
  );
  assert.match(problemes[3]!.message, /demain/);
});

test('identifiant stable : il ne dépend ni du fichier ni de la ligne', () => {
  const a = lireNote('a.md', '- [ ] Même chose 📅 2026-12-01', OPTIONS).rappels[0]!;
  const b = lireNote('dossier/b.md', '\n\n- [ ] Même chose 📅 2026-12-01', OPTIONS).rappels[0]!;
  const c = lireNote('a.md', '- [ ] Même chose 📅 2026-12-02', OPTIONS).rappels[0]!;
  assert.match(a.id, /^[0-9a-f]{12}$/);
  assert.equal(a.id, b.id);
  assert.notEqual(a.id, c.id);
});

test('fins de ligne Windows et marque BOM', () => {
  const { rappels } = lire('﻿- [ ] Un 📅 2026-12-01\r\n- [ ] Deux 📅 2026-12-02\r\n');
  assert.deepEqual(
    rappels.map((r) => [r.titre, r.ligne]),
    [
      ['Un', 1],
      ['Deux', 2],
    ],
  );
});

test('rappel sans titre', () => {
  assert.deepEqual(titres('- [ ] 📅 2026-12-01'), ['(rappel sans titre)']);
});

test('heure par défaut invalide refusée', () => {
  assert.throws(() => lireNote('n.md', '', { ...OPTIONS, heureParDefaut: '8h' }), /Heure par défaut invalide/);
});
