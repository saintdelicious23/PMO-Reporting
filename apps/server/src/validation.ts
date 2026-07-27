import { z } from "zod";
import { categories, healthValues, lifecycleValues, portfolioColumnKeys, portfolioGroupModes, portfolioSortKeys, priorityValues, projectRoleValues, trendValues } from "../../../packages/contracts/src/index.ts";

const nullableText = z.string().trim().max(4000).nullable().optional();
const nullableDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();
const score = z.union([z.literal(0),z.literal(1),z.literal(2),z.literal(3),z.literal(4)]);
const urgencyScore = z.union([score,z.literal(5)]);
const projectRolesSchema=z.array(z.object({
  name:z.string().trim().min(2).max(120),
  role:z.enum(projectRoleValues),
  isPrimary:z.boolean().optional()
})).min(1).max(60).superRefine((roles,ctx)=>{
  if(!roles.some(role=>role.role==="owner"))ctx.addIssue({code:"custom",message:"Projekat mora imati najmanje jednog vlasnika."});
  const seen=new Set<string>();
  for(const [index,assignment] of roles.entries()){
    const key=`${assignment.role}:${assignment.name.toLocaleLowerCase("sr")}`;
    if(seen.has(key))ctx.addIssue({code:"custom",path:[index,"name"],message:"Ista osoba ne može biti dva puta u istoj ulozi."});
    seen.add(key);
  }
  for(const role of projectRoleValues)if(roles.filter(assignment=>assignment.role===role&&assignment.isPrimary).length>1)ctx.addIssue({code:"custom",message:`Uloga ${role} može imati samo jednu glavnu osobu.`});
});

export const projectInputSchema = z.object({
  name: z.string().trim().min(2).max(160),
  category: z.enum(categories),
  leadDepartmentId: z.string().trim().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,"Neispravna šifra sektora").nullable().optional(),
  roles:projectRolesSchema,
  lifecycleStatus: z.enum(lifecycleValues).optional(),
  description: nullableText,
  objective: nullableText,
  outcome: nullableText,
  plannedStart: nullableDate,
  actualStart: nullableDate,
  baselineFinish: nullableDate,
  forecastFinish: nullableDate,
  mandatoryDeadline: nullableDate,
  valueScore: score.optional(),
  urgencyScore: urgencyScore.optional(),
  consequenceScore: score.optional(),
  finalPriority: z.enum(priorityValues).optional(),
  managementAttention: z.boolean().optional(),
  isDemo: z.boolean().optional()
});

export const projectPatchSchema = projectInputSchema.partial();
export const projectUpdateSchema = projectPatchSchema.extend({
  expectedUpdatedAt:z.string().datetime()
});

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
  customViews:z.array(z.object({id:z.string().regex(/^[a-z][a-z0-9_-]{1,31}$/),label:z.string().trim().min(2).max(40),description:z.string().trim().max(160)})).max(20)
}).superRefine((value,ctx)=>{
  const base=["detailed","engaged","executive","goldfish"];
  for(const id of base)if(!value.viewColumns[id])ctx.addIssue({code:"custom",path:["viewColumns",id],message:"Osnovni pregled ne može biti obrisan."});
  const detailed=value.viewColumns.detailed;
  if(detailed&&(detailed.length!==portfolioColumnKeys.length||portfolioColumnKeys.some(column=>!detailed.includes(column))))ctx.addIssue({code:"custom",path:["viewColumns","detailed"],message:"Pregled Sva polja mora sadržati sva raspoloživa polja."});
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
const usernameSchema=z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9._-]+$/,"Korisničko ime može sadržati samo slova, brojeve, tačku, crticu i donju crtu.");
const passwordSchema=z.string().min(8).max(128);
export const authCredentialsSchema=z.object({username:usernameSchema,password:passwordSchema});
export const userInputSchema=authCredentialsSchema;

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
