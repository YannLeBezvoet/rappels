// Parcourt un dossier de notes et renvoie chaque fichier .md.
// Les dossiers cachés (.git, .obsidian, .trash…) et node_modules sont ignorés.

import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

export interface Note {
  /** Chemin relatif au dossier de notes, avec des « / ». */
  chemin: string;
  contenu: string;
}

export async function* parcourirNotes(racine: string): AsyncGenerator<Note> {
  async function* visiter(dossier: string): AsyncGenerator<Note> {
    const entrees = await readdir(dossier, { withFileTypes: true });
    entrees.sort((a, b) => a.name.localeCompare(b.name));
    for (const entree of entrees) {
      if (entree.name.startsWith('.') || entree.name === 'node_modules') continue;
      const chemin = join(dossier, entree.name);
      if (entree.isDirectory()) {
        yield* visiter(chemin);
      } else if (entree.isFile() && entree.name.toLowerCase().endsWith('.md')) {
        yield {
          chemin: relative(racine, chemin).split(sep).join('/'),
          contenu: await readFile(chemin, 'utf8'),
        };
      }
    }
  }
  yield* visiter(racine);
}
