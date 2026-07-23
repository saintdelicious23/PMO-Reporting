export const categories = ["strategic", "mandatory", "operational_improvement"] as const;
export type ProjectCategory = (typeof categories)[number];

export const healthValues = ["green", "amber", "red", "critical"] as const;
export type ProjectHealth = (typeof healthValues)[number];

export const lifecycleValues = ["planning", "active", "on_hold", "blocked", "completed", "cancelled"] as const;
export type LifecycleStatus = (typeof lifecycleValues)[number];

export const priorityValues = ["low", "medium", "high", "very_high", "critical"] as const;
export type Priority = (typeof priorityValues)[number];

export const trendValues = ["improving", "stable", "declining"] as const;
export type Trend = (typeof trendValues)[number];

export type Score = 0 | 1 | 2 | 3 | 4;
export type UrgencyScore = Score | 5;

export type PortfolioViewMode = "detailed" | "engaged" | "executive" | "goldfish";

export const portfolioGroupModes = ["category", "all"] as const;
export type PortfolioGroupMode = (typeof portfolioGroupModes)[number];
export const portfolioSortKeys = ["id", "projectNumber", "name", "category", "leadDepartment", "owner", "sponsor", "coordinator", "deliveryLead", "lifecycleStatus", "description", "objective", "outcome", "health", "trend", "progress", "baselineFinish", "forecastFinish", "mandatoryDeadline", "valueScore", "urgencyScore", "consequenceScore", "finalPriority", "suggestedPriority", "nextMilestone", "nextMilestoneDate", "blockerState", "topBlocker", "decisionRequired", "decisionText", "decisionDueDate", "managementAttention", "isDemo", "lastUpdatedAt"] as const;
export type PortfolioSortKey = (typeof portfolioSortKeys)[number];
export const portfolioColumnKeys = ["name", "id", "projectNumber", "category", "lifecycleStatus", "health", "trend", "owner", "sponsor", "coordinator", "deliveryLead", "department", "description", "objective", "outcome", "valueScore", "urgencyScore", "consequenceScore", "finalPriority", "suggestedPriority", "progress", "baselineFinish", "forecastFinish", "mandatoryDeadline", "nextMilestone", "nextMilestoneDate", "blockerState", "blocker", "decisionRequired", "decisionText", "decisionDueDate", "managementAttention", "isDemo", "lastUpdatedAt"] as const;
export type PortfolioColumnKey = (typeof portfolioColumnKeys)[number];
export type PortfolioViewColumns = Record<string, PortfolioColumnKey[]>;
export interface CustomPortfolioView { id:string; label:string; description:string; }

export interface PortfolioSettings {
  title: string;
  tagline: string;
  defaultView: string;
  defaultGroup: PortfolioGroupMode;
  defaultSortKey: PortfolioSortKey;
  defaultSortDirection: "asc" | "desc";
  pdfView: string;
  pdfGroup: PortfolioGroupMode | "current";
  pdfIncludeInactive: boolean;
  headerGraphic: string | null;
  viewColumns: PortfolioViewColumns;
  customViews: CustomPortfolioView[];
  activeUserId:string | null;
  updatedAt: string;
}

export type PortfolioSettingsInput = Omit<PortfolioSettings, "updatedAt">;

