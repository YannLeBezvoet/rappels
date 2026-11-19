// Envoie une notification de test aux appareils abonnés, avec les clés de .env.
// Utilisation : npm run notif-test [-- <fichier d'abonnements>] [--titre …] [--texte …]

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs, styleText } from 'node:util';
import { lireAbonnements } from '../moteur/abonnements.ts';
import { clesDepuisPrivee, envoyer, type Abonnement, type ClesVapid } from '../moteur/push.ts';

const AIDE = `Envoie une notification de test aux appareils abonnés.

Utilisation :
  npm run notif-test [-- <fichier> options]

Les abonnements sont lus, dans l'ordre :
  1. dans le fichier indiqué ;
  2. dans la variable d'environnement PUSH_SUBSCRIPTIONS ;
  3. dans abonnements.json, à la racine de ce dossier.

Options :
  --titre <texte>  titre de la notification
  --texte <texte>  texte de la notification
  -h, --aide       affiche cette aide`;

const ENV = fileURLToPath(new URL('../.env', import.meta.url));
const CONFIG = fileURLToPath(new URL('../app/config.json', import.meta.url));
const ABONNEMENTS = fileURLToPath(new URL('../abonnements.json', import.meta.url));

function quitter(message: string): never {
  console.error(`${message}\n\nPour l'aide : npm run notif-test -- --aide`);
  process.exit(1);
}

function lireArguments() {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        titre: { type: 'string', default: '🧠 Ça marche !' },
        texte: { type: 'string', default: 'Les rappels de ton deuxième cerveau arriveront ici.' },
        aide: { type: 'boolean', short: 'h' },
      },
    });
  } catch (e) {
    return quitter(e instanceof Error ? e.message : String(e));
  }
}

function lireCles(): ClesVapid {
  if (existsSync(ENV)) process.loadEnvFile(ENV);
  const privee = process.env.VAPID_PRIVATE_KEY;
  if (!privee) return quitter("Pas de clés VAPID : lance d'abord npm run cles");
  try {
    return clesDepuisPrivee(privee);
  } catch (e) {
    return quitter(`VAPID_PRIVATE_KEY : ${(e as Error).message}`);
  }
}

/** Prévient si l'appli publiée n'utilise pas la même clé : le service de push refuserait l'envoi. */
function verifierConfig(cles: ClesVapid) {
  let publiee: unknown;
  try {
    publiee = JSON.parse(readFileSync(CONFIG, 'utf8')).clePublique;
  } catch {
    publiee = undefined;
  }
  if (publiee !== cles.publique) {
    console.warn(
      styleText('yellow', "Attention : app/config.json n'a pas la clé publique de .env. Lance npm run cles, puis publie l'appli.\n"),
    );
  }
}

function lireListe(fichier: string | undefined): { source: string; abonnements: Abonnement[] } {
  let source: string;
  let texte: string;
  if (fichier) {
    if (!existsSync(fichier)) quitter(`Fichier introuvable : ${fichier}`);
    [source, texte] = [fichier, readFileSync(fichier, 'utf8')];
  } else if (process.env.PUSH_SUBSCRIPTIONS) {
    [source, texte] = ['PUSH_SUBSCRIPTIONS', process.env.PUSH_SUBSCRIPTIONS];
  } else if (existsSync(ABONNEMENTS)) {
    [source, texte] = ['abonnements.json', readFileSync(ABONNEMENTS, 'utf8')];
  } else {
    return quitter(
      "Aucun abonnement. Sur ton téléphone, ouvre l'appli, active les notifications et copie le texte affiché.\n" +
        'Colle-le dans le fichier abonnements.json, à la racine de ce dossier, puis relance la commande.',
    );
  }
  try {
    return { source, abonnements: lireAbonnements(texte) };
  } catch (e) {
    return quitter(`${source} : ${(e as Error).message}`);
  }
}

const { values, positionals } = lireArguments();
if (values.aide) {
  console.log(AIDE);
  process.exit(0);
}
if (positionals.length > 1) quitter('Un seul fichier d’abonnements à la fois.');

const cles = lireCles();
const contact = process.env.VAPID_SUBJECT;
if (!contact) quitter("VAPID_SUBJECT manque dans .env : relance npm run cles");
verifierConfig(cles);

const { source, abonnements } = lireListe(positionals[0]);
console.log(`Envoi à ${abonnements.length} appareil${abonnements.length > 1 ? 's' : ''} (${source})…`);

const message = { titre: values.titre, corps: values.texte, tag: 'test' };
const resultats = await Promise.all(abonnements.map((a) => envoyer(a, message, { cles, contact })));

resultats.forEach((r, i) => {
  const service = new URL(abonnements[i]!.endpoint).host;
  if (r.ok) console.log(`  ${styleText('green', '✔')} ${service} : envoyé`);
  else console.log(`  ${styleText('red', '✘')} ${service} : ${r.explication}`);
});

if (resultats.every((r) => r.ok)) console.log('\nRegarde ton téléphone.');
else process.exitCode = 1;
