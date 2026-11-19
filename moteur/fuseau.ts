// Conversions entre l'heure lue sur une horloge d'un fuseau (« 09:30 à Paris »)
// et un instant précis en UTC, sans bibliothèque externe.

export interface JourHeure {
  annee: number;
  /** De 1 à 12. */
  mois: number;
  jour: number;
  heure: number;
  minute: number;
}

const formateurs = new Map<string, Intl.DateTimeFormat>();

function formateurNumerique(fuseau: string): Intl.DateTimeFormat {
  let formateur = formateurs.get(fuseau);
  if (!formateur) {
    formateur = new Intl.DateTimeFormat('en-US', {
      timeZone: fuseau,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formateurs.set(fuseau, formateur);
  }
  return formateur;
}

export function fuseauValide(fuseau: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: fuseau });
    return true;
  } catch {
    return false;
  }
}

/** Ce qu'affiche une horloge du fuseau à cet instant. */
export function versJourHeure(instant: Date, fuseau: string): JourHeure & { seconde: number } {
  const p: Record<string, number> = {};
  for (const morceau of formateurNumerique(fuseau).formatToParts(instant)) {
    if (morceau.type !== 'literal') p[morceau.type] = Number(morceau.value);
  }
  return {
    annee: p.year ?? 0,
    mois: p.month ?? 0,
    jour: p.day ?? 0,
    heure: p.hour ?? 0,
    minute: p.minute ?? 0,
    seconde: p.second ?? 0,
  };
}

/** Écart en minutes entre l'heure du fuseau et UTC à cet instant (Paris : 60 en hiver, 120 en été). */
export function decalage(instant: Date, fuseau: string): number {
  const ms = Math.floor(instant.getTime() / 1000) * 1000;
  const h = versJourHeure(new Date(ms), fuseau);
  return (Date.UTC(h.annee, h.mois - 1, h.jour, h.heure, h.minute, h.seconde) - ms) / 60_000;
}

/**
 * Instant correspondant à une heure d'horloge dans un fuseau.
 * Une heure qui n'existe pas (passage à l'heure d'été) est décalée d'une heure plus tard.
 * Une heure qui existe deux fois (passage à l'heure d'hiver) donne l'une des deux.
 */
export function versInstant(h: JourHeure, fuseau: string): Date {
  const commeSiUtc = Date.UTC(h.annee, h.mois - 1, h.jour, h.heure, h.minute);
  const premier = decalage(new Date(commeSiUtc), fuseau);
  let instant = commeSiUtc - premier * 60_000;
  const second = decalage(new Date(instant), fuseau);
  if (second !== premier) instant = commeSiUtc - second * 60_000;
  return new Date(instant);
}

/** Date lisible en français, par exemple « mar. 25 nov., 09:30 ». */
export function formaterDate(instant: Date, fuseau: string, avecAnnee = false, avecHeure = true): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: fuseau,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    ...(avecAnnee ? { year: 'numeric' as const } : {}),
    ...(avecHeure ? { hour: '2-digit' as const, minute: '2-digit' as const } : {}),
  }).format(instant);
}
