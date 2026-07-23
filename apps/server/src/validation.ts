import { z } from "zod";
import { categories, healthValues, lifecycleValues, portfolioColumnKeys, portfolioGroupModes, portfolioSortKeys, priorityValues, trendValues } from "../../../packages/contracts/src/index.ts";

const nullableText = z.string().trim().max(4000).nullable().optional();
const nullableDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();
const score = z.union([z.literal(0),z.literal(1),z.literal(2),z.literal(3),z.literal(4)]);
const urgencyScore = z.union([score,z.literal(5)]);

export const projectInputSchema = z.object({
  projectCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9._/-]{1,31}$/).optional(),
  name: z.string().trim().min(2).max(160),
  category: z.enum(categories),
  leadDepartmentId: z.string().trim().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,"Neispravna šifra sektora").nullable().optional(),
  owner: z.string().trim().min(2).max(120),
  sponsor: z.string().trim().max(120).nullable().optional(),
  coordinator: z.string().trim().max(120).nullable().optional(),
  deliveryLead: z.string().trim().max(120).nullable().optional(),
  lifecycleStatus: z.enum(lifecycleValues).optional(),
  description: nullableText,
  objective: nullableText,
  outcome: nullableText,
  baselineFinish: nullableDate,
  forecastFinish: nullableDate,
  mandatoryDeadline: nullableDate,
  valueScore: score.optional(),
  urgencyScore: urgencyScore.optional(),
  consequenceScore: score.optional(),
  finalPriority: z.enum(priorityValues).optional(),
  priorityOverrideReason: nullableText,
  managementAttention: z.boolean().optional(),
  isDemo: z.boolean().optional()
});

export const projectPatchSchema = projectInputSchema.partial();

export const portfolioSettingsSchema = z.object({
  title: z.string().trim().min(2).max(160),
  tagline: z.string().trim().max(500),
  defaultView: z.string().regex(/^[a-z][a-z0-9_-]{1,31}$/),
  defaultGroup: z.enum(portfolioGroupModes),
  defaultSortKey: z.enum(portfolioSortKeys),
  defaultSortDirection: z.enum(["asc", "desc"]),
  pdfView: z.string().regex(/^(current|[a-z][a-z0-9_-]{1,31})$/),
  pdfGroup: z.union([z.literal("current"), z.enum(portfolioGroupModes)]),
  pdfIncludeInactive: z.boolean(),
  headerGraphic: z.string().max(800000).regex(/^data:image\/(png|jpeg|webp);base64,/).nullable(),
  viewColumns: z.record(z.string(),z.array(z.enum(portfolioColumnKeys)).min(1)),
  customViews:z.array(z.object({id:z.string().regex(/^[a-z][a-z0-9_-]{1,31}$/),label:z.string().trim().min(2).max(40),description:z.string().trim().max(160)})).max(20),
  activeUserId:z.string().uuid().nullable()
}).superRefine((value,ctx)=>{
  const base=["detailed","engaged","executive","goldfish"];
  for(const id of base)if(!value.viewColumns[id])ctx.addIssue({code:"custom",path:["viewColumns",id],message:"Osnovni pregled ne može biti obrisan."});
  const customIds=new Set(value.customViews.map(view=>view.id));
  if(customIds.size!==value.customViews.length)ctx.addIssue({code:"custom",path:["customViews"],message:"Nazivi korisničkih pregleda moraju biti jedinstveni."});
  for(const id of customIds)if(!value.viewColumns[id])ctx.addIssue({code:"custom",path:["viewColumns",id],message:"Korisnički pregled nema definisane kolone."});
  if(!value.viewColumns[value.defaultView])ctx.addIssue({code:"custom",path:["defaultView"],message:"Podrazumevani pregled ne postoji."});
  if(value.pdfView!=="current"&&!value.viewColumns[value.pdfView])ctx.addIssue({code:"custom",path:["pdfView"],message:"PDF pregled ne postoji."});
});

export const departmentInputSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{1,15}$/).optional(),
  name: z.string().trim().min(2).max(120)
});

export const departmentMoveSchema = z.object({
  direction: z.enum(["up", "down"])
});
export const userInputSchema=z.object({displayName:z.string().trim().min(2).max(80)});

export const statusInputSchema = z.object({
  health: z.enum(healthValues),
  trend: z.enum(trendValues),
  progress: z.number().min(0).max(100).nullable().optional(),
  forecastFinish: nullableDate,
  nextMilestone: nullableText,
  nextMilestoneDate: nullableDate,
  blockerState: z.enum(["none", "blocked"]),
  topBlocker: nullableText,
  decisionRequired: z.boolean(),
  decisionText: nullableText,
  decisionDueDate: nullableDate,
  managementAttention: z.boolean(),
  summary: nullableText
});
