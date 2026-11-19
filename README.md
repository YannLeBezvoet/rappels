# rappels

Envoie sur ton téléphone les rappels écrits dans tes notes Markdown, depuis une Action GitHub, sans service de notification tiers.

Tes notes restent dans ton propre dépôt privé. Ce dépôt fournit :

- `moteur/` : lit les notes, repère les rappels arrivés à échéance et les envoie en Web Push, sans dépendance ;
- `app/` : une petite appli web installable (PWA) qui reçoit les notifications, publiée sur GitHub Pages ;
- `outils/` : création des clés et notification de test, depuis le PC ;
- `action.yml` : l'Action à appeler depuis ton dépôt de notes.

## Écrire un rappel

Dans n'importe quelle note, une tâche avec une date :

```markdown
- [ ] Renouveler le passeport 📅 2026-12-01         ← le matin du jour J
- [ ] Appeler le garage ⏰ 2026-11-25 09:30         ← à l'heure indiquée
- [ ] Payer le loyer 📅 2026-12-05 🔁 every month   ← chaque mois
- [x] Tâche faite                                  ← ignorée
```

C'est la syntaxe des plugins Obsidian Tasks et Reminder. Elle reste lisible dans n'importe quel éditeur.

Précisions :

- `⏰` passe avant `📅` quand les deux sont écrits ;
- une heure est aussi acceptée après `📅` (`📅 2026-12-01 14:00`), et le format par défaut du plugin Reminder fonctionne : `(@2026-11-25 09:30)` ;
- une tâche en cours (`- [/]`) garde son rappel ; une tâche cochée (`- [x]`) ou annulée (`- [-]`) n'en a plus ;
- les blocs de code, l'en-tête YAML et les dossiers cachés (`.obsidian`, `.trash`…) sont ignorés.

## Essayer en local

Il faut Node 22.18 ou plus récent : il exécute le TypeScript directement, sans compilation.

```bash
npm install
npm run rappels -- ~/chemin/vers/tes-notes
```

La commande liste les rappels en retard, ceux des 14 prochains jours, et les dates à corriger. Elle n'envoie rien. Options : `--jours`, `--fuseau`, `--heure-defaut`, `--maintenant` (détail avec `--aide`).

```bash
npm test            # tests
npm run typecheck   # vérification des types
```

## Recevoir les notifications sur le téléphone

1. **Les clés**, une seule fois, sur le PC :

   ```bash
   npm run cles
   ```

   La clé privée est rangée dans `.env`, qui n'est jamais commité. La clé publique est écrite dans `app/config.json`, publiée avec l'appli.

2. **Publier l'appli** : dans les réglages du dépôt, *Settings → Pages → Source : GitHub Actions*. Chaque push qui touche `app/` la republie à l'adresse https://yannlebezvoet.github.io/rappels/.

3. **Sur le téléphone**, ouvre cette adresse :
   - Android : dans Chrome ou Firefox ;
   - iPhone : iOS 16.4 au minimum ; ajoute d'abord la page à l'écran d'accueil, puis ouvre-la depuis l'icône.

   Touche « Activer les notifications », autorise-les, puis envoie-toi le texte affiché (par mail ou dans une note).

4. **Sur le PC**, colle ce texte dans un fichier `abonnements.json` à la racine de ce dossier. Il est ignoré par git. Puis :

   ```bash
   npm run notif-test
   ```

   La notification « Ça marche ! » arrive sur le téléphone. Pour plusieurs appareils, mets les textes dans une liste : `[ {...}, {...} ]`.

## Brancher l'Action sur le dépôt de notes

1. Dans le dépôt de notes, ajoute deux secrets (*Settings → Secrets and variables → Actions*) :
   - `VAPID_PRIVATE_KEY` : la valeur après `VAPID_PRIVATE_KEY=` dans le fichier `.env` ;
   - `PUSH_SUBSCRIPTIONS` : le contenu de `abonnements.json`.
2. Ajoute `.github/workflows/rappels.yml` :

   ```yaml
   name: Rappels
   on:
     schedule:
       - cron: '7,27,47 * * * *'
     workflow_dispatch:
   concurrency:
     group: rappels
     cancel-in-progress: false
   permissions:
     contents: read
   jobs:
     rappels:
       runs-on: ubuntu-latest
       timeout-minutes: 5
       steps:
         - uses: actions/checkout@v7
         - uses: YannLeBezvoet/rappels@v1
           with:
             vapid-private-key: ${{ secrets.VAPID_PRIVATE_KEY }}
             subscriptions: ${{ secrets.PUSH_SUBSCRIPTIONS }}
             timezone: Europe/Paris
   ```

   Garde ce fichier dans un dépôt **privé** : le journal des Actions d'un dépôt public est lisible par tous.

À chaque passage, l'Action lit les notes et envoie les rappels dont c'est l'heure : jusqu'à 10 minutes avant, ou en rattrapage jusqu'à 24 heures après s'ils ne sont pas encore partis. Elle retient les rappels envoyés dans son cache pour ne jamais les renvoyer. Le résumé du passage, dans l'onglet Actions, liste les rappels envoyés et les prochains.

Réglages facultatifs (`with:`) :

| Nom | Défaut | Rôle |
| --- | --- | --- |
| `notes` | `.` | dossier des notes dans le dépôt |
| `timezone` | `Europe/Paris` | fuseau horaire des dates écrites |
| `default-time` | `08:00` | heure des rappels écrits sans heure |
| `advance-minutes` | `10` | avance maximale d'un envoi |
| `catch-up-hours` | `24` | retard maximal d'un envoi |
| `contact` | adresse de l'Action | contact donné aux services de push |
| `dry-run` | `false` | `true` : affiche ce qui partirait, sans rien envoyer |

Trois passages par heure font environ 2 200 minutes d'Actions par mois : c'est dans le quota de GitHub Pro (3 000), pas dans celui d'un compte gratuit (2 000). Avec un compte gratuit, passe à deux passages par heure (`'7,37 * * * *'`).

## État

En construction.

1. ~~Le moteur, en local : lecture des notes et liste des prochains rappels.~~ Fait.
2. ~~L'appli et les clés : abonnement depuis le téléphone, notification de test.~~ Fait.
3. L'Action, de bout en bout. En cours : il reste le premier passage sur GitHub.
4. Bonus : rappels récurrents, boutons « Fait » et « Reporter », tâches du jour.

## Licence

MIT
