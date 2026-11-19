// Choix des rappels à envoyer, et mémoire de ceux déjà envoyés pour ne jamais les renvoyer.

import { formaterDate } from './fuseau.ts';
import { parDate } from './index.ts';
import type { Rappel } from './lecture.ts';
import type { Message } from './push.ts';

/** Rappels déjà envoyés : identifiant → heure prévue du rappel (ISO). */
export interface Etat {
  version: 1;
  envoyes: Record<string, string>;
}

/** Moment où un rappel peut partir, autour de son heure. */
export interface Fenetre {
  maintenant: Date;
  /** Un rappel peut partir jusqu'à `avance` ms avant son heure : l'Action ne passe que toutes les 20 minutes. */
  avance: number;
  /** Et jusqu'à `rattrapage` ms après, s'il n'est pas encore parti (Action en retard, note poussée tard). */
  rattrapage: number;
}

export function etatVide(): Etat {
  return { version: 1, envoyes: {} };
}

/** Lit la mémoire enregistrée. Lève une erreur si elle est illisible. */
export function lireEtat(texte: string): Etat {
  const donnees = JSON.parse(texte) as { version?: unknown; envoyes?: unknown } | null;
  if (donnees?.version !== 1 || typeof donnees.envoyes !== 'object' || donnees.envoyes === null) {
    throw new Error('format inconnu');
  }
  const envoyes: Record<string, string> = {};
  for (const [id, quand] of Object.entries(donnees.envoyes)) {
    if (typeof quand === 'string') envoyes[id] = quand;
  }
  return { version: 1, envoyes };
}

/** Rappels dont c'est l'heure et qui ne sont pas encore partis, dans l'ordre chronologique. */
export function aEnvoyer(rappels: readonly Rappel[], etat: Etat, fenetre: Fenetre): Rappel[] {
  const debut = fenetre.maintenant.getTime() - fenetre.rattrapage;
  const fin = fenetre.maintenant.getTime() + fenetre.avance;
  const vus = new Set<string>();
  return rappels
    .filter((r) => {
      const t = r.quand.getTime();
      if (t <= debut || t > fin || Object.hasOwn(etat.envoyes, r.id) || vus.has(r.id)) return false;
      vus.add(r.id);
      return true;
    })
    .sort(parDate);
}

export function noterEnvoi(etat: Etat, rappel: Rappel): void {
  etat.envoyes[rappel.id] = rappel.quand.toISOString();
}

/** Oublie les rappels trop anciens pour repartir, pour que la mémoire reste petite. Renvoie le nombre oublié. */
export function oublierAnciens(etat: Etat, fenetre: Fenetre): number {
  const limite = fenetre.maintenant.getTime() - fenetre.rattrapage - 86_400_000;
  let oublies = 0;
  for (const [id, quand] of Object.entries(etat.envoyes)) {
    if (!(Date.parse(quand) > limite)) {
      delete etat.envoyes[id];
      oublies++;
    }
  }
  return oublies;
}

/** Notification d'un rappel : son titre, puis l'heure prévue et la note d'où il vient. */
export function messagePour(rappel: Rappel, fuseau: string): Message {
  const important = rappel.priorite === 'maximale' || rappel.priorite === 'haute';
  const quand = formaterDate(rappel.quand, fuseau, false, rappel.heurePrecise);
  return {
    titre: `${important ? '❗ ' : ''}${rappel.titre}`,
    corps: `${quand} · ${rappel.fichier}`,
    tag: rappel.id,
  };
}
