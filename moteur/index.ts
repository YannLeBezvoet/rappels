// Point d'entrée du moteur : lit un dossier de notes et sélectionne les rappels.

import { lireNote, type Lecture, type OptionsLecture, type Probleme, type Rappel } from './lecture.ts';
import { parcourirNotes } from './notes.ts';

export type { Lecture, OptionsLecture, Priorite, Probleme, Rappel } from './lecture.ts';
export { lireNote } from './lecture.ts';

export interface LectureDossier extends Lecture {
  /** Nombre de notes lues. */
  notes: number;
}

/** Ordre chronologique, puis par fichier et par ligne. */
export function parDate(a: Rappel, b: Rappel): number {
  return a.quand.getTime() - b.quand.getTime() || a.fichier.localeCompare(b.fichier) || a.ligne - b.ligne;
}

export async function lireDossier(racine: string, options: OptionsLecture): Promise<LectureDossier> {
  const rappels: Rappel[] = [];
  const problemes: Probleme[] = [];
  let notes = 0;
  for await (const note of parcourirNotes(racine)) {
    notes++;
    const lecture = lireNote(note.chemin, note.contenu, options);
    rappels.push(...lecture.rappels);
    problemes.push(...lecture.problemes);
  }
  rappels.sort(parDate);
  return { rappels, problemes, notes };
}

/** Rappels dont l'heure tombe après `apres` (exclu) et jusqu'à `jusqua` (inclus). */
export function entre(rappels: readonly Rappel[], apres: Date, jusqua: Date): Rappel[] {
  return rappels
    .filter((r) => r.quand.getTime() > apres.getTime() && r.quand.getTime() <= jusqua.getTime())
    .sort(parDate);
}
