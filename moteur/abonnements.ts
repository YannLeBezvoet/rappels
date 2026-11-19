// Lecture des abonnements copiés depuis l'appli (un seul, ou une liste pour plusieurs appareils).

import { decoder, type Abonnement } from './push.ts';

function verifier(donnee: unknown, nom: string): Abonnement {
  const objet = (typeof donnee === 'object' && donnee !== null ? donnee : {}) as Record<string, unknown>;
  const cles = (typeof objet.keys === 'object' && objet.keys !== null ? objet.keys : {}) as Record<string, unknown>;
  const { endpoint } = objet;
  const { p256dh, auth } = cles;

  if (typeof endpoint !== 'string' || typeof p256dh !== 'string' || typeof auth !== 'string') {
    throw new Error(`${nom} est incomplet : il faut "endpoint", "keys.p256dh" et "keys.auth".`);
  }
  let adresse: URL;
  try {
    adresse = new URL(endpoint);
  } catch {
    throw new Error(`${nom} : adresse "endpoint" illisible.`);
  }
  if (adresse.protocol !== 'https:') throw new Error(`${nom} : l'adresse "endpoint" doit commencer par https://.`);
  try {
    decoder(p256dh, 65, 'p256dh');
    decoder(auth, 16, 'auth');
  } catch (e) {
    throw new Error(`${nom} : ${(e as Error).message}.`);
  }
  return { endpoint, keys: { p256dh, auth } };
}

/** Lit un abonnement ou une liste d'abonnements au format JSON. Lève une erreur claire sinon. */
export function lireAbonnements(texte: string): Abonnement[] {
  let donnees: unknown;
  try {
    donnees = JSON.parse(texte);
  } catch {
    throw new Error("Ce n'est pas du JSON valide : copie le texte affiché par l'appli, en entier.");
  }
  const liste: unknown[] = Array.isArray(donnees) ? donnees : [donnees];
  if (liste.length === 0) throw new Error('La liste des abonnements est vide.');
  return liste.map((a, i) => verifier(a, liste.length > 1 ? `L'abonnement n°${i + 1}` : "L'abonnement"));
}
