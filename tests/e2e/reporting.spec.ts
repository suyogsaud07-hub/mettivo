import { expect, test } from '@playwright/test';
import { E2E_OTHER_USER_ID, signedIn, stubSupabase } from './fixtures';

/**
 * §3.3 — the M21 report flow reaches the database through ONE entry point.
 *
 * The report UI was rebuilt so every surface calls `file_report` rather than
 * writing `reports` directly (that is the only place the content capture,
 * threshold evaluation and AI queueing run). A browser journey is the honest
 * proof: it shows the shared dialog opens from a deep link and that submitting
 * it calls the RPC with the reported user, not an INSERT the pipeline never
 * sees.
 */

test.describe('§3.3 — universal reporting', () => {
  test('deep links open the shared dialog and submit through file_report', async ({ page }) => {
    await signedIn(page);
    const stub = await stubSupabase(page, {
      user: {},
      rpc: {
        my_restrictions: {
          chat_banned: false,
          chat_until: null,
          video_banned: false,
          video_until: null,
          suspended: false,
          suspended_until: null,
          suspended_reason: null,
        },
        file_report: { report_id: 'r-1', category: 'harassment', status: 'pending' },
      },
      tables: { reports: [], blocked_users: [] },
    });

    await page.goto(`/report?report=${E2E_OTHER_USER_ID}`);

    // The dialog title proves the shared component rendered (not the old inline
    // copy, which used the words "Report user").
    await expect(page.getByText('Report member')).toBeVisible();

    await page.getByRole('radio', { name: /Abusive language/i }).check();
    await page.getByRole('button', { name: 'Submit report' }).click();

    await expect(page.getByText(/Thank you/i)).toBeVisible();

    const filed = stub.writes.find((write) => write.table === 'rpc/file_report');
    expect(filed, 'file_report was not called').toBeTruthy();
    expect(filed?.body).toMatchObject({
      p_target_user: E2E_OTHER_USER_ID,
      p_category: 'abuse_text',
    });
  });
});
