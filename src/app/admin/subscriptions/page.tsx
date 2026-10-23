'use client';

import { useState } from 'react';
import { useAdmin } from '../AdminContext';
import {
  Card,
  EmptyState,
  ErrorBanner,
  LoadingBlock,
  Modal,
  Pagination,
  StatusPill,
  formatDate,
  formatMoney,
  formatNumber,
  useAdminResource,
} from '../components/AdminUI';
import {
  AdminError,
  assignSubscription,
  fetchPlans,
  fetchSubscriptions,
  savePlan,
  type AdminPlan,
  type PlanInput,
} from '@/lib/admin-console';

const EMPTY_PLAN: PlanInput = {
  id: null,
  code: '',
  name: '',
  description: '',
  priceMinor: 0,
  currency: 'USD',
  billingInterval: 'month',
  features: [],
  limits: {},
  trialDays: 0,
  isActive: false,
  sortOrder: 20,
};

const SUB_STATUSES = ['', 'active', 'trialing', 'past_due', 'canceled', 'expired'];

export default function AdminSubscriptionsPage() {
  const { can } = useAdmin();
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [planEditor, setPlanEditor] = useState<PlanInput | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [assignUser, setAssignUser] = useState('');
  const [assignPlan, setAssignPlan] = useState('');
  const [assignStatus, setAssignStatus] = useState('active');
  const [assignEnd, setAssignEnd] = useState('');
  const [assignNote, setAssignNote] = useState('');

  const limit = 25;
  const plansResource = useAdminResource(fetchPlans, []);
  const subsResource = useAdminResource(
    () => fetchSubscriptions({ search: appliedSearch, status, limit, offset }),
    [appliedSearch, status, offset]
  );

  const plans = plansResource.data ?? [];
  const subscriptions = subsResource.data ?? [];
  const total = subscriptions[0]?.totalCount ?? 0;

  const openNewPlan = () => {
    setFormError(null);
    setPlanEditor({ ...EMPTY_PLAN });
  };

  const openPlan = (plan: AdminPlan) => {
    setFormError(null);
    setPlanEditor({
      id: plan.id,
      code: plan.code,
      name: plan.name,
      description: plan.description ?? '',
      priceMinor: plan.priceMinor,
      currency: plan.currency,
      billingInterval: plan.billingInterval,
      features: plan.features.filter((item): item is string => typeof item === 'string'),
      limits: plan.limits,
      trialDays: plan.trialDays,
      isActive: plan.isActive,
      sortOrder: plan.sortOrder,
    });
  };

  const submitPlan = async () => {
    if (!planEditor) return;
    if (!planEditor.code.trim() || !planEditor.name.trim()) {
      setFormError('A code and name are required.');
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await savePlan(planEditor);
      setPlanEditor(null);
      plansResource.reload();
    } catch (err) {
      setFormError(err instanceof AdminError ? err.message : 'The plan could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const submitAssignment = async () => {
    if (!assignUser.trim() || !assignPlan) {
      setFormError('A member id and plan are required.');
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await assignSubscription({
        userId: assignUser.trim(),
        planId: assignPlan,
        status: assignStatus,
        periodEnd: assignEnd ? new Date(`${assignEnd}T23:59:59Z`).toISOString() : null,
        note: assignNote,
      });
      setAssignOpen(false);
      setAssignUser('');
      setAssignNote('');
      setAssignEnd('');
      subsResource.reload();
      plansResource.reload();
    } catch (err) {
      setFormError(err instanceof AdminError ? err.message : 'The subscription could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <ErrorBanner message={plansResource.error ?? subsResource.error} />

      <div className="admin-page-head">
        <div>
          <h2 className="admin-page-title" style={{ fontSize: 20 }}>Plans</h2>
          <p className="admin-page-desc">
            Paid plans start as drafts at zero price. Set a real price and activate only when
            checkout and the payment webhook are configured.
          </p>
        </div>
        <div className="admin-inline">
          {can('plans.manage') && (
            <button type="button" className="admin-btn is-gold" onClick={openNewPlan}>
              New plan
            </button>
          )}
          {can('subscriptions.manage') && (
            <button
              type="button"
              className="admin-btn is-primary"
              onClick={() => {
                setFormError(null);
                setAssignPlan(plans[0]?.id ?? '');
                setAssignOpen(true);
              }}
            >
              Assign subscription
            </button>
          )}
        </div>
      </div>

      {plansResource.loading && !plansResource.data ? (
        <LoadingBlock rows={3} />
      ) : plans.length === 0 ? (
        <Card>
          <EmptyState title="No plans configured" detail="Create the first plan to begin." />
        </Card>
      ) : (
        <div className="admin-grid cols-3">
          {plans.map((plan) => (
            <Card key={plan.id}>
              <div className="admin-card-head">
                <div>
                  <h3 className="admin-card-title">{plan.name}</h3>
                  <p className="admin-card-sub">{plan.code}</p>
                </div>
                <StatusPill status={plan.isActive ? 'active' : 'draft'} />
              </div>
              <p className="admin-stat-value" style={{ fontSize: 24 }}>
                {formatMoney(plan.priceMinor, plan.currency)}
                <span className="admin-card-sub" style={{ display: 'inline', marginLeft: 6 }}>
                  / {plan.billingInterval}
                </span>
              </p>
              <p className="admin-card-sub" style={{ minHeight: 34 }}>
                {plan.description ?? 'No description.'}
              </p>
              <dl className="admin-key-value" style={{ marginTop: 10 }}>
                <dt>Subscribers</dt>
                <dd>{formatNumber(plan.subscriberCount)}</dd>
                <dt>Trial</dt>
                <dd>{plan.trialDays > 0 ? `${plan.trialDays} days` : 'None'}</dd>
                <dt>Features</dt>
                <dd>{plan.features.length > 0 ? plan.features.length : 'None set'}</dd>
              </dl>
              {can('plans.manage') && (
                <button
                  type="button"
                  className="admin-btn is-small"
                  style={{ marginTop: 12 }}
                  onClick={() => openPlan(plan)}
                >
                  Edit plan
                </button>
              )}
            </Card>
          ))}
        </div>
      )}

      <h2 className="admin-section-title">Member subscriptions</h2>

      <div className="admin-toolbar">
        <form
          className="admin-inline"
          style={{ flex: 1 }}
          onSubmit={(event) => {
            event.preventDefault();
            setOffset(0);
            setAppliedSearch(search.trim());
          }}
        >
          <input
            className="admin-input is-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search member name or email"
            aria-label="Search subscriptions"
          />
          <button type="submit" className="admin-btn is-gold">Search</button>
        </form>
        <select
          className="admin-select"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setOffset(0);
          }}
          aria-label="Filter subscription status"
        >
          {SUB_STATUSES.map((value) => (
            <option key={value} value={value}>
              {value === '' ? 'All statuses' : value.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </div>

      {subsResource.loading && !subsResource.data ? (
        <LoadingBlock rows={6} />
      ) : subscriptions.length === 0 ? (
        <Card>
          <EmptyState
            title="No subscription records"
            detail="No member currently has a stored subscription. Stripe checkout is not yet configured."
          />
        </Card>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Plan</th>
                <th>Status</th>
                <th>Provider</th>
                <th>Period end</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {subscriptions.map((row) => (
                <tr key={row.subscriptionId}>
                  <td>
                    <div className="admin-person-name">{row.displayName}</div>
                    <div className="admin-person-sub">{row.email ?? row.userId}</div>
                  </td>
                  <td className="is-strong">{row.planName}</td>
                  <td><StatusPill status={row.status} /></td>
                  <td className="is-muted">{row.provider}</td>
                  <td className="is-muted">{formatDate(row.currentPeriodEnd)}</td>
                  <td className="is-muted">{formatDate(row.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: '0 14px 10px' }}>
            <Pagination total={total} limit={limit} offset={offset} onChange={setOffset} />
          </div>
        </div>
      )}

      {planEditor && (
        <Modal
          title={planEditor.id ? 'Edit plan' : 'New plan'}
          onClose={() => {
            if (!busy) setPlanEditor(null);
          }}
        >
          <ErrorBanner message={formError} />
          <div className="admin-grid cols-2" style={{ gap: 10 }}>
            <div className="admin-field">
              <label htmlFor="plan-code">Code</label>
              <input
                id="plan-code"
                className="admin-input"
                value={planEditor.code}
                onChange={(event) => setPlanEditor({ ...planEditor, code: event.target.value })}
                placeholder="premium"
              />
            </div>
            <div className="admin-field">
              <label htmlFor="plan-name">Name</label>
              <input
                id="plan-name"
                className="admin-input"
                value={planEditor.name}
                onChange={(event) => setPlanEditor({ ...planEditor, name: event.target.value })}
                placeholder="Premium"
              />
            </div>
          </div>
          <div className="admin-field">
            <label htmlFor="plan-description">Description</label>
            <textarea
              id="plan-description"
              className="admin-textarea"
              value={planEditor.description}
              onChange={(event) => setPlanEditor({ ...planEditor, description: event.target.value })}
            />
          </div>
          <div className="admin-grid cols-3" style={{ gap: 10 }}>
            <div className="admin-field">
              <label htmlFor="plan-price">Price (minor units)</label>
              <input
                id="plan-price"
                className="admin-input"
                type="number"
                min={0}
                value={planEditor.priceMinor}
                onChange={(event) =>
                  setPlanEditor({ ...planEditor, priceMinor: Math.max(0, Number(event.target.value) || 0) })
                }
              />
            </div>
            <div className="admin-field">
              <label htmlFor="plan-currency">Currency</label>
              <select
                id="plan-currency"
                className="admin-select"
                value={planEditor.currency}
                onChange={(event) => setPlanEditor({ ...planEditor, currency: event.target.value })}
              >
                {['USD', 'EUR', 'NPR', 'GBP', 'INR'].map((code) => (
                  <option key={code} value={code}>{code}</option>
                ))}
              </select>
            </div>
            <div className="admin-field">
              <label htmlFor="plan-interval">Interval</label>
              <select
                id="plan-interval"
                className="admin-select"
                value={planEditor.billingInterval}
                onChange={(event) => setPlanEditor({ ...planEditor, billingInterval: event.target.value })}
              >
                <option value="month">Monthly</option>
                <option value="year">Yearly</option>
                <option value="none">None</option>
              </select>
            </div>
          </div>
          <div className="admin-grid cols-3" style={{ gap: 10 }}>
            <div className="admin-field">
              <label htmlFor="plan-trial">Trial days</label>
              <input
                id="plan-trial"
                className="admin-input"
                type="number"
                min={0}
                max={365}
                value={planEditor.trialDays}
                onChange={(event) =>
                  setPlanEditor({ ...planEditor, trialDays: Math.max(0, Number(event.target.value) || 0) })
                }
              />
            </div>
            <div className="admin-field">
              <label htmlFor="plan-sort">Sort order</label>
              <input
                id="plan-sort"
                className="admin-input"
                type="number"
                value={planEditor.sortOrder}
                onChange={(event) =>
                  setPlanEditor({ ...planEditor, sortOrder: Number(event.target.value) || 0 })
                }
              />
            </div>
            <div className="admin-field">
              <label htmlFor="plan-active">State</label>
              <select
                id="plan-active"
                className="admin-select"
                value={planEditor.isActive ? 'active' : 'draft'}
                onChange={(event) =>
                  setPlanEditor({ ...planEditor, isActive: event.target.value === 'active' })
                }
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
              </select>
            </div>
          </div>
          <div className="admin-field">
            <label htmlFor="plan-features">Features (one per line)</label>
            <textarea
              id="plan-features"
              className="admin-textarea"
              value={planEditor.features.join('\n')}
              onChange={(event) =>
                setPlanEditor({
                  ...planEditor,
                  features: event.target.value.split('\n').map((line) => line.trim()).filter(Boolean),
                })
              }
              placeholder={'Unlimited likes\nSee who liked you\nPriority discovery'}
            />
          </div>
          <div className="admin-inline" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="admin-btn" disabled={busy} onClick={() => setPlanEditor(null)}>
              Cancel
            </button>
            <button type="button" className="admin-btn is-primary" disabled={busy} onClick={() => void submitPlan()}>
              {busy ? 'Saving…' : 'Save plan'}
            </button>
          </div>
        </Modal>
      )}

      {assignOpen && (
        <Modal title="Assign subscription" onClose={() => { if (!busy) setAssignOpen(false); }}>
          <p>
            Manual assignment is for support and reconciliation. It is audited. Use the internal
            member user id; email search is available on the User management page.
          </p>
          <ErrorBanner message={formError} />
          <div className="admin-field">
            <label htmlFor="assign-user">Member user id</label>
            <input
              id="assign-user"
              className="admin-input admin-mono"
              value={assignUser}
              onChange={(event) => setAssignUser(event.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
            />
          </div>
          <div className="admin-grid cols-2" style={{ gap: 10 }}>
            <div className="admin-field">
              <label htmlFor="assign-plan">Plan</label>
              <select
                id="assign-plan"
                className="admin-select"
                value={assignPlan}
                onChange={(event) => setAssignPlan(event.target.value)}
              >
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>{plan.name}</option>
                ))}
              </select>
            </div>
            <div className="admin-field">
              <label htmlFor="assign-status">Status</label>
              <select
                id="assign-status"
                className="admin-select"
                value={assignStatus}
                onChange={(event) => setAssignStatus(event.target.value)}
              >
                {['trialing', 'active', 'past_due', 'canceled', 'expired'].map((value) => (
                  <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="admin-field">
            <label htmlFor="assign-end">Current period end</label>
            <input
              id="assign-end"
              className="admin-input"
              type="date"
              value={assignEnd}
              onChange={(event) => setAssignEnd(event.target.value)}
            />
          </div>
          <div className="admin-field">
            <label htmlFor="assign-note">Reason / note</label>
            <textarea
              id="assign-note"
              className="admin-textarea"
              value={assignNote}
              onChange={(event) => setAssignNote(event.target.value)}
              placeholder="Support case, reconciliation reference, or campaign."
            />
          </div>
          <div className="admin-inline" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="admin-btn" disabled={busy} onClick={() => setAssignOpen(false)}>
              Cancel
            </button>
            <button type="button" className="admin-btn is-primary" disabled={busy} onClick={() => void submitAssignment()}>
              {busy ? 'Assigning…' : 'Assign subscription'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
