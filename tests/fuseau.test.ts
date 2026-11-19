import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decalage, fuseauValide, versInstant, versJourHeure } from '../moteur/fuseau.ts';

const PARIS = 'Europe/Paris';

test('décalage de Paris en hiver et en été', () => {
  assert.equal(decalage(new Date('2026-01-15T12:00:00Z'), PARIS), 60);
  assert.equal(decalage(new Date('2026-07-15T12:00:00Z'), PARIS), 120);
});

test('heure ordinaire, en hiver et en été', () => {
  assert.equal(
    versInstant({ annee: 2026, mois: 11, jour: 25, heure: 9, minute: 30 }, PARIS).toISOString(),
    '2026-11-25T08:30:00.000Z',
  );
  assert.equal(
    versInstant({ annee: 2026, mois: 7, jour: 14, heure: 8, minute: 0 }, PARIS).toISOString(),
    '2026-07-14T06:00:00.000Z',
  );
});

test("heure qui n'existe pas (passage à l'heure d'été) : décalée d'une heure plus tard", () => {
  // Le 29 mars 2026, les horloges passent de 02:00 à 03:00 : 02:30 n'existe pas.
  const instant = versInstant({ annee: 2026, mois: 3, jour: 29, heure: 2, minute: 30 }, PARIS);
  assert.equal(instant.toISOString(), '2026-03-29T01:30:00.000Z');
  const h = versJourHeure(instant, PARIS);
  assert.deepEqual([h.heure, h.minute], [3, 30]);
});

test("heure qui existe deux fois (passage à l'heure d'hiver)", () => {
  // Le 25 octobre 2026, les horloges reviennent de 03:00 à 02:00 : 02:30 existe deux fois.
  const instant = versInstant({ annee: 2026, mois: 10, jour: 25, heure: 2, minute: 30 }, PARIS);
  const h = versJourHeure(instant, PARIS);
  assert.deepEqual([h.jour, h.heure, h.minute], [25, 2, 30]);
});

test('autre fuseau', () => {
  assert.equal(
    versInstant({ annee: 2026, mois: 11, jour: 25, heure: 9, minute: 30 }, 'America/New_York').toISOString(),
    '2026-11-25T14:30:00.000Z',
  );
});

test('fuseau inconnu', () => {
  assert.equal(fuseauValide(PARIS), true);
  assert.equal(fuseauValide('Mars/Olympus_Mons'), false);
});
