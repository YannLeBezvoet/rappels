// Point d'entrée de l'Action GitHub : lit les notes, envoie les rappels dont c'est l'heure
// et retient ceux déjà envoyés. Les réglages arrivent par variables d'environnement (voir action.yml).

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { lireAbonnements } from './abonnements.ts';
import { aEnvoyer, etatVide, lireEtat, messagePour, noterEnvoi, oublierAnciens, type Etat } from './envoi.ts';
import { formaterDate, fuseauValide } from './fuseau.ts';
import { lireDossier, type Rappel } from './index.ts';
import { lireHeure } from './lecture.ts';
import { clesDepuisPrivee, envoyer, type Abonnement, type ClesVapid } from './push.ts';

const env = process.env;
const REGLAGES = 'Settings → Secrets and variables → Actions du dépôt de notes';

// --- Sorties GitHub : annotations, résultats, résumé ---------------------------------------

function echapper(texte: string, propriete = false): string {
  const s = texte.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  return propriete ? s.replace(/:/g, '%3A').replace(/,/g, '%2C') : s;
}

function annoter(niveau: 'error' | 'warning', message: string, fichier?: string, ligne?: number): void {
  const ou = fichier ? ` file=${echapper(fichier, true)}${ligne ? `,line=${ligne}` : ''}` : '';
  console.log(`::${niveau}${ou}::${echapper(message)}`);
}

function arreter(message: string): never {
  annoter('error', message);
  process.exit(1);
}

