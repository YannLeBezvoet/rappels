# rappels

Envoie sur ton téléphone les rappels écrits dans tes notes Markdown, depuis une Action GitHub, sans service de notification tiers.

Tes notes restent dans ton propre dépôt privé. Ce dépôt fournit :

- `moteur/` : lit les notes, repère les rappels arrivés à échéance et les envoie en Web Push ;
- `app/` : une petite appli web installable (PWA) qui reçoit les notifications, publiée sur GitHub Pages ;
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

## Utilisation (bientôt)

Dans ton dépôt de notes, `.github/workflows/rappels.yml` :

```yaml
on:
  schedule: [{ cron: "7,27,47 * * * *" }]
  workflow_dispatch:
jobs:
  rappels:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: YannLeBezvoet/rappels@v1
        with:
          vapid-private-key: ${{ secrets.VAPID_PRIVATE_KEY }}
          subscriptions: ${{ secrets.PUSH_SUBSCRIPTIONS }}
          timezone: Europe/Paris
```

## État

En construction.

1. ~~Le moteur, en local : lecture des notes et liste des prochains rappels.~~ Fait.
2. L'appli et les clés : abonnement depuis le téléphone, notification de test.
3. L'Action, de bout en bout.
4. Bonus : rappels récurrents, boutons « Fait » et « Reporter », tâches du jour.

## Licence

MIT
