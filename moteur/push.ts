// Envoi de notifications Web Push, sans dépendance :
// - le message est chiffré pour l'appareil (RFC 8291), le service de push ne peut pas le lire ;
// - l'expéditeur se présente avec ses clés VAPID (RFC 8292), les mêmes que celles de l'appli.

import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign, type KeyObject } from 'node:crypto';

/** Abonnement d'un appareil, tel que le donne `PushSubscription.toJSON()` dans le navigateur. */
export interface Abonnement {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Clés VAPID en base64url : la publique (65 octets) est dans l'appli, la privée (32 octets) reste secrète. */
export interface ClesVapid {
  publique: string;
  privee: string;
}

/** Contenu d'une notification, lu par le service worker de l'appli. */
export interface Message {
  titre: string;
  corps?: string;
  /** Une notification avec le même tag remplace la précédente au lieu de s'ajouter. */
  tag?: string;
  /** Page ouverte quand on touche la notification, relative à l'appli. */
  url?: string;
}

export interface OptionsEnvoi {
  cles: ClesVapid;
  /** Contact de l'expéditeur pour le service de push : `https://…` ou `mailto:…`. */
  contact: string;
  /** Temps pendant lequel le service garde le message si l'appareil est éteint, en secondes (défaut : 1 jour). */
  duree?: number;
  /** `high` réveille l'appareil même en économie d'énergie (défaut). */
  urgence?: 'very-low' | 'low' | 'normal' | 'high';
  maintenant?: Date;
  /** Remplace `fetch`, pour les tests. */
  fetch?: typeof fetch;
}

export interface Resultat {
  ok: boolean;
  /** L'abonnement n'existe plus : il faut réabonner l'appareil depuis l'appli. */
  expire: boolean;
  /** Code HTTP renvoyé par le service de push, 0 s'il n'a pas répondu. */
  statut: number;
  explication: string;
}

/** Taille maximale du message en clair : 4096 octets chiffrés, moins l'en-tête (86) et le chiffrement (17). */
export const TAILLE_MAX = 4096 - 86 - 17;
const TAILLE_ENREGISTREMENT = 4096;

/** Décode du base64url (ou base64) et vérifie la longueur. */
export function decoder(texte: string, longueur: number, nom: string): Buffer {
  const octets = /^[A-Za-z0-9_\-+/]+={0,2}$/.test(texte) ? Buffer.from(texte, 'base64url') : null;
  if (!octets || octets.length !== longueur) throw new Error(`${nom} invalide (${longueur} octets en base64url attendus)`);
  return octets;
}

function completer(octets: Buffer, longueur: number): Buffer {
  return octets.length >= longueur ? octets : Buffer.concat([Buffer.alloc(longueur - octets.length), octets]);
}

export function genererCles(): ClesVapid {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { publique: ecdh.getPublicKey('base64url'), privee: completer(ecdh.getPrivateKey(), 32).toString('base64url') };
}

/** Retrouve la clé publique à partir de la clé privée : un seul secret à garder. */
export function clesDepuisPrivee(privee: string): ClesVapid {
  const d = decoder(privee.trim(), 32, 'Clé privée VAPID');
  const ecdh = createECDH('prime256v1');
  try {
    ecdh.setPrivateKey(d);
  } catch {
    throw new Error('Clé privée VAPID invalide');
  }
  return { publique: ecdh.getPublicKey('base64url'), privee: d.toString('base64url') };
}

function cleDeSignature(cles: ClesVapid): KeyObject {
  const publique = decoder(cles.publique, 65, 'Clé publique VAPID');
  return createPrivateKey({
    format: 'jwk',
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: cles.privee,
      x: publique.subarray(1, 33).toString('base64url'),
      y: publique.subarray(33).toString('base64url'),
    },
  });
}

const base64url = (texte: string) => Buffer.from(texte).toString('base64url');

/** Jeton signé qui prouve au service de push que l'envoi vient du détenteur de la clé privée. */
export function jetonVapid(audience: string, contact: string, cles: ClesVapid, expiration: Date): string {
  const entete = base64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const charge = base64url(JSON.stringify({ aud: audience, exp: Math.floor(expiration.getTime() / 1000), sub: contact }));
  const signature = sign('sha256', Buffer.from(`${entete}.${charge}`), {
    key: cleDeSignature(cles),
    dsaEncoding: 'ieee-p1363',
  });
  return `${entete}.${charge}.${signature.toString('base64url')}`;
}

