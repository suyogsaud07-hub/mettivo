'use client';

import AuthPanel from '@/app/components/AuthPanel';

/**
 * `/signup` — registration, and the same surface as `/auth`.
 *
 * It renders `AuthPanel` rather than its own copy. The page previously carried a
 * second implementation of this screen that still used `prompt()` for the email
 * address and the phone number and `alert()` for every outcome — none of which
 * is styleable, localisable, or safe on a browser that blocks dialogs. Both
 * routes now share one component, so they cannot drift apart again.
 *
 * The route is kept because `/signup` is a linkable destination in its own right.
 */
export default function SignUpPage() {
  return <AuthPanel />;
}
