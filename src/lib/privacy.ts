import { supabase } from '@/lib/supabase';

/**
 * Data-subject rights: export and erasure.
 *
 * Both operations are authorised in the database. The RPCs derive identity from
 * `auth.uid()` and accept no user id, so a caller can only ever act on their own
 * account — this module cannot widen that.
 */

/** Raised for expected privacy-operation failures. */
export class PrivacyError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'PrivacyError';
    this.code = code;
  }
}

/** A machine-readable copy of everything Mettivo holds about the caller. */
export type DataExport = Record<string, unknown>;

export async function exportMyData(): Promise<DataExport> {
  const { data, error } = await supabase.rpc('export_my_data');

  if (error) {
    console.error('[privacy] export failed:', error.message);
    throw new PrivacyError(error.message, error.code);
  }

  if (typeof data !== 'object' || data === null) {
    console.error('[privacy] unexpected export payload:', data);
    throw new PrivacyError('Unexpected response from the export service.');
  }

  return data as DataExport;
}

/** Triggers a browser download of the exported JSON. */
export function downloadDataExport(payload: DataExport, filename = 'mettivo-my-data.json'): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  // Release the object URL once the download has been handed to the browser.
  URL.revokeObjectURL(url);
}

/**
 * Irreversibly erases the account, its profile, activity and identity, then
 * clears the now-invalid local session.
 */
export async function deleteMyAccount(): Promise<void> {
  const { error } = await supabase.rpc('delete_my_account');

  if (error) {
    console.error('[privacy] delete failed:', error.message);
    throw new PrivacyError(error.message, error.code);
  }

  // The auth user no longer exists, so the cached session is dead; clear it so
  // the app does not keep presenting a signed-in shell.
  const { error: signOutError } = await supabase.auth.signOut();
  if (signOutError) {
    console.error('[privacy] sign-out after deletion failed:', signOutError.message);
  }
}
