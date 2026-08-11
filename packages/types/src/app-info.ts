export interface AppInfoResponse {
  version: string;
  updateAvailable: boolean | null;
  latestVersion: string | null;
  bookDockPath: string;
  maxUploadSizeMb: number;
  /** When true the app never writes to library storage: no uploads, dock ingest, moves or renames. */
  libraryReadOnly: boolean;
}
