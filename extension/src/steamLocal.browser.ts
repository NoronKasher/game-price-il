import type { OwnedGame } from '../../server/src/steamLibrary.ts';

/**
 * The local-Steam reader's stand-in for the extension — see steamLocal.ts.
 *
 * Reading `localconfig.vdf` means reading a file off the disk, which an
 * extension cannot do and should not be able to do. There is no clever
 * substitute here and pretending otherwise would drag `node:fs`, and through it
 * SQLite, into a bundle that has neither.
 *
 * So the extension keeps the Web API key route, which works there exactly as it
 * does on a server. What it loses is only the no-key convenience, and the
 * desktop build is where that mattered most anyway: it is the shell that is
 * already sitting on the same machine as the Steam install.
 */

export interface LocalAccount {
  accountId: string;
  steamId64: string;
  personaName?: string;
  lastLogin: number;
}

export interface LocalLibrary {
  games: OwnedGame[];
  account: LocalAccount;
  partial: true;
}

/** No filesystem here; null is the honest answer, not a failure. */
export function localLibraryHere(): LocalLibrary | null {
  return null;
}

export function findSteam(): string | null {
  return null;
}

export function localAccounts(): LocalAccount[] {
  return [];
}
