// Lecture d'une note Markdown : repère les tâches ouvertes qui portent une date.
//
//   - [ ] Renouveler le passeport 📅 2026-12-01          → le jour J, à l'heure par défaut
//   - [ ] Appeler le garage ⏰ 2026-11-25 09:30          → à l'heure indiquée
//   - [ ] Sortir les poubelles (@2026-11-25 19:45)        → format par défaut du plugin Reminder
//   - [ ] Payer le loyer 📅 2026-12-05 🔁 every month ⏫  → répétition et priorité (plugin Tasks)
//
// Sont ignorés : les tâches cochées ou annulées, les blocs de code et l'en-tête YAML.

import { createHash } from 'node:crypto';
import { versInstant } from './fuseau.ts';

export type Priorite = 'maximale' | 'haute' | 'moyenne' | 'basse' | 'minimale';

export interface Rappel {
  /** Même titre et même moment donnent le même identifiant, où que soit la note. */
  id: string;
  titre: string;
  quand: Date;
  /** Vrai si une heure était écrite ; faux si c'est l'heure par défaut. */
  heurePrecise: boolean;
  /** Chemin de la note, relatif au dossier de notes. */
  fichier: string;
  /** Numéro de ligne, à partir de 1. */
  ligne: number;
  priorite?: Priorite;
  /** Texte après 🔁, par exemple « every month ». Pas encore interprété. */
  repetition?: string;
}

export interface Probleme {
  fichier: string;
  ligne: number;
  message: string;
}

export interface OptionsLecture {
  /** Fuseau horaire des dates écrites dans les notes, par exemple « Europe/Paris ». */
  fuseau: string;
  /** Heure des rappels écrits sans heure, au format HH:MM. */
  heureParDefaut: string;
}

export interface Lecture {
  rappels: Rappel[];
  problemes: Probleme[];
}