export interface Department {
  id: string;
  code: string;
  name: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSummary {
  id: string;
  projectCode: string;
  projectNumber: number;
  name: string;
  category: ProjectCategory;
  leadDepartment: string | null;
  leadDepartmentId: string | null;
  owner: string;
  sponsor: string | null;
  coordinator: string | null;
  deliveryLead: string | null;
  description: string | null;
  objective: string | null;
  outcome: string | null;
  lifecycleStatus: LifecycleStatus;
  health: ProjectHealth;
  trend: Trend;
  progress: number | null;
  baselineFinish: string | null;
  forecastFinish: string | null;
  mandatoryDeadline: string | null;
  valueScore: Score;
  urgencyScore: UrgencyScore;
  consequenceScore: Score;
  finalPriority: Priority;
  priorityOverrideReason: string | null;
  suggestedPriority: Priority;
  nextMilestone: string | null;
  nextMilestoneDate: string | null;
  blockerState: "none" | "blocked";
  topBlocker: string | null;
  decisionRequired: boolean;
  decisionText: string | null;
  decisionDueDate: string | null;
  managementAttention: boolean;
  isDemo: boolean;
  lastUpdatedAt: string;
  lastStatusAt: string | null;
}

export interface ProjectDetail extends ProjectSummary {}

export interface ProjectInput {
  projectCode?: string;
  name: string;
  category: ProjectCategory;
  leadDepartmentId?: string | null;
  owner: string;
  sponsor?: string | null;
  coordinator?: string | null;
  deliveryLead?: string | null;
  lifecycleStatus?: LifecycleStatus;
  description?: string | null;
  objective?: string | null;
  outcome?: string | null;
  baselineFinish?: string | null;
  forecastFinish?: string | null;
  mandatoryDeadline?: string | null;
  valueScore?: Score;
  urgencyScore?: UrgencyScore;
  consequenceScore?: Score;
  finalPriority?: Priority;
  priorityOverrideReason?: string | null;
  managementAttention?: boolean;
  isDemo?: boolean;
}

export interface AuditEvent {
  id:string;
  entityType:"project"|"department"|"status_report";
  entityId:string;
  action:string;
  actorName:string;
  summary:string | null;
  changedFields:Record<string,{before:unknown;after:unknown}> | null;
  occurredAt:string;
}

export function calculateUrgency(mandatoryDeadline: string | null, lifecycleStatus: LifecycleStatus, today = new Date()): UrgencyScore {
  if (!mandatoryDeadline || lifecycleStatus === "completed" || lifecycleStatus === "cancelled") return 0;
  const deadline = Date.parse(`${mandatoryDeadline.slice(0, 10)}T00:00:00Z`);
  const current = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const days = Math.round((deadline - current) / 86_400_000);
  if (days < 0) return 5;
  if (days <= 30) return 4;
  if (days <= 60) return 3;
  if (days <= 90) return 2;
  if (days <= 180) return 1;
  return 0;
}

export interface StatusReportInput {
  health: ProjectHealth;
  trend: Trend;
  progress?: number | null;
  forecastFinish?: string | null;
  nextMilestone?: string | null;
  nextMilestoneDate?: string | null;
  blockerState: "none" | "blocked";
  topBlocker?: string | null;
  decisionRequired: boolean;
  decisionText?: string | null;
  decisionDueDate?: string | null;
  managementAttention: boolean;
  summary?: string | null;
}

export interface StatusReportHistoryItem extends StatusReportInput {
  id:string;
  createdAt:string;
  versionNumber:number;
}

export interface AppUser {
  id:string;
  displayName:string;
  isActive:boolean;
  createdAt:string;
  updatedAt:string;
}

const priorityMatrix: Priority[][] = [
  ["low", "low", "low", "medium", "high", "very_high"],
  ["low", "low", "low", "medium", "high", "very_high"],
  ["low", "low", "medium", "high", "very_high", "critical"],
  ["medium", "medium", "high", "very_high", "very_high", "critical"],
  ["medium", "high", "very_high", "very_high", "critical", "critical"]
];

export function suggestPriority(value: Score, urgency: UrgencyScore, consequence: Score): Priority {
  const base = priorityMatrix[value]?.[urgency] ?? "low";
  if (urgency < 2 || consequence < 3) return base;
  const order: Priority[] = ["low", "medium", "high", "very_high", "critical"];
  const index = order.indexOf(base);
  const lift = consequence === 4 ? 1 : 0;
  return order[Math.min(index + lift, order.length - 1)] ?? base;
}
