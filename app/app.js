// Page de l'appli : abonne ce téléphone aux notifications et affiche le texte d'abonnement à copier sur le PC.

const $ = (id) => document.getElementById(id);

const ICONE = 'icones/icone-192.png';
const BADGE = 'icones/badge-96.png';

let enregistrement = null;
let clePublique = null;
let invitationInstallation = null;

function etat(texte, type = '') {
  $('etat-texte').textContent = texte;
  $('etat').dataset.type = type;
}

function versOctets(base64url) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const brut = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(brut, (c) => c.charCodeAt(0));
}

function memesOctets(a, b) {
  if (!a || !b) return false;
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

async function lireClePublique() {
  const reponse = await fetch('config.json', { cache: 'no-cache' });
  if (!reponse.ok) throw new Error(`config.json : ${reponse.status}`);
  const { clePublique } = await reponse.json();
  return versOctets(clePublique);
}

function montrerAbonne(abonnement, nouveau) {
  etat('✓ Ce téléphone recevra les rappels.', 'ok');
  $('activer').hidden = true;
  $('abonnement-texte').value = JSON.stringify(abonnement.toJSON());
  $('abonnement').hidden = false;
  $('abonnement').open = nouveau;
  $('copie-ok').textContent = '';
  $('outils').hidden = false;
  $('desactiver').hidden = false;
}

function montrerInactif(texte, type = '') {
  etat(texte, type);
  $('activer').hidden = Notification.permission === 'denied';
  $('abonnement').hidden = true;
  $('outils').hidden = Notification.permission !== 'granted';
  $('desactiver').hidden = true;
}

function montrerBloque() {
  montrerInactif(
    'Les notifications sont bloquées pour ce site. Dans Chrome : touche le cadenas (ou ⋮ → Infos sur le site) → Autorisations → Notifications, autorise-les, puis recharge la page.',
    'erreur',
  );
}

async function activer() {
  const bouton = $('activer');
  bouton.disabled = true;
  try {
    const permission = await Notification.requestPermission();
    if (permission === 'denied') return montrerBloque();
    if (permission !== 'granted') return montrerInactif('Il faut autoriser les notifications pour recevoir les rappels.');
    const abonnement = await enregistrement.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: clePublique });
    montrerAbonne(abonnement, true);
  } catch (e) {
    etat(`L’abonnement a échoué : ${e.message}`, 'erreur');
  } finally {
    bouton.disabled = false;
  }
}

async function desactiver() {
  const abonnement = await enregistrement.pushManager.getSubscription();
  if (abonnement) await abonnement.unsubscribe();
  montrerInactif('Désactivé : ce téléphone ne recevra plus de rappels. Le texte copié sur le PC ne sert plus.');
}

async function copier() {
  const texte = $('abonnement-texte').value;
  try {
    await navigator.clipboard.writeText(texte);
  } catch {
    $('abonnement-texte').select();
    document.execCommand('copy');
  }
  $('copie-ok').textContent = 'Copié. Colle-le dans un mail ou une note pour le récupérer sur ton PC.';
}

async function partager() {
  try {
    await navigator.share({ title: 'Abonnement Rappels', text: $('abonnement-texte').value });
  } catch {
    // Partage annulé : rien à faire.
  }
}

async function tester() {
  await enregistrement.showNotification('Rappels', {
    body: 'L’affichage fonctionne. Les vrais rappels viendront de ton dépôt de notes.',
    icon: ICONE,
    badge: BADGE,
    tag: 'essai-local',
    lang: 'fr',
  });
}

async function demarrer() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    const iphone = /iPhone|iPad|iPod/.test(navigator.userAgent);
    etat(
      iphone
        ? 'Sur iPhone, ajoute d’abord cette page à l’écran d’accueil (Partager → Sur l’écran d’accueil), puis ouvre-la depuis l’icône.'
        : 'Ce navigateur ne peut pas recevoir de notifications. Sur Android, ouvre cette page dans Chrome ou Firefox.',
      'erreur',
    );
    return;
  }

  try {
    clePublique = await lireClePublique();
  } catch {
    etat('La clé publique de l’appli est introuvable (config.json). Sur le PC : npm run cles, puis publie l’appli.', 'erreur');
    return;
  }

  try {
    await navigator.serviceWorker.register('sw.js');
    enregistrement = await navigator.serviceWorker.ready;
  } catch (e) {
    etat(`Le service worker n’a pas pu démarrer : ${e.message}`, 'erreur');
    return;
  }

  let abonnement = await enregistrement.pushManager.getSubscription();
  let cleChangee = false;
  if (abonnement && !memesOctets(abonnement.options.applicationServerKey, clePublique)) {
    // Les clés ont été refaites sur le PC : l'ancien abonnement ne marchera plus.
    await abonnement.unsubscribe();
    abonnement = null;
    cleChangee = true;
  }

  if (Notification.permission === 'denied') return montrerBloque();
  if (abonnement && Notification.permission === 'granted') return montrerAbonne(abonnement, false);
  montrerInactif(
    cleChangee
      ? 'Les clés de l’appli ont changé : réactive les notifications, puis renvoie le nouveau texte sur ton PC.'
      : 'Ce téléphone ne reçoit pas encore les rappels.',
  );
}

addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  invitationInstallation = event;
  $('installer').hidden = false;
});

$('activer').addEventListener('click', activer);
$('desactiver').addEventListener('click', desactiver);
$('copier').addEventListener('click', copier);
$('tester').addEventListener('click', tester);
$('installer').addEventListener('click', async () => {
  if (!invitationInstallation) return;
  invitationInstallation.prompt();
  await invitationInstallation.userChoice;
  invitationInstallation = null;
  $('installer').hidden = true;
});
if (navigator.share) {
  $('partager').hidden = false;
  $('partager').addEventListener('click', partager);
}

demarrer();
