import { supabase } from '@/lib/supabase';

/**
 * Administrative console data access.
 *
 * Every RPC below is authorised inside PostgreSQL. This module only parses the
 * response and turns `{ error }` into a user-visible exception; it is never the
 * security boundary.
 */

export type AdminRole = 'user' | 'moderator' | 'support' | 'finance' | 'admin';

export type AdminPermission =
  | 'dashboard.view'
  | 'users.view'
  | 'users.manage'
  | 'moderation.view'
  | 'moderation.manage'
  | 'subscriptions.view'
  | 'subscriptions.manage'
  | 'payments.view'
  | 'payments.manage'
  | 'plans.manage'
  | 'content.view'
  | 'content.manage'
  | 'chat.view'
  | 'notifications.manage'
  | 'analytics.view'
  | 'staff.manage'
  | 'audit.view'
  | 'system.view'
  | 'settings.manage';

export interface AdminIdentity {
  userId: string;
  role: AdminRole;
  displayName: string | null;
  avatarUrl: string | null;
  email: string | null;
  permissions: AdminPermission[];
}

export class AdminError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'AdminError';
    this.code = code;
  }
}

const ROLES: readonly AdminRole[] = ['user', 'moderator', 'support', 'finance', 'admin'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function int(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0;
}

function bool(value: unknown): boolean {
  return value === true;
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

async function rpc(name: string, args?: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    throw new AdminError(error.message, error.code);
  }
  return data;
}

export function hasPermission(
  identity: AdminIdentity | null,
  permission: AdminPermission
): boolean {
  return identity?.permissions.includes(permission) === true;
}

export async function fetchAdminIdentity(): Promise<AdminIdentity | null> {
  const raw = await rpc('admin_me');
  if (!isRecord(raw)) return null;

  const userId = str(raw.user_id);
  if (!userId) return null;

  const role = ROLES.includes(raw.role as AdminRole) ? (raw.role as AdminRole) : 'user';
  const permissions = Array.isArray(raw.permissions)
    ? raw.permissions.filter((item): item is AdminPermission => typeof item === 'string')
    : [];

  return {
    userId,
    role,
    displayName: str(raw.display_name),
    avatarUrl: str(raw.avatar_url),
    email: str(raw.email),
    permissions,
  };
}

/* ------------------------------------------------------------------------- */
/* Dashboard                                                                 */
/* ------------------------------------------------------------------------- */

export interface NamedCount {
  label: string;
  count: number;
}

export interface RevenueCurrency {
  currency: string;
  gross: number;
  refunds: number;
  fees: number;
  net: number;
}

export interface TimePoint {
  day: string;
  count: number;
}

export interface RevenuePoint {
  day: string;
  currency: string;
  gross: number;
}

export interface DashboardStats {
  generatedAt: string | null;
  users: {
    total: number;
    newToday: number | null;
    newWeek: number | null;
    newMonth: number | null;
    registrationGrowthAvailable: boolean;
    dau: number;
    wau: number;
    mau: number;
    activityDefinition: string;
  };
  growth: TimePoint[];
  subscriptions: {
    active: number;
    expired: number;
    newPaid30d: number;
    distribution: NamedCount[];
  };
  revenue: {
    byCurrency: RevenueCurrency[];
    timeline: RevenuePoint[];
    definition: string;
  };
  moderation: {
    openReports: number;
    resolved7d: number;
    avgResolutionHours: number | null;
    categories: NamedCount[];
  };
  content: {
    momentsTotal: number;
    momentsPending: number;
    momentsRejected: number;
    storageBytes: number | null;
    storageNote: string;
  };
  messages: { total: number; last24h: number };
}

function namedCounts(value: unknown): NamedCount[] {
  if (!isRecord(value)) return [];
  return Object.entries(value)
    .map(([label, count]) => ({ label, count: int(count) }))
    .sort((a, b) => b.count - a.count);
}

export async function fetchDashboardStats(): Promise<DashboardStats> {
  const raw = await rpc('admin_dashboard_stats');
  const root = isRecord(raw) ? raw : {};
  const users = isRecord(root.users) ? root.users : {};
  const subscriptions = isRecord(root.subscriptions) ? root.subscriptions : {};
  const revenue = isRecord(root.revenue) ? root.revenue : {};
  const moderation = isRecord(root.moderation) ? root.moderation : {};
  const content = isRecord(root.content) ? root.content : {};
  const messages = isRecord(root.messages) ? root.messages : {};

  return {
    generatedAt: str(root.generated_at),
    users: {
      total: int(users.total),
      newToday: num(users.new_today),
      newWeek: num(users.new_week),
      newMonth: num(users.new_month),
      registrationGrowthAvailable: bool(users.registration_growth_available),
      dau: int(users.dau),
      wau: int(users.wau),
      mau: int(users.mau),
      activityDefinition: str(users.activity_definition) ?? '',
    },
    growth: rows(root.growth).map((point) => ({
      day: str(point.day) ?? '',
      count: int(point.count),
    })),
    subscriptions: {
      active: int(subscriptions.active),
      expired: int(subscriptions.expired),
      newPaid30d: int(subscriptions.new_paid_30d),
      distribution: namedCounts(subscriptions.distribution),
    },
    revenue: {
      byCurrency: rows(revenue.by_currency).map((entry) => ({
        currency: str(entry.currency) ?? 'unknown',
        gross: int(entry.gross),
        refunds: int(entry.refunds),
        fees: int(entry.fees),
        net: int(entry.net),
      })),
      timeline: rows(revenue.timeline).map((point) => ({
        day: str(point.day) ?? '',
        currency: str(point.currency) ?? 'unknown',
        gross: int(point.gross),
      })),
      definition: str(revenue.definition) ?? '',
    },
    moderation: {
      openReports: int(moderation.open_reports),
      resolved7d: int(moderation.resolved_7d),
      avgResolutionHours: num(moderation.avg_resolution_hours),
      categories: namedCounts(moderation.categories),
    },
    content: {
      momentsTotal: int(content.moments_total),
      momentsPending: int(content.moments_pending),
      momentsRejected: int(content.moments_rejected),
      storageBytes: num(content.storage_bytes),
      storageNote: str(content.storage_note) ?? '',
    },
    messages: {
      total: int(messages.total),
      last24h: int(messages.last_24h),
    },
  };
}

/* ------------------------------------------------------------------------- */
/* Users                                                                     */
/* ------------------------------------------------------------------------- */

export type AccountStatus = 'active' | 'suspended' | 'banned';

export interface AdminUserRow {
  userId: string;
  displayName: string;
  username: string | null;
  email: string | null;
  age: number | null;
  gender: string | null;
  city: string | null;
  country: string | null;
  avatarUrl: string | null;
  isVerified: boolean;
  accountStatus: AccountStatus;
  role: AdminRole;
  planName: string | null;
  reportCount: number;
  lastSeenAt: string | null;
  totalCount: number;
}

function accountStatus(value: unknown): AccountStatus {
  return value === 'banned' || value === 'suspended' ? value : 'active';
}

export async function fetchUsers(params: {
  search?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<AdminUserRow[]> {
  const raw = await rpc('admin_user_list', {
    p_search: params.search?.trim() || null,
    p_status: params.status || null,
    p_limit: params.limit ?? 25,
    p_offset: params.offset ?? 0,
  });

  return rows(raw).map((row) => ({
    userId: str(row.user_id) ?? '',
    displayName: str(row.display_name) ?? 'Member',
    username: str(row.username),
    email: str(row.email),
    age: num(row.age),
    gender: str(row.gender),
    city: str(row.city),
    country: str(row.country),
    avatarUrl: str(row.avatar_url),
    isVerified: bool(row.is_verified),
    accountStatus: accountStatus(row.account_status),
    role: ROLES.includes(row.role as AdminRole) ? (row.role as AdminRole) : 'user',
    planName: str(row.plan_name),
    reportCount: int(row.report_count),
    lastSeenAt: str(row.last_seen_at),
    totalCount: int(row.total_count),
  }));
}

export interface ReportSummary {
  id: string;
  category: string | null;
  status: string | null;
  createdAt: string | null;
}

export interface AuditSummary {
  action: string;
  details: Record<string, unknown> | null;
  createdAt: string | null;
}

export interface AdminUserDetail {
  userId: string;
  displayName: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  age: number | null;
  gender: string | null;
  city: string | null;
  country: string | null;
  avatarUrl: string | null;
  bio: string | null;
  intention: string | null;
  isVerified: boolean;
  onboardingCompleted: boolean;
  isOnline: boolean;
  lastSeenAt: string | null;
  isSuspended: boolean;
  suspendedAt: string | null;
  suspensionReason: string | null;
  bannedUntil: string | null;
  banReason: string | null;
  role: AdminRole;
  subscription: {
    id: string;
    planName: string | null;
    planCode: string | null;
    status: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  reportsAgainst: ReportSummary[];
  reportsBy: number;
  moderationActions: AuditSummary[];
}

export async function fetchUserDetail(userId: string): Promise<AdminUserDetail | null> {
  const raw = await rpc('admin_user_detail', { p_user_id: userId });
  if (!isRecord(raw)) return null;

  const subscription = isRecord(raw.subscription)
    ? {
        id: str(raw.subscription.id) ?? '',
        planName: str(raw.subscription.plan_name),
        planCode: str(raw.subscription.plan_code),
        status: str(raw.subscription.status) ?? 'unknown',
        currentPeriodEnd: str(raw.subscription.current_period_end),
        cancelAtPeriodEnd: bool(raw.subscription.cancel_at_period_end),
      }
    : null;

  return {
    userId: str(raw.user_id) ?? userId,
    displayName: str(raw.display_name) ?? 'Member',
    username: str(raw.username),
    firstName: str(raw.first_name),
    lastName: str(raw.last_name),
    email: str(raw.email),
    age: num(raw.age),
    gender: str(raw.gender),
    city: str(raw.city),
    country: str(raw.country),
    avatarUrl: str(raw.avatar_url),
    bio: str(raw.bio),
    intention: str(raw.intention),
    isVerified: bool(raw.is_verified),
    onboardingCompleted: bool(raw.onboarding_completed),
    isOnline: bool(raw.is_online),
    lastSeenAt: str(raw.last_seen_at),
    isSuspended: bool(raw.is_suspended),
    suspendedAt: str(raw.suspended_at),
    suspensionReason: str(raw.suspension_reason),
    bannedUntil: str(raw.banned_until),
    banReason: str(raw.ban_reason),
    role: ROLES.includes(raw.role as AdminRole) ? (raw.role as AdminRole) : 'user',
    subscription,
    reportsAgainst: rows(raw.reports_against).map((report) => ({
      id: str(report.id) ?? '',
      category: str(report.category),
      status: str(report.status),
      createdAt: str(report.created_at),
    })),
    reportsBy: int(raw.reports_by),
    moderationActions: rows(raw.moderation_actions).map((entry) => ({
      action: str(entry.action) ?? 'unknown',
      details: isRecord(entry.details) ? entry.details : null,
      createdAt: str(entry.created_at),
    })),
  };
}

export async function setUserStatus(
  userId: string,
  status: AccountStatus,
  reason: string
): Promise<void> {
  await rpc('admin_set_user_status', {
    p_user_id: userId,
    p_status: status,
    p_reason: reason.trim() || null,
  });
}

export async function warnUser(userId: string, reason: string): Promise<void> {
  await rpc('admin_warn_user', { p_user_id: userId, p_reason: reason });
}

/* ------------------------------------------------------------------------- */
/* Staff and audit                                                           */
/* ------------------------------------------------------------------------- */

export interface StaffRow {
  userId: string;
  displayName: string;
  email: string | null;
  role: AdminRole;
  grantedAt: string | null;
  grantedBy: string | null;
  lastSeenAt: string | null;
}

export async function fetchStaff(): Promise<StaffRow[]> {
  const raw = await rpc('admin_staff_list');
  return rows(raw).map((row) => ({
    userId: str(row.user_id) ?? '',
    displayName: str(row.display_name) ?? 'Staff member',
    email: str(row.email),
    role: ROLES.includes(row.role as AdminRole) ? (row.role as AdminRole) : 'support',
    grantedAt: str(row.granted_at),
    grantedBy: str(row.granted_by),
    lastSeenAt: str(row.last_seen_at),
  }));
}

export async function setStaffRole(userId: string, role: AdminRole): Promise<void> {
  await rpc('admin_set_role', { p_user_id: userId, p_role: role });
}

export interface AuditRow {
  id: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  targetUserId: string | null;
  targetName: string | null;
  targetReportId: string | null;
  details: Record<string, unknown> | null;
  createdAt: string | null;
  totalCount: number;
}

export async function fetchAuditLog(params: {
  action?: string;
  limit?: number;
  offset?: number;
}): Promise<AuditRow[]> {
  const raw = await rpc('admin_audit_list', {
    p_action: params.action?.trim() || null,
    p_limit: params.limit ?? 50,
    p_offset: params.offset ?? 0,
  });

  return rows(raw).map((row) => ({
    id: str(row.id) ?? '',
    actorId: str(row.actor_id),
    actorName: str(row.actor_name),
    action: str(row.action) ?? 'unknown',
    targetUserId: str(row.target_user_id),
    targetName: str(row.target_name),
    targetReportId: str(row.target_report_id),
    details: isRecord(row.details) ? row.details : null,
    createdAt: str(row.created_at),
    totalCount: int(row.total_count),
  }));
}

/* ------------------------------------------------------------------------- */
/* Plans and subscriptions                                                   */
/* ------------------------------------------------------------------------- */

export interface AdminPlan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceMinor: number;
  currency: string;
  billingInterval: string;
  features: unknown[];
  limits: Record<string, unknown>;
  trialDays: number;
  isActive: boolean;
  sortOrder: number;
  subscriberCount: number;
  updatedAt: string | null;
}

export async function fetchPlans(): Promise<AdminPlan[]> {
  const raw = await rpc('admin_plan_list');
  return rows(raw).map((row) => ({
    id: str(row.id) ?? '',
    code: str(row.code) ?? '',
    name: str(row.name) ?? 'Plan',
    description: str(row.description),
    priceMinor: int(row.price_minor),
    currency: str(row.currency) ?? 'USD',
    billingInterval: str(row.billing_interval) ?? 'month',
    features: Array.isArray(row.features) ? row.features : [],
    limits: isRecord(row.limits) ? row.limits : {},
    trialDays: int(row.trial_days),
    isActive: bool(row.is_active),
    sortOrder: int(row.sort_order),
    subscriberCount: int(row.subscriber_count),
    updatedAt: str(row.updated_at),
  }));
}

export interface PlanInput {
  id: string | null;
  code: string;
  name: string;
  description: string;
  priceMinor: number;
  currency: string;
  billingInterval: string;
  features: string[];
  limits: Record<string, unknown>;
  trialDays: number;
  isActive: boolean;
  sortOrder: number;
}

export async function savePlan(input: PlanInput): Promise<string> {
  const raw = await rpc('admin_plan_upsert', {
    p_id: input.id,
    p_code: input.code,
    p_name: input.name,
    p_description: input.description.trim() || null,
    p_price_minor: input.priceMinor,
    p_currency: input.currency,
    p_billing_interval: input.billingInterval,
    p_features: input.features,
    p_limits: input.limits,
    p_trial_days: input.trialDays,
    p_is_active: input.isActive,
    p_sort_order: input.sortOrder,
  });
  return typeof raw === 'string' ? raw : '';
}

export interface AdminSubscriptionRow {
  subscriptionId: string;
  userId: string;
  displayName: string;
  email: string | null;
  planName: string;
  planCode: string;
  status: string;
  provider: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  createdAt: string | null;
  totalCount: number;
}

export async function fetchSubscriptions(params: {
  search?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<AdminSubscriptionRow[]> {
  const raw = await rpc('admin_subscription_list', {
    p_search: params.search?.trim() || null,
    p_status: params.status || null,
    p_limit: params.limit ?? 25,
    p_offset: params.offset ?? 0,
  });

  return rows(raw).map((row) => ({
    subscriptionId: str(row.subscription_id) ?? '',
    userId: str(row.user_id) ?? '',
    displayName: str(row.display_name) ?? 'Member',
    email: str(row.email),
    planName: str(row.plan_name) ?? 'Plan',
    planCode: str(row.plan_code) ?? '',
    status: str(row.status) ?? 'unknown',
    provider: str(row.provider) ?? 'manual',
    currentPeriodEnd: str(row.current_period_end),
    cancelAtPeriodEnd: bool(row.cancel_at_period_end),
    createdAt: str(row.created_at),
    totalCount: int(row.total_count),
  }));
}

export async function assignSubscription(params: {
  userId: string;
  planId: string;
  status: string;
  periodEnd: string | null;
  note: string;
}): Promise<void> {
  await rpc('admin_assign_subscription', {
    p_user_id: params.userId,
    p_plan_id: params.planId,
    p_status: params.status,
    p_period_end: params.periodEnd,
    p_note: params.note.trim() || null,
  });
}

/* ------------------------------------------------------------------------- */
/* Payments                                                                  */
/* ------------------------------------------------------------------------- */

export interface PaymentRow {
  id: string;
  eventType: string;
  status: string;
  userId: string | null;
  displayName: string | null;
  amountMinor: number | null;
  feeMinor: number | null;
  refundedMinor: number;
  currency: string | null;
  receivedAt: string | null;
  processedAt: string | null;
  totalCount: number;
}

export interface PaymentSummary {
  byCurrency: RevenueCurrency[];
  received: number;
  processed: number;
  failed: number;
  ignored: number;
  lastEventAt: string | null;
  definition: string;
}

export async function fetchPayments(params: {
  limit?: number;
  offset?: number;
}): Promise<PaymentRow[]> {
  const raw = await rpc('admin_payment_list', {
    p_limit: params.limit ?? 50,
    p_offset: params.offset ?? 0,
  });

  return rows(raw).map((row) => ({
    id: str(row.id) ?? '',
    eventType: str(row.event_type) ?? 'unknown',
    status: str(row.status) ?? 'received',
    userId: str(row.user_id),
    displayName: str(row.display_name),
    amountMinor: num(row.amount_minor),
    feeMinor: num(row.fee_minor),
    refundedMinor: int(row.refunded_minor),
    currency: str(row.currency),
    receivedAt: str(row.received_at),
    processedAt: str(row.processed_at),
    totalCount: int(row.total_count),
  }));
}

export async function fetchPaymentSummary(): Promise<PaymentSummary> {
  const raw = await rpc('admin_payment_summary');
  const root = isRecord(raw) ? raw : {};
  const counts = isRecord(root.counts) ? root.counts : {};

  return {
    byCurrency: rows(root.by_currency).map((entry) => ({
      currency: str(entry.currency) ?? 'unknown',
      gross: int(entry.gross),
      refunds: int(entry.refunds),
      fees: int(entry.fees),
      net: int(entry.net),
    })),
    received: int(counts.received),
    processed: int(counts.processed),
    failed: int(counts.failed),
    ignored: int(counts.ignored),
    lastEventAt: str(root.last_event_at),
    definition: str(root.definition) ?? '',
  };
}

/* ------------------------------------------------------------------------- */
/* Content, chat, campaigns                                                  */
/* ------------------------------------------------------------------------- */

export interface MomentRow {
  momentId: string;
  authorId: string;
  authorName: string;
  caption: string | null;
  contentKind: string;
  moderationStatus: string;
  mediaCount: number;
  reportCount: number;
  createdAt: string | null;
  totalCount: number;
}

export async function fetchMoments(params: {
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<MomentRow[]> {
  const raw = await rpc('admin_moment_list', {
    p_status: params.status || null,
    p_limit: params.limit ?? 25,
    p_offset: params.offset ?? 0,
  });

  return rows(raw).map((row) => ({
    momentId: str(row.moment_id) ?? '',
    authorId: str(row.author_id) ?? '',
    authorName: str(row.author_name) ?? 'Member',
    caption: str(row.caption),
    contentKind: str(row.content_kind) ?? 'post',
    moderationStatus: str(row.moderation_status) ?? 'pending',
    mediaCount: int(row.media_count),
    reportCount: int(row.report_count),
    createdAt: str(row.created_at),
    totalCount: int(row.total_count),
  }));
}

export async function setMomentModeration(momentId: string, status: string): Promise<void> {
  await rpc('admin_set_moment_moderation', { p_moment_id: momentId, p_status: status });
}

export interface MediaStats {
  momentsTotal: number;
  posts: number;
  reels: number;
  pending: number;
  rejected: number;
  failedReview: number;
  reportedMoments: number;
  storageBytes: number | null;
  storageNote: string;
}

export async function fetchMediaStats(): Promise<MediaStats> {
  const raw = await rpc('admin_media_stats');
  const root = isRecord(raw) ? raw : {};
  return {
    momentsTotal: int(root.moments_total),
    posts: int(root.posts),
    reels: int(root.reels),
    pending: int(root.pending),
    rejected: int(root.rejected),
    failedReview: int(root.failed_review),
    reportedMoments: int(root.reported_moments),
    storageBytes: num(root.storage_bytes),
    storageNote: str(root.storage_note) ?? '',
  };
}

export interface DiscoveryStats {
  profilesTotal: number;
  profilesWithPhotos: number;
  verifiedProfiles: number;
  onlineNow: number;
  likes: number;
  passes: number;
  matches: number;
  follows: number;
  blocks: number;
  suspended: number;
  reportsOpen: number;
  reportTargets: NamedCount[];
  note: string;
}

export async function fetchDiscoveryStats(): Promise<DiscoveryStats> {
  const raw = await rpc('admin_discovery_stats');
  const root = isRecord(raw) ? raw : {};
  return {
    profilesTotal: int(root.profiles_total),
    profilesWithPhotos: int(root.profiles_with_photos),
    verifiedProfiles: int(root.verified_profiles),
    onlineNow: int(root.online_now),
    likes: int(root.likes),
    passes: int(root.passes),
    matches: int(root.matches),
    follows: int(root.follows),
    blocks: int(root.blocks),
    suspended: int(root.suspended),
    reportsOpen: int(root.reports_open),
    reportTargets: namedCounts(root.report_targets),
    note: str(root.note) ?? '',
  };
}

export interface ChatStats {
  messagesTotal: number;
  messages24h: number;
  messages7d: number;
  matchesTotal: number;
  reportedMessagesOpen: number;
  chatMediaTotal: number;
  privacyNote: string;
}

export async function fetchChatStats(): Promise<ChatStats> {
  const raw = await rpc('admin_chat_stats');
  const root = isRecord(raw) ? raw : {};
  return {
    messagesTotal: int(root.messages_total),
    messages24h: int(root.messages_24h),
    messages7d: int(root.messages_7d),
    matchesTotal: int(root.matches_total),
    reportedMessagesOpen: int(root.reported_messages_open),
    chatMediaTotal: int(root.chat_media_total),
    privacyNote: str(root.privacy_note) ?? '',
  };
}

export interface CampaignRow {
  id: string;
  title: string;
  body: string;
  channel: string;
  audience: Record<string, unknown>;
  status: string;
  scheduledFor: string | null;
  sentAt: string | null;
  createdAt: string | null;
}

export async function fetchCampaigns(): Promise<CampaignRow[]> {
  const raw = await rpc('admin_campaign_list');
  return rows(raw).map((row) => ({
    id: str(row.id) ?? '',
    title: str(row.title) ?? 'Untitled',
    body: str(row.body) ?? '',
    channel: str(row.channel) ?? 'in_app',
    audience: isRecord(row.audience) ? row.audience : {},
    status: str(row.status) ?? 'draft',
    scheduledFor: str(row.scheduled_for),
    sentAt: str(row.sent_at),
    createdAt: str(row.created_at),
  }));
}

export async function createCampaign(params: {
  title: string;
  body: string;
  channel: string;
  audience: Record<string, unknown>;
}): Promise<void> {
  await rpc('admin_create_campaign', {
    p_title: params.title,
    p_body: params.body,
    p_channel: params.channel,
    p_audience: params.audience,
  });
}

/* ------------------------------------------------------------------------- */
/* Analytics, system, settings                                               */
/* ------------------------------------------------------------------------- */

export interface AnalyticsData {
  days: number;
  registrationGrowthAvailable: boolean;
  registrationGrowth: TimePoint[];
  revenueTimeline: RevenueCurrencyDay[];
  plans: PlanAnalytics[];
  reportsByCategory: NamedCount[];
  churn30d: number;
  renewalsWindow: number;
  payments: PaymentSummary | null;
  activeUsers: { dau: number; wau: number; mau: number };
}

export interface RevenueCurrencyDay {
  day: string;
  currency: string;
  gross: number;
  refunds: number;
  fees: number;
  net: number;
}

export interface PlanAnalytics {
  plan: string;
  code: string;
  active: number;
  canceled30d: number;
  revenueMinor: number;
}

export async function fetchAnalytics(days = 30): Promise<AnalyticsData> {
  const raw = await rpc('admin_analytics', { p_days: days });
  const root = isRecord(raw) ? raw : {};
  const active = isRecord(root.active_users) ? root.active_users : {};

  return {
    days: int(root.days) || days,
    registrationGrowthAvailable: bool(root.registration_growth_available),
    registrationGrowth: rows(root.registration_growth).map((point) => ({
      day: str(point.day) ?? '',
      count: int(point.count),
    })),
    revenueTimeline: rows(root.revenue_timeline).map((point) => ({
      day: str(point.day) ?? '',
      currency: str(point.currency) ?? 'unknown',
      gross: int(point.gross),
      refunds: int(point.refunds),
      fees: int(point.fees),
      net: int(point.net),
    })),
    plans: rows(root.plans).map((plan) => ({
      plan: str(plan.plan) ?? 'Plan',
      code: str(plan.code) ?? '',
      active: int(plan.active),
      canceled30d: int(plan.canceled_30d),
      revenueMinor: int(plan.revenue_minor),
    })),
    reportsByCategory: namedCounts(root.reports_by_category),
    churn30d: int(root.churn_30d),
    renewalsWindow: int(root.renewals_window),
    payments: isRecord(root.payments) ? parsePaymentSummary(root.payments) : null,
    activeUsers: {
      dau: int(active.dau),
      wau: int(active.wau),
      mau: int(active.mau),
    },
  };
}

function parsePaymentSummary(root: Record<string, unknown>): PaymentSummary {
  const counts = isRecord(root.counts) ? root.counts : {};
  return {
    byCurrency: rows(root.by_currency).map((entry) => ({
      currency: str(entry.currency) ?? 'unknown',
      gross: int(entry.gross),
      refunds: int(entry.refunds),
      fees: int(entry.fees),
      net: int(entry.net),
    })),
    received: int(counts.received),
    processed: int(counts.processed),
    failed: int(counts.failed),
    ignored: int(counts.ignored),
    lastEventAt: str(root.last_event_at),
    definition: str(root.definition) ?? '',
  };
}

export interface SystemHealth {
  databaseTime: string | null;
  counts: Record<string, number>;
  lastPaymentEventAt: string | null;
  lastAuditAt: string | null;
  openReports: number;
  failedPaymentEvents: number;
  unprocessedPaymentEvents: number;
  rateLimits: { action: string; maxEvents: number; windowSeconds: number }[];
}

export async function fetchSystemHealth(): Promise<SystemHealth> {
  const raw = await rpc('admin_system_health');
  const root = isRecord(raw) ? raw : {};
  const counts = isRecord(root.counts) ? root.counts : {};
  const parsedCounts: Record<string, number> = {};
  for (const [key, value] of Object.entries(counts)) {
    parsedCounts[key] = int(value);
  }

  return {
    databaseTime: str(root.database_time),
    counts: parsedCounts,
    lastPaymentEventAt: str(root.last_payment_event_at),
    lastAuditAt: str(root.last_audit_at),
    openReports: int(root.open_reports),
    failedPaymentEvents: int(root.failed_payment_events),
    unprocessedPaymentEvents: int(root.unprocessed_payment_events),
    rateLimits: rows(root.rate_limits).map((entry) => ({
      action: str(entry.action) ?? '',
      maxEvents: int(entry.max_events),
      windowSeconds: int(entry.window_seconds),
    })),
  };
}

export interface RateLimitRule {
  action: string;
  maxEvents: number;
  windowSeconds: number;
  description: string | null;
}

export async function fetchRateLimits(): Promise<RateLimitRule[]> {
  const raw = await rpc('admin_rate_limit_list');
  return rows(raw).map((entry) => ({
    action: str(entry.action) ?? '',
    maxEvents: int(entry.max_events),
    windowSeconds: int(entry.window_seconds),
    description: str(entry.description),
  }));
}

export async function updateRateLimit(
  action: string,
  maxEvents: number,
  windowSeconds: number
): Promise<void> {
  await rpc('admin_update_rate_limit', {
    p_action: action,
    p_max_events: maxEvents,
    p_window_seconds: windowSeconds,
  });
}

export interface AdminSettings {
  maintenanceMode: boolean;
  featureFlags: Record<string, boolean>;
  discoveryPolicy: Record<string, unknown>;
  webhookConfigured: boolean;
  raw: Record<string, unknown>;
}

export async function fetchSettings(): Promise<AdminSettings> {
  const raw = await rpc('admin_settings_get');
  const root = isRecord(raw) ? raw : {};

  const maintenance = isRecord(root.maintenance_mode) ? root.maintenance_mode : {};
  const flagsRaw = isRecord(root.feature_flags) ? root.feature_flags : {};
  const flags: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(flagsRaw)) {
    flags[key] = value === true;
  }
  const policy = isRecord(root.discovery_policy) ? root.discovery_policy : {};
  const secret = isRecord(root.payment_webhook_secret) ? root.payment_webhook_secret : {};

  return {
    maintenanceMode: maintenance.enabled === true,
    featureFlags: flags,
    discoveryPolicy: policy,
    webhookConfigured: secret.configured === true,
    raw: root,
  };
}

export async function saveSetting(key: string, value: unknown): Promise<void> {
  await rpc('admin_settings_set', { p_key: key, p_value: value });
}
