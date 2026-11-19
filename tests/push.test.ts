import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, verify } from 'node:crypto';
import { test } from 'node:test';
import { lireAbonnements } from '../moteur/abonnements.ts';
import {
  chiffrer,
  clesDepuisPrivee,
  envoyer,
  genererCles,
  jetonVapid,
  TAILLE_MAX,
  type Abonnement,
  type OptionsEnvoi,
} from '../moteur/push.ts';

const b64 = (texte: string) => Buffer.from(texte, 'base64url');

/** Un faux appareil : ses clés, et de quoi lire les messages qu'on lui envoie. */
function appareil() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  const abonnement: Abonnement = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc:def',
    keys: { p256dh: ecdh.getPublicKey('base64url'), auth: auth.toString('base64url') },
  };
  return { abonnement, lire: (corps: Buffer) => dechiffrer(corps, ecdh.getPrivateKey(), auth) };
}

/** Déchiffrement côté appareil (RFC 8291), écrit à part pour vérifier l'envoi. */
function dechiffrer(corps: Buffer, clePrivee: Buffer, auth: Buffer): string {
  const sel = corps.subarray(0, 16);
  const longueurCle = corps[20]!;
  const cleExpediteur = corps.subarray(21, 21 + longueurCle);
  const chiffre = corps.subarray(21 + longueurCle);
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(clePrivee);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), cleExpediteur]);
  const ikm = Buffer.from(hkdfSync('sha256', ecdh.computeSecret(cleExpediteur), auth, info, 32));
  const cle = Buffer.from(hkdfSync('sha256', ikm, sel, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, sel, Buffer.from('Content-Encoding: nonce\0'), 12));
  const dechiffreur = createDecipheriv('aes-128-gcm', cle, nonce);
  dechiffreur.setAuthTag(chiffre.subarray(-16));
  const clair = Buffer.concat([dechiffreur.update(chiffre.subarray(0, -16)), dechiffreur.final()]);
  assert.equal(clair.at(-1), 2, 'délimiteur de dernier enregistrement');
  return clair.subarray(0, -1).toString();
}

test("chiffrement : exemple de la RFC 8291, à l'octet près", () => {
  const attendu = b64(
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
  );
  const abonnement: Abonnement = {
    endpoint: 'https://push.example.net/push/JzLQ3raZJfFBR0aqvOMsLrt54w4rJUsV',
    keys: {
      p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
      auth: 'BTBZMqHH6r4Tts7J_aSIgg',
    },
  };
  const corps = chiffrer(Buffer.from('When I grow up, I want to be a watermelon'), abonnement, {
    sel: attendu.subarray(0, 16),
    clePrivee: b64('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'),
  });
  assert.equal(corps.toString('base64url'), attendu.toString('base64url'));
  assert.equal(
    dechiffrer(corps, b64('q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94'), b64('BTBZMqHH6r4Tts7J_aSIgg')),
    'When I grow up, I want to be a watermelon',
  );
});

test('chiffrement : deux envois du même message ne se ressemblent pas', () => {
  const { abonnement, lire } = appareil();
  const a = chiffrer(Buffer.from('coucou'), abonnement);
  const b = chiffrer(Buffer.from('coucou'), abonnement);
  assert.notDeepEqual(a, b);
  assert.equal(lire(a), 'coucou');
  assert.equal(lire(b), 'coucou');
});

test('clés VAPID : la clé publique se retrouve à partir de la privée', () => {
  const cles = genererCles();
  assert.equal(b64(cles.publique).length, 65);
  assert.equal(b64(cles.privee).length, 32);
  assert.deepEqual(clesDepuisPrivee(cles.privee), cles);
  assert.throws(() => clesDepuisPrivee('trop-court'), /Clé privée VAPID invalide/);
});

test('jeton VAPID signé par la clé privée, vérifiable avec la publique', () => {
  const cles = genererCles();
  const jeton = jetonVapid('https://fcm.googleapis.com', 'https://example.org', cles, new Date('2026-11-20T12:00:00Z'));
  const [entete, charge, signature] = jeton.split('.') as [string, string, string];
  assert.deepEqual(JSON.parse(b64(entete).toString()), { typ: 'JWT', alg: 'ES256' });
  assert.deepEqual(JSON.parse(b64(charge).toString()), {
    aud: 'https://fcm.googleapis.com',
    exp: Date.parse('2026-11-20T12:00:00Z') / 1000,
    sub: 'https://example.org',
  });
  const publique = b64(cles.publique);
  const cle = createPublicKey({
    format: 'jwk',
    key: { kty: 'EC', crv: 'P-256', x: publique.subarray(1, 33).toString('base64url'), y: publique.subarray(33).toString('base64url') },
  });
  const valide = verify('sha256', Buffer.from(`${entete}.${charge}`), { key: cle, dsaEncoding: 'ieee-p1363' }, b64(signature));
  assert.ok(valide);
});