// Puce (-, *, +) ou numéro (1. ou 1)), éventuellement dans une citation (>), puis [statut].
const TACHE = /^\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[(.)\]\s+(.*)$/u;
// Statuts du plugin Tasks : « » à faire, « / » en cours, « x » faite, « - » annulée.
const STATUTS_OUVERTS = new Set([' ', '/']);
const DEBUT_CODE = /^\s*(?:>\s*)*(`{3,}|~{3,})/;
const FIN_CODE = /^\s*(?:>\s*)*(`{3,}|~{3,})\s*$/;
// Champs du plugin Tasks, plus ⏰ du plugin Reminder.
const CHAMP = /(📅|⏰|🔁|⏳|🛫|✅|➕|❌|🆔|⛔|🏁|🔺|⏫|🔼|🔽|⏬)️?/gu;
const FORMAT_REMINDER = /\(@(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?\)/u;
const DATE_ET_HEURE = /^(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?(.*)$/su;
const ID_DE_BLOC = /(?:^|\s)\^[A-Za-z0-9-]+\s*$/;
const ETIQUETTE = /#[^\s#]+/g;
const PRIORITES: Record<string, Priorite> = {
  '🔺': 'maximale',
  '⏫': 'haute',
  '🔼': 'moyenne',
  '🔽': 'basse',
  '⏬': 'minimale',
};

interface DateEcrite {
  date: string;
  heure?: string;
}

interface Champs {
  titre: string;
  echeance?: DateEcrite;
  alarme?: DateEcrite;
  repetition?: string;
  priorite?: Priorite;
  erreurs: string[];
}

export function lireDate(texte: string): { annee: number; mois: number; jour: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texte);
  if (!m) return null;
  const annee = Number(m[1]);
  const mois = Number(m[2]);
  const jour = Number(m[3]);
  const d = new Date(Date.UTC(annee, mois - 1, jour));
  const existe = d.getUTCFullYear() === annee && d.getUTCMonth() === mois - 1 && d.getUTCDate() === jour;
  return existe ? { annee, mois, jour } : null;
}

export function lireHeure(texte: string): { heure: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(texte);
  if (!m) return null;
  const heure = Number(m[1]);
  const minute = Number(m[2]);
  return heure <= 23 && minute <= 59 ? { heure, minute } : null;
}

/** Sépare le titre d'une tâche de ses champs (date, heure, répétition, priorité…). */
export function analyserTache(texte: string): Champs {
  const champs: Champs = { titre: '', erreurs: [] };
  const morceauxDuTitre: string[] = [];

  const reminder = FORMAT_REMINDER.exec(texte);
  if (reminder) {
    champs.alarme = { date: reminder[1]!, ...(reminder[2] ? { heure: reminder[2] } : {}) };
    texte = texte.slice(0, reminder.index) + texte.slice(reminder.index + reminder[0].length);
  }

  const trouves = [...texte.matchAll(CHAMP)];
  morceauxDuTitre.push(texte.slice(0, trouves[0]?.index ?? texte.length));

  trouves.forEach((trouve, i) => {
    const emoji = trouve[1]!;
    const debut = trouve.index + trouve[0].length;
    const fin = trouves[i + 1]?.index ?? texte.length;
    const valeur = texte.slice(debut, fin).trim();

    if (emoji === '📅' || emoji === '⏰') {
      const m = DATE_ET_HEURE.exec(valeur);
      if (!m) {
        champs.erreurs.push(`date illisible après ${emoji} : « ${valeur} » (attendu : AAAA-MM-JJ)`);
        return;
      }
      const ecrite: DateEcrite = { date: m[1]!, ...(m[2] ? { heure: m[2] } : {}) };
      if (emoji === '📅') champs.echeance = ecrite;
      else champs.alarme = ecrite;
      morceauxDuTitre.push(m[3] ?? '');
    } else if (emoji === '🔁') {
      const repetition = valeur.replace(ETIQUETTE, '').replace(ID_DE_BLOC, '').trim();
      if (repetition) champs.repetition = repetition;
      else champs.erreurs.push('répétition vide après 🔁');
      morceauxDuTitre.push((valeur.match(ETIQUETTE) ?? []).join(' '));
    } else if (emoji in PRIORITES) {
      champs.priorite = PRIORITES[emoji];
      morceauxDuTitre.push(valeur);
    } else {
      // Autres champs du plugin Tasks (dates de début, de fin…) : seules les étiquettes restent dans le titre.
      morceauxDuTitre.push((valeur.match(ETIQUETTE) ?? []).join(' '));
    }
  });

  champs.titre = morceauxDuTitre.join(' ').replace(/\s+/g, ' ').replace(ID_DE_BLOC, '').trim();
  return champs;
}

function identifiant(titre: string, quand: Date): string {
  return createHash('sha256').update(`${titre}\n${quand.toISOString()}`).digest('hex').slice(0, 12);
}

export function lireNote(fichier: string, contenu: string, options: OptionsLecture): Lecture {
  const heureParDefaut = lireHeure(options.heureParDefaut);
  if (!heureParDefaut) throw new Error(`Heure par défaut invalide : ${options.heureParDefaut} (attendu : HH:MM)`);

  const rappels: Rappel[] = [];
  const problemes: Probleme[] = [];
  const lignes = contenu.replace(/^﻿/, '').split(/\r?\n/);
  let dansEnTete = lignes[0]?.trim() === '---';
  let blocDeCode: string | null = null;

  lignes.forEach((ligne, i) => {
    const numero = i + 1;

    if (dansEnTete) {
      if (i > 0 && (ligne.trim() === '---' || ligne.trim() === '...')) dansEnTete = false;
      return;
    }
    if (blocDeCode) {
      const fin = FIN_CODE.exec(ligne)?.[1];
      if (fin && fin[0] === blocDeCode[0] && fin.length >= blocDeCode.length) blocDeCode = null;
      return;
    }
    const debutCode = DEBUT_CODE.exec(ligne)?.[1];
    if (debutCode) {
      blocDeCode = debutCode;
      return;
    }

    const tache = TACHE.exec(ligne);
    if (!tache || !STATUTS_OUVERTS.has(tache[1]!)) return;

    const champs = analyserTache(tache[2]!);
    const signaler = (message: string) => problemes.push({ fichier, ligne: numero, message });
    champs.erreurs.forEach(signaler);

    if (champs.alarme && champs.echeance && !lireDate(champs.echeance.date)) {
      signaler(`date invalide après 📅 : ${champs.echeance.date}`);
    }
    const choisie = champs.alarme ?? champs.echeance;
    if (!choisie) return;

    const date = lireDate(choisie.date);
    if (!date) {
      signaler(`date invalide : ${choisie.date}`);
      return;
    }
    const heure = choisie.heure === undefined ? heureParDefaut : lireHeure(choisie.heure);
    if (!heure) {
      signaler(`heure invalide : ${choisie.heure}`);
      return;
    }

    const quand = versInstant({ ...date, ...heure }, options.fuseau);
    const titre = champs.titre || '(rappel sans titre)';
    rappels.push({
      id: identifiant(titre, quand),
      titre,
      quand,
      heurePrecise: choisie.heure !== undefined,
      fichier,
      ligne: numero,
      ...(champs.priorite ? { priorite: champs.priorite } : {}),
      ...(champs.repetition ? { repetition: champs.repetition } : {}),
    });
  });

  return { rappels, problemes };
}
