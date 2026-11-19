// Crée les clés VAPID de l'appli, ou reprend celles qui existent déjà.
// La clé privée va dans .env (jamais commité), la clé publique dans app/config.json (publiée avec l'appli).
// Utilisation : npm run cles [-- --remplacer] [--contact <https://… ou mailto:…>]

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv, styleText } from 'node:util';
import { clesDepuisPrivee, genererCles, type ClesVapid } from '../moteur/push.ts';

const AIDE = `Crée les clés VAPID de l'appli, ou reprend celles qui existent déjà.

Utilisation :
  npm run cles [-- options]

Options :
  --remplacer         crée de nouvelles clés (les téléphones devront se réabonner)
  --contact <adresse> contact donné aux services de push : https://… ou mailto:…
                      (défaut : l'adresse GitHub de ce dépôt)
  -h, --aide          affiche cette aide`;

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const ENV = fileURLToPath(new URL('../.env', import.meta.url));
const CONFIG = fileURLToPath(new URL('../app/config.json', import.meta.url));

function quitter(message: string): never {
  console.error(`${message}\n\nPour l'aide : npm run cles -- --aide`);
  process.exit(1);
}

function contactDepuisGit(): string | undefined {
  try {
    const origine = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: RACINE, encoding: 'utf8' }).trim();
    const m = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/.exec(origine);
    return m ? `https://github.com/${m[1]}/${m[2]}` : undefined;
  } catch {
    return undefined;
  }
}

/** Remplace ou ajoute des variables dans .env, sans toucher aux autres lignes. */
function ecrireEnv(valeurs: Record<string, string>) {
  const lignes = existsSync(ENV)
    ? readFileSync(ENV, 'utf8').split('\n')
    : ["# Clés de l'appli Rappels. Ce fichier ne doit jamais être commité."];
  const gardees = lignes.filter((l) => !Object.keys(valeurs).some((nom) => l.startsWith(`${nom}=`)));
  while (gardees.at(-1)?.trim() === '') gardees.pop();
  const nouvelles = Object.entries(valeurs).map(([nom, valeur]) => `${nom}=${valeur}`);
  writeFileSync(ENV, [...gardees, ...nouvelles, ''].join('\n'), { mode: 0o600 });
  chmodSync(ENV, 0o600);
}

function ecrireConfig(cles: ClesVapid): boolean {
  const contenu = `${JSON.stringify({ clePublique: cles.publique }, null, 2)}\n`;
  if (existsSync(CONFIG) && readFileSync(CONFIG, 'utf8') === contenu) return false;
  writeFileSync(CONFIG, contenu);
  return true;
}

let values;
try {
  ({ values } = parseArgs({
    options: {
      remplacer: { type: 'boolean' },
      contact: { type: 'string' },
      aide: { type: 'boolean', short: 'h' },
    },
  }));
} catch (e) {
  quitter(e instanceof Error ? e.message : String(e));
}
if (values.aide) {
  console.log(AIDE);
  process.exit(0);
}

const existant = existsSync(ENV) ? parseEnv(readFileSync(ENV, 'utf8')) : {};
const reprises = Boolean(existant.VAPID_PRIVATE_KEY) && !values.remplacer;
let cles: ClesVapid;
try {
  cles = reprises ? clesDepuisPrivee(existant.VAPID_PRIVATE_KEY!) : genererCles();
} catch (e) {
  quitter(`.env : ${(e as Error).message}. Pour repartir de zéro : npm run cles -- --remplacer`);
}

const contact = values.contact ?? existant.VAPID_SUBJECT ?? contactDepuisGit();
if (!contact) quitter('Indique un contact, par exemple : npm run cles -- --contact https://github.com/toi/rappels');
if (!/^(https:\/\/|mailto:)\S+$/.test(contact)) quitter(`Contact invalide : ${contact} (https://… ou mailto:… attendu)`);

ecrireEnv({ VAPID_PRIVATE_KEY: cles.privee, VAPID_SUBJECT: contact });
const configModifiee = ecrireConfig(cles);

console.log(styleText('bold', reprises ? 'Clés VAPID existantes reprises.' : 'Clés VAPID créées.'));
console.log(`  Clé publique : ${cles.publique}`);
console.log(`                 ${configModifiee ? 'écrite dans' : 'déjà dans'} app/config.json, publiée avec l'appli`);
console.log("  Clé privée   : dans .env, à garder secrète (elle ira dans les secrets du dépôt de notes)");
console.log(`  Contact      : ${contact}`);
if (configModifiee) console.log(styleText('yellow', "\nPublie l'appli pour que le téléphone utilise cette clé publique."));
if (values.remplacer && existant.VAPID_PRIVATE_KEY) {
  console.log(styleText('yellow', 'Les téléphones déjà abonnés devront réactiver les notifications.'));
}