/** Faux service de push : garde la requête et répond avec le code demandé. */
function service(statut: number, reponse = '') {
  const requetes: { url: string; entetes: Headers; corps: Buffer }[] = [];
  const faux = (async (url: string | URL | Request, init?: RequestInit) => {
    requetes.push({ url: String(url), entetes: new Headers(init?.headers), corps: Buffer.from(init?.body as Uint8Array) });
    return new Response(reponse || null, { status: statut });
  }) as typeof fetch;
  return { faux, requetes };
}

const cles = genererCles();
const options = (faux: typeof fetch): OptionsEnvoi => ({ cles, contact: 'https://example.org', fetch: faux });

test("envoi : en-têtes attendus par le service, message lisible par l'appareil", async () => {
  const { abonnement, lire } = appareil();
  const { faux, requetes } = service(201);
  const resultat = await envoyer(abonnement, { titre: 'Appeler le garage', corps: 'mer. 25 nov., 09:30' }, options(faux));
  assert.deepEqual(resultat, { ok: true, expire: false, statut: 201, explication: 'envoyé' });

  const [requete] = requetes;
  assert.ok(requete);
  assert.equal(requete.url, abonnement.endpoint);
  assert.match(requete.entetes.get('authorization')!, new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${cles.publique}$`));
  assert.equal(requete.entetes.get('content-encoding'), 'aes128gcm');
  assert.equal(requete.entetes.get('ttl'), '86400');
  assert.equal(requete.entetes.get('urgency'), 'high');
  assert.deepEqual(JSON.parse(lire(requete.corps)), { titre: 'Appeler le garage', corps: 'mer. 25 nov., 09:30' });
});

test('envoi : les refus du service sont expliqués', async () => {
  const { abonnement } = appareil();
  const message = { titre: 'Test' };

  const expire = await envoyer(abonnement, message, options(service(410).faux));
  assert.equal(expire.ok, false);
  assert.equal(expire.expire, true);
  assert.match(expire.explication, /réabonne/);

  const refuse = await envoyer(abonnement, message, options(service(403, 'the key in the authorization header\ndoes not correspond').faux));
  assert.equal(refuse.expire, false);
  assert.match(refuse.explication, /clé publique de l’appli ne correspond pas.*réponse : the key in the authorization header does not/);

  const enPanne = (async () => {
    throw new TypeError('fetch failed');
  }) as typeof fetch;
  const injoignable = await envoyer(abonnement, message, options(enPanne));
  assert.equal(injoignable.statut, 0);
  assert.match(injoignable.explication, /injoignable \(fetch failed\)/);
});

test('envoi : message trop long refusé avant tout envoi', async () => {
  const { abonnement } = appareil();
  const { faux, requetes } = service(201);
  const resultat = await envoyer(abonnement, { titre: 'x'.repeat(TAILLE_MAX) }, options(faux));
  assert.equal(resultat.ok, false);
  assert.match(resultat.explication, /trop long/);
  assert.equal(requetes.length, 0);
});

test("abonnements : un seul, ou une liste, tels que copiés depuis l'appli", () => {
  const { abonnement } = appareil();
  const copie = JSON.stringify({ ...abonnement, expirationTime: null });
  assert.deepEqual(lireAbonnements(copie), [abonnement]);
  assert.deepEqual(lireAbonnements(`[${copie}, ${copie}]`), [abonnement, abonnement]);
});

test('abonnements : erreurs de copie expliquées', () => {
  const { abonnement } = appareil();
  assert.throws(() => lireAbonnements('{"endpoint": "https://'), /JSON valide/);
  assert.throws(() => lireAbonnements('[]'), /vide/);
  assert.throws(() => lireAbonnements('{}'), /incomplet/);
  assert.throws(() => lireAbonnements(JSON.stringify({ ...abonnement, endpoint: 'http://exemple.fr' })), /https/);
  const tronque = { ...abonnement, keys: { ...abonnement.keys, p256dh: abonnement.keys.p256dh.slice(0, 40) } };
  assert.throws(() => lireAbonnements(JSON.stringify([abonnement, tronque])), /n°2 : p256dh invalide/);
});