/**
 * Chiffre le message pour l'appareil (content-encoding aes128gcm).
 * `aleas` fixe le sel et la clé éphémère : seulement pour vérifier l'exemple de la RFC.
 */
export function chiffrer(contenu: Uint8Array, abonnement: Abonnement, aleas?: { sel: Buffer; clePrivee: Buffer }): Buffer {
  const cleAppareil = decoder(abonnement.keys.p256dh, 65, 'Clé p256dh de l’abonnement');
  const secretAuth = decoder(abonnement.keys.auth, 16, 'Clé auth de l’abonnement');

  const ecdh = createECDH('prime256v1');
  if (aleas) ecdh.setPrivateKey(aleas.clePrivee);
  else ecdh.generateKeys();
  const cleEphemere = ecdh.getPublicKey();
  let secretPartage: Buffer;
  try {
    secretPartage = ecdh.computeSecret(cleAppareil);
  } catch {
    throw new Error('Clé p256dh de l’abonnement invalide');
  }

  const info = Buffer.concat([Buffer.from('WebPush: info\0'), cleAppareil, cleEphemere]);
  const ikm = Buffer.from(hkdfSync('sha256', secretPartage, secretAuth, info, 32));
  const sel = aleas?.sel ?? randomBytes(16);
  const cle = Buffer.from(hkdfSync('sha256', ikm, sel, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, sel, Buffer.from('Content-Encoding: nonce\0'), 12));

  const chiffreur = createCipheriv('aes-128-gcm', cle, nonce);
  // 0x02 : délimiteur du dernier (et seul) enregistrement.
  const chiffre = Buffer.concat([chiffreur.update(contenu), chiffreur.update(Buffer.of(2)), chiffreur.final(), chiffreur.getAuthTag()]);

  const entete = Buffer.alloc(21);
  sel.copy(entete, 0);
  entete.writeUInt32BE(TAILLE_ENREGISTREMENT, 16);
  entete.writeUInt8(cleEphemere.length, 20);
  return Buffer.concat([entete, cleEphemere, chiffre]);
}

function expliquer(statut: number): string {
  if (statut === 404 || statut === 410) return 'abonnement expiré : réabonne l’appareil depuis l’appli';
  if (statut === 401 || statut === 403)
    return 'refusé : la clé publique de l’appli ne correspond pas à la clé privée utilisée pour l’envoi';
  if (statut === 413) return 'message trop long';
  if (statut === 429) return 'trop de messages envoyés, réessaie plus tard';
  return `erreur ${statut} du service de notification`;
}

/** Envoie une notification à un appareil. Ne lève pas d'erreur réseau : le résultat dit ce qui s'est passé. */
export async function envoyer(abonnement: Abonnement, message: Message, options: OptionsEnvoi): Promise<Resultat> {
  const contenu = Buffer.from(JSON.stringify(message));
  if (contenu.length > TAILLE_MAX) {
    return { ok: false, expire: false, statut: 0, explication: `message trop long (${contenu.length} octets, ${TAILLE_MAX} au plus)` };
  }
  const destination = new URL(abonnement.endpoint);
  const maintenant = options.maintenant ?? new Date();
  const jeton = jetonVapid(destination.origin, options.contact, options.cles, new Date(maintenant.getTime() + 12 * 3600_000));

  let reponse: Response;
  try {
    reponse = await (options.fetch ?? fetch)(destination, {
      method: 'POST',
      headers: {
        Authorization: `vapid t=${jeton}, k=${options.cles.publique}`,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(options.duree ?? 86_400),
        Urgency: options.urgence ?? 'high',
      },
      body: new Uint8Array(chiffrer(contenu, abonnement)),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    const cause = e instanceof Error ? e.message : String(e);
    return { ok: false, expire: false, statut: 0, explication: `service de notification injoignable (${cause})` };
  }

  const statut = reponse.status;
  if (reponse.ok) return { ok: true, expire: false, statut, explication: 'envoyé' };
  const detail = (await reponse.text().catch(() => '')).trim().replace(/\s+/g, ' ').slice(0, 300);
  return {
    ok: false,
    expire: statut === 404 || statut === 410,
    statut,
    explication: expliquer(statut) + (detail ? ` (réponse : ${detail})` : ''),
  };
}
