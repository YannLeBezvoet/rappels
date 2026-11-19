import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aEnvoyer, etatVide, lireEtat, messagePour, noterEnvoi, oublierAnciens, type Fenetre } from '../moteur/envoi.ts';
import { lireNote, type OptionsLecture } from '../moteur/lecture.ts';

const OPTIONS: OptionsLecture = { fuseau: 'Europe/Paris', heureParDefaut: '08:00' };
const MINUTE = 60_000;
const HEURE = 60 * MINUTE;

const { rappels } = lireNote(
  'n.md',
  [
    '- [ ] Hier soir ⏰ 2026-11-24 20:00',
    '- [ ] Il y a 10 minutes ⏰ 2026-11-25 09:20',
    '- [ ] Dans 5 minutes ⏰ 2026-11-25 09:35',
    '- [ ] Dans 15 minutes ⏰ 2026-11-25 09:45',
    '- [ ] Il y a 10 minutes ⏰ 2026-11-25 09:20',
  ].join('\n'),
  OPTIONS,
);

// 09:30 à Paris.
const fenetre: Fenetre = { maintenant: new Date('2026-11-25T08:30:00Z'), avance: 10 * MINUTE, rattrapage: 12 * HEURE };
const titres = (liste: { titre: string }[]) => liste.map((r) => r.titre);

test("envoie ce qui est à l'heure : rattrapage en arrière, avance limitée, sans doublon", () => {
  assert.deepEqual(titres(aEnvoyer(rappels, etatVide(), fenetre)), ['Il y a 10 minutes', 'Dans 5 minutes']);
  assert.deepEqual(titres(aEnvoyer(rappels, etatVide(), { ...fenetre, rattrapage: 24 * HEURE })), [
    'Hier soir',
    'Il y a 10 minutes',
    'Dans 5 minutes',
  ]);
});

test('ne renvoie jamais un rappel déjà parti', () => {
  const etat = etatVide();
  for (const r of aEnvoyer(rappels, etat, fenetre)) noterEnvoi(etat, r);
  assert.deepEqual(aEnvoyer(rappels, etat, fenetre), []);
  const vingtMinutesPlusTard = { ...fenetre, maintenant: new Date(fenetre.maintenant.getTime() + 20 * MINUTE) };
  assert.deepEqual(titres(aEnvoyer(rappels, etat, vingtMinutesPlusTard)), ['Dans 15 minutes']);
});

test('oublie les rappels trop anciens pour repartir', () => {
  const etat = etatVide();
  etat.envoyes.ancien = '2026-11-20T08:00:00.000Z';
  etat.envoyes.recent = '2026-11-25T08:20:00.000Z';
  etat.envoyes.illisible = 'pas une date';
  assert.equal(oublierAnciens(etat, fenetre), 2);
  assert.deepEqual(Object.keys(etat.envoyes), ['recent']);
});

test('mémoire : relue telle quelle, refusée si illisible', () => {
  const etat = etatVide();
  noterEnvoi(etat, rappels[0]!);
  assert.deepEqual(lireEtat(JSON.stringify(etat)), etat);
  assert.throws(() => lireEtat('{"version": 2, "envoyes": {}}'), /format inconnu/);
  assert.throws(() => lireEtat('null'), /format inconnu/);
  assert.throws(() => lireEtat('{'));
});

test('notification : titre, heure prévue et note ; jour seul pour une date sans heure', () => {
  const lus = lireNote(
    'perso/voiture.md',
    '- [ ] Appeler le garage ⏰ 2026-11-25 09:30\n- [ ] Pneus neige 📅 2026-12-01 ⏫',
    OPTIONS,
  ).rappels;
  const [garage, pneus] = lus.map((r) => messagePour(r, 'Europe/Paris'));
  assert.deepEqual(garage, { titre: 'Appeler le garage', corps: 'mer. 25 nov., 09:30 · perso/voiture.md', tag: lus[0]!.id });
  assert.equal(pneus!.titre, '❗ Pneus neige');
  assert.equal(pneus!.corps, 'mar. 01 déc. · perso/voiture.md');
});