function sortie(nom: string, valeur: string): void {
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${nom}=${valeur}\n`);
}

function resume(markdown: string): void {
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, markdown);
}

const sansHtml = (texte: string) => texte.replace(/</g, '&lt;');

// --- Réglages ---------------------------------------------------------------------------------

function nombre(nom: string, texte: string | undefined, defaut: number): number {
  if (!texte) return defaut;
  const n = Number(texte);
  if (!Number.isFinite(n) || n < 0) arreter(`${nom} invalide : ${texte} (nombre positif attendu)`);
  return n;
}

const privee = env.RAPPELS_CLE_PRIVEE?.trim();
if (!privee) arreter(`Secret VAPID_PRIVATE_KEY manquant ou vide : ajoute-le dans ${REGLAGES}.`);
let cles: ClesVapid;
try {
  cles = clesDepuisPrivee(privee);
} catch (e) {
  arreter(`Secret VAPID_PRIVATE_KEY : ${(e as Error).message}.`);
}

const texteAbonnements = env.RAPPELS_ABONNEMENTS?.trim();
if (!texteAbonnements) arreter(`Secret PUSH_SUBSCRIPTIONS manquant ou vide : ajoute-le dans ${REGLAGES}.`);
let abonnements: Abonnement[];
try {
  abonnements = lireAbonnements(texteAbonnements);
} catch (e) {
  arreter(`Secret PUSH_SUBSCRIPTIONS : ${(e as Error).message}`);
}

const contact = env.RAPPELS_CONTACT || (env.RAPPELS_DEPOT_ACTION ? `https://github.com/${env.RAPPELS_DEPOT_ACTION}` : '');
if (!/^(https:\/\/|mailto:)\S+$/.test(contact)) arreter(`Contact invalide : "${contact}" (https://… ou mailto:… attendu)`);

const fuseau = env.RAPPELS_FUSEAU || 'Europe/Paris';
if (!fuseauValide(fuseau)) arreter(`Fuseau horaire inconnu : ${fuseau} (exemple : Europe/Paris)`);
const heureParDefaut = env.RAPPELS_HEURE_DEFAUT || '08:00';
if (!lireHeure(heureParDefaut)) arreter(`Heure par défaut invalide : ${heureParDefaut} (attendu : HH:MM)`);

const fenetre = {
  maintenant: env.RAPPELS_MAINTENANT ? new Date(env.RAPPELS_MAINTENANT) : new Date(),
  avance: nombre('Avance', env.RAPPELS_AVANCE_MINUTES, 10) * 60_000,
  rattrapage: nombre('Rattrapage', env.RAPPELS_RATTRAPAGE_HEURES, 24) * 3_600_000,
};
if (Number.isNaN(fenetre.maintenant.getTime())) arreter(`RAPPELS_MAINTENANT invalide : ${env.RAPPELS_MAINTENANT}`);

const espace = env.GITHUB_WORKSPACE ?? process.cwd();
const dossier = resolve(espace, env.RAPPELS_NOTES || '.');
if (!existsSync(dossier) || !statSync(dossier).isDirectory()) arreter(`Dossier de notes introuvable : ${dossier}`);
const fichierEtat = env.RAPPELS_ETAT || join(env.RUNNER_TEMP ?? tmpdir(), 'rappels-etat', 'etat.json');
const simulation = env.RAPPELS_SIMULATION === 'true' || env.RAPPELS_SIMULATION === '1';

// --- Lecture des notes et de la mémoire -----------------------------------------------------

const lecture = await lireDossier(dossier, { fuseau, heureParDefaut });
for (const p of lecture.problemes) annoter('warning', p.message, relative(espace, join(dossier, p.fichier)), p.ligne);

let etat: Etat = etatVide();
if (existsSync(fichierEtat)) {
  try {
    etat = lireEtat(readFileSync(fichierEtat, 'utf8'));
  } catch {
    annoter('warning', 'Mémoire des rappels envoyés illisible : elle repart de zéro.');
  }
} else {
  console.log('Pas encore de mémoire des rappels envoyés (premier passage, ou mémoire expirée).');
}
const oublies = oublierAnciens(etat, fenetre);
const choisis = aEnvoyer(lecture.rappels, etat, fenetre);

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;
const dateDe = (r: Rappel) => formaterDate(r.quand, fuseau, false, r.heurePrecise);
console.log(
  `${pluriel(lecture.rappels.length, 'rappel')} dans ${pluriel(lecture.notes, 'note')}, ` +
    `${choisis.length} à envoyer${simulation ? ' (simulation : rien ne part)' : ''}.`,
);

// --- Envoi ----------------------------------------------------------------------------------

const envoyes: Rappel[] = [];
const rates: Rappel[] = [];
const soucis = new Map<number, { expire: boolean; explication: string }>();

for (const rappel of choisis) {
  if (simulation) {
    console.log(`  · ${dateDe(rappel)}  ${rappel.titre}`);
    continue;
  }
  const message = messagePour(rappel, fuseau);
  const resultats = await Promise.all(abonnements.map((a) => envoyer(a, message, { cles, contact })));
  resultats.forEach((r, i) => {
    if (!r.ok) soucis.set(i, { expire: r.expire, explication: r.explication });
  });
  if (resultats.some((r) => r.ok)) {
    noterEnvoi(etat, rappel);
    envoyes.push(rappel);
    console.log(`  ✔ ${dateDe(rappel)}  ${rappel.titre}`);
  } else {
    rates.push(rappel);
    console.log(`  ✘ ${dateDe(rappel)}  ${rappel.titre}`);
  }
}

for (const [i, { expire, explication }] of soucis) {
  const appareil = abonnements.length > 1 ? `L'appareil n°${i + 1}` : "L'appareil";
  const niveau = envoyes.length > 0 ? 'warning' : 'error';
  if (expire) {
    annoter(niveau, `${appareil} n'est plus abonné : réactive les notifications dans l'appli, puis remplace le secret PUSH_SUBSCRIPTIONS.`);
  } else {
    annoter(niveau, `${appareil} : ${explication}`);
  }
}
if (rates.length > 0) {
  annoter('error', `${pluriel(rates.length, 'rappel')} reçu${rates.length > 1 ? 's' : ''} par aucun appareil : nouvel essai au prochain passage.`);
  process.exitCode = 1;
}

// --- Mémoire et résumé ----------------------------------------------------------------------

const modifie = !simulation && (envoyes.length > 0 || oublies > 0);
if (modifie) {
  mkdirSync(dirname(fichierEtat), { recursive: true });
  writeFileSync(fichierEtat, `${JSON.stringify(etat)}\n`);
}
sortie('envoyes', String(envoyes.length));
sortie('etat-modifie', String(modifie));

const prochains = lecture.rappels.filter((r) => r.quand.getTime() > fenetre.maintenant.getTime() + fenetre.avance).slice(0, 5);
const ligne = (r: Rappel) => `- ${dateDe(r)} : ${sansHtml(r.titre)} (\`${r.fichier}\`)\n`;
resume(
  [
    '### Rappels\n\n',
    `${pluriel(lecture.rappels.length, 'rappel')} dans ${pluriel(lecture.notes, 'note')}.\n\n`,
    simulation && choisis.length > 0 ? `**À envoyer (simulation)**\n\n${choisis.map(ligne).join('')}\n` : '',
    envoyes.length > 0 ? `**Envoyés**\n\n${envoyes.map(ligne).join('')}\n` : '',
    rates.length > 0 ? `**Non reçus, nouvel essai au prochain passage**\n\n${rates.map(ligne).join('')}\n` : '',
    prochains.length > 0 ? `**Prochains**\n\n${prochains.map(ligne).join('')}` : 'Rien de prévu ensuite.\n',
  ].join(''),
);
