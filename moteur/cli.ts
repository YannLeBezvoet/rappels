// Liste les rappels trouvés dans un dossier de notes, sans rien envoyer.
// Utilisation : npm run rappels -- <dossier> [options]   (détail : --aide)

import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs, styleText } from 'node:util';
import { formaterDate, fuseauValide, versInstant, versJourHeure } from './fuseau.ts';
import { lireDossier, type Rappel } from './index.ts';
import { lireDate, lireHeure } from './lecture.ts';

const AIDE = `Liste les rappels trouvés dans un dossier de notes Markdown, sans rien envoyer.

Utilisation :
  npm run rappels -- <dossier> [options]

Options :
  --jours <n>             nombre de jours à afficher (défaut : 14)
  --fuseau <nom>          fuseau horaire (défaut : Europe/Paris)
  --heure-defaut <hh:mm>  heure des rappels écrits sans heure (défaut : 08:00)
  --maintenant <date>     fait comme si on était à cette date, ex. 2026-11-25T09:00
  -h, --aide              affiche cette aide`;

const MAX_EN_RETARD = 20;

function quitter(message: string): never {
  console.error(`${message}\n\nPour l'aide : npm run rappels -- --aide`);
  process.exit(1);
}

function pluriel(n: number, mot: string): string {
  return `${n} ${mot}${n > 1 ? 's' : ''}`;
}

function lireArguments() {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        jours: { type: 'string', default: '14' },
        fuseau: { type: 'string', default: 'Europe/Paris' },
        'heure-defaut': { type: 'string', default: '08:00' },
        maintenant: { type: 'string' },
        aide: { type: 'boolean', short: 'h' },
      },
    });
  } catch (e) {
    return quitter(e instanceof Error ? e.message : String(e));
  }
}

function lireMaintenant(texte: string | undefined, fuseau: string): Date {
  if (texte === undefined) return new Date();
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{1,2}:\d{2}))?$/.exec(texte);
  const date = m ? lireDate(m[1]!) : null;
  const heure = m?.[2] ? lireHeure(m[2]) : { heure: 0, minute: 0 };
  if (!date || !heure) return quitter(`Date invalide pour --maintenant : ${texte} (exemple : 2026-11-25T09:00)`);
  return versInstant({ ...date, ...heure }, fuseau);
}

const { values, positionals } = lireArguments();
if (values.aide) {
  console.log(AIDE);
  process.exit(0);
}

const dossier = positionals[0];
if (!dossier) quitter('Indique le dossier de notes à lire.');
if (positionals.length > 1) quitter(`Un seul dossier à la fois (reçu : ${positionals.join(', ')}).`);

const fuseau = values.fuseau;
if (!fuseauValide(fuseau)) quitter(`Fuseau horaire inconnu : ${fuseau} (exemple : Europe/Paris)`);

const jours = Number(values.jours);
if (!Number.isInteger(jours) || jours < 1) quitter(`Nombre de jours invalide : ${values.jours}`);

const heureParDefaut = values['heure-defaut'];
if (!lireHeure(heureParDefaut)) quitter(`Heure par défaut invalide : ${heureParDefaut} (attendu : HH:MM)`);

const maintenant = lireMaintenant(values.maintenant, fuseau);

const infos = await stat(dossier).catch(() => null);
if (!infos?.isDirectory()) quitter(`Dossier introuvable : ${dossier}`);

const lecture = await lireDossier(dossier, { fuseau, heureParDefaut });

const limite = new Date(maintenant.getTime() + jours * 86_400_000);
const anneeEnCours = versJourHeure(maintenant, fuseau).annee;
const dateDe = (r: Rappel) => formaterDate(r.quand, fuseau, versJourHeure(r.quand, fuseau).annee !== anneeEnCours);
const gras = (texte: string) => styleText('bold', texte);
const discret = (texte: string) => styleText('dim', texte);

const enRetard = lecture.rappels.filter((r) => r.quand.getTime() <= maintenant.getTime());
const prochains = lecture.rappels.filter((r) => r.quand > maintenant && r.quand.getTime() <= limite.getTime());
const plusTard = lecture.rappels.filter((r) => r.quand.getTime() > limite.getTime());

function afficher(rappels: Rappel[]): void {
  const dates = rappels.map(dateDe);
  const largeur = Math.max(...dates.map((d) => d.length));
  rappels.forEach((r, i) => {
    const details = [r.priorite && `priorité ${r.priorite}`, r.repetition && `🔁 ${r.repetition}`]
      .filter(Boolean)
      .join(', ');
    const suffixe = details ? discret(` (${details})`) : '';
    console.log(`  ${dates[i]!.padEnd(largeur)}  ${r.titre}${suffixe}  ${discret(`${r.fichier}:${r.ligne}`)}`);
  });
}

console.log(`${pluriel(lecture.rappels.length, 'rappel')} dans ${pluriel(lecture.notes, 'note')} (${resolve(dossier)})`);
console.log(discret(`Maintenant : ${formaterDate(maintenant, fuseau, true)}, ${fuseau}`));

if (enRetard.length > 0) {
  console.log(`\n${gras('En retard')}`);
  const caches = enRetard.length - MAX_EN_RETARD;
  if (caches > 0) console.log(discret(`  … et ${pluriel(caches, 'rappel')} plus ancien${caches > 1 ? 's' : ''}`));
  afficher(enRetard.slice(-MAX_EN_RETARD));
}

console.log(`\n${gras(jours === 1 ? 'Dans les prochaines 24 heures' : `Dans les ${jours} prochains jours`)}`);
if (prochains.length > 0) afficher(prochains);
else console.log(discret('  Rien de prévu.'));

const prochainPlusTard = plusTard[0];
if (prochainPlusTard) {
  console.log(`\n${gras('Plus tard')} : ${pluriel(plusTard.length, 'rappel')}, le prochain le ${dateDe(prochainPlusTard)}.`);
}

if (lecture.problemes.length > 0) {
  console.log(`\n${styleText('yellow', gras('À corriger'))}`);
  for (const p of lecture.problemes) console.log(`  ${p.fichier}:${p.ligne}  ${p.message}`);
}
