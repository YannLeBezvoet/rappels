import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const RACINE = fileURLToPath(new URL('..', import.meta.url));

function lancer(...args: string[]) {
  const r = spawnSync(process.execPath, ['moteur/cli.ts', ...args], { cwd: RACINE, encoding: 'utf8' });
  return { code: r.status, sortie: r.stdout, erreurs: r.stderr };
}

test('liste les rappels en retard, à venir et à corriger', () => {
  const { code, sortie } = lancer('tests/notes-exemple', '--maintenant', '2026-11-28T12:00');
  assert.equal(code, 0);
  assert.match(sortie, /4 rappels dans 2 notes/);
  assert.match(sortie, /En retard\n.*Appeler le garage.*perso\/voiture\.md:6/);
  assert.match(sortie, /Dans les 14 prochains jours\n(.*\n){3}/);
  assert.match(sortie, /Changer les pneus neige \(priorité haute\)/);
  assert.match(sortie, /Payer le loyer \(🔁 every month\)/);
  assert.match(sortie, /À corriger\n\s+admin\.md:13\s+date invalide : 2026-13-01/);
  assert.doesNotMatch(sortie, /Ne doit pas apparaître|Ceci n'est pas un rappel/);
});

test('fenêtre plus courte : le reste passe dans « Plus tard »', () => {
  const { sortie } = lancer('tests/notes-exemple', '--maintenant', '2026-11-28T12:00', '--jours', '3');
  assert.match(sortie, /Dans les 3 prochains jours\n.*Renouveler le passeport/);
  assert.match(sortie, /Plus tard : 1 rappel, le prochain le /);
});

test('erreurs de saisie expliquées', () => {
  assert.match(lancer('dossier-qui-n-existe-pas').erreurs, /Dossier introuvable/);
  assert.equal(lancer('dossier-qui-n-existe-pas').code, 1);
  assert.match(lancer('tests/notes-exemple', '--fuseau', 'Paris').erreurs, /Fuseau horaire inconnu/);
  assert.match(lancer('tests/notes-exemple', '--maintenant', 'demain').erreurs, /Date invalide pour --maintenant/);
  assert.match(lancer().erreurs, /Indique le dossier/);
});
