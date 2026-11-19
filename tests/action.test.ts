import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createECDH, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { etatVide, noterEnvoi } from '../moteur/envoi.ts';
import { lireDossier } from '../moteur/index.ts';
import { genererCles } from '../moteur/push.ts';

const RACINE = fileURLToPath(new URL('..', import.meta.url));

function abonnementFictif(): string {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return JSON.stringify({
    endpoint: 'https://fcm.googleapis.com/fcm/send/fictif',
    keys: { p256dh: ecdh.getPublicKey('base64url'), auth: randomBytes(16).toString('base64url') },
  });
}

/** Lance l'Action comme sur GitHub, en simulation, à 09:35 (heure de Paris) le 25 novembre. */
function lancer(variables: Record<string, string> = {}) {
  const dossier = mkdtempSync(join(tmpdir(), 'rappels-action-'));
  const fichiers = { sorties: join(dossier, 'sorties'), resume: join(dossier, 'resume'), etat: join(dossier, 'etat.json') };
  writeFileSync(fichiers.sorties, '');
  writeFileSync(fichiers.resume, '');
  const r = spawnSync(process.execPath, ['moteur/action.ts'], {
    cwd: RACINE,
    encoding: 'utf8',
    // Environnement neuf : pas de fuite des variables GITHUB_* quand les tests tournent eux-mêmes sur GitHub.
    env: {
      PATH: process.env.PATH ?? '',
      GITHUB_WORKSPACE: RACINE,
      GITHUB_OUTPUT: fichiers.sorties,
      GITHUB_STEP_SUMMARY: fichiers.resume,
      RAPPELS_CLE_PRIVEE: genererCles().privee,
      RAPPELS_ABONNEMENTS: abonnementFictif(),
      RAPPELS_DEPOT_ACTION: 'YannLeBezvoet/rappels',
      RAPPELS_NOTES: 'tests/notes-exemple',
      RAPPELS_MAINTENANT: '2026-11-25T08:35:00Z',
      RAPPELS_SIMULATION: 'true',
      RAPPELS_ETAT: fichiers.etat,
      ...variables,
    },
  });
  return {
    code: r.status,
    journal: r.stdout,
    sorties: readFileSync(fichiers.sorties, 'utf8'),
    resume: readFileSync(fichiers.resume, 'utf8'),
  };
}

test("simulation : annonce le rappel dont c'est l'heure, signale les dates à corriger", () => {
  const { code, journal, sorties, resume } = lancer();
  assert.equal(code, 0);
  assert.match(journal, /4 rappels dans 2 notes, 1 à envoyer \(simulation : rien ne part\)\./);
  assert.match(journal, /· mer\. 25 nov\., 09:30 {2}Appeler le garage/);
  assert.match(journal, /^::warning file=tests\/notes-exemple\/admin\.md,line=13::date invalide/m);
  assert.match(sorties, /^envoyes=0$/m);
  assert.match(sorties, /^etat-modifie=false$/m);
  assert.match(resume, /\*\*À envoyer \(simulation\)\*\*\n\n- mer\. 25 nov\., 09:30 : Appeler le garage \(`perso\/voiture\.md`\)/);
  assert.match(resume, /\*\*Prochains\*\*\n\n- mar\. 01 déc\. : Renouveler le passeport/);
});

test('un rappel déjà dans la mémoire ne repart pas', async () => {
  const lecture = await lireDossier(join(RACINE, 'tests/notes-exemple'), { fuseau: 'Europe/Paris', heureParDefaut: '08:00' });
  const etat = etatVide();
  noterEnvoi(etat, lecture.rappels.find((r) => r.titre === 'Appeler le garage')!);
  const fichier = join(mkdtempSync(join(tmpdir(), 'rappels-etat-')), 'etat.json');
  writeFileSync(fichier, JSON.stringify(etat));
  assert.match(lancer({ RAPPELS_ETAT: fichier }).journal, /0 à envoyer/);
});

test('secrets manquants ou mal copiés : erreur claire', () => {
  const sansCle = lancer({ RAPPELS_CLE_PRIVEE: '' });
  assert.equal(sansCle.code, 1);
  assert.match(sansCle.journal, /^::error::Secret VAPID_PRIVATE_KEY manquant ou vide : ajoute-le dans Settings/m);
  assert.match(lancer({ RAPPELS_ABONNEMENTS: '{"endpoint":' }).journal, /^::error::Secret PUSH_SUBSCRIPTIONS : Ce n'est pas du JSON/m);
  assert.match(lancer({ RAPPELS_CLE_PRIVEE: 'abc' }).journal, /^::error::Secret VAPID_PRIVATE_KEY : Clé privée VAPID invalide/m);
});
