import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import type { AuditEvent, Department, PortfolioSettings, PortfolioSettingsInput, ProjectDetail, ProjectInput, ProjectRoleAssignment, ProjectRoleInput, ProjectSummary, StatusReportHistoryItem, StatusReportInput } from "../../../packages/contracts/src/index.ts";
import { calculateUrgency, portfolioColumnKeys, suggestPriority } from "../../../packages/contracts/src/index.ts";
import { pool } from "./database.ts";

type Row = QueryResultRow & Record<string, unknown>;
const date = (value: unknown) => value instanceof Date ? value.toISOString().slice(0, 10) : value ? String(value).slice(0, 10) : null;
const timestamp=(value:unknown)=>value instanceof Date?value.toISOString():new Date(String(value)).toISOString();
const auditValue=(key:string,value:unknown)=>["plannedStart","actualStart","baselineFinish","forecastFinish","mandatoryDeadline","nextMilestoneDate","decisionDueDate"].includes(key)?date(value):value??null;
const projectCode=(year:number,departmentCode:string,projectNumber:number)=>`${year}-${departmentCode}-${String(projectNumber).padStart(3,"0")}`;
const completeViewColumns=(value:unknown):PortfolioSettings["viewColumns"]=>{
  const source=(value&&typeof value==="object"?value:{}) as PortfolioSettings["viewColumns"];
  const configured=Array.isArray(source.detailed)?source.detailed:[];
  const valid=[...new Set(configured.filter(column=>(portfolioColumnKeys as readonly string[]).includes(column)))];
  return {...source,detailed:[...valid,...portfolioColumnKeys.filter(column=>!valid.includes(column))]};
};
const mapRoles=(value:unknown):ProjectRoleAssignment[]=>(Array.isArray(value)?value:[]).map((assignment:Record<string,unknown>)=>({
  id:String(assignment.id),
  name:String(assignment.name),
  role:assignment.role as ProjectRoleAssignment["role"],
  isPrimary:Boolean(assignment.isPrimary),
  position:Number(assignment.position)
}));
const normalizeRoles=(roles:ProjectRoleInput[]):ProjectRoleInput[]=>{
  const normalized:ProjectRoleInput[]=[];
  for(const role of ["sponsor","owner","coordinator","executor"] as const){
    const group=roles.filter(assignment=>assignment.role===role).map(assignment=>({...assignment,name:assignment.name.trim()}));
    if(group.length&&!group.some(assignment=>assignment.isPrimary))group[0]!.isPrimary=true;
    normalized.push(...group);
  }
  return normalized;
};
const roleAuditValue=(roles:ProjectRoleInput[])=>{
  const labels={sponsor:"Sponzori",owner:"Vlasnici",coordinator:"Koordinatori",executor:"Izvršioci"} as const;
  return (["sponsor","owner","coordinator","executor"] as const).map(role=>{
    const names=roles.filter(assignment=>assignment.role===role).map(assignment=>`${assignment.name}${assignment.isPrimary?" ★":""}`);
    return names.length?`${labels[role]}: ${names.join(", ")}`:"";
  }).filter(Boolean).join(" | ");
};
async function replaceProjectRoles(client:Pick<PoolClient,"query">,projectId:string,roles:ProjectRoleInput[]){
  const normalized=normalizeRoles(roles);
  await client.query("DELETE FROM project_role_assignments WHERE project_id=$1",[projectId]);
  const positions=new Map<string,number>();
  for(const assignment of normalized){
    const position=positions.get(assignment.role)??0;
    positions.set(assignment.role,position+1);
    await client.query(`INSERT INTO project_role_assignments(id,project_id,role,person_name,is_primary,position)
      VALUES($1,$2,$3,$4,$5,$6)`,[randomUUID(),projectId,assignment.role,assignment.name,Boolean(assignment.isPrimary),position]);
  }
}
async function writeAudit(client:Pick<PoolClient,"query">,entityType:string,entityId:string,action:string,summary:string,changedFields:Record<string,{before:unknown;after:unknown}>|null,actorName="Sistemski korisnik"){
  await client.query(`INSERT INTO audit_events(id,entity_type,entity_id,action,actor_name,summary,changed_fields)
    VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [randomUUID(),entityType,entityId,action,actorName,summary,changedFields?JSON.stringify(changedFields):null]);
}

export class ProjectConflictError extends Error {
  constructor(){super("Projekat je u međuvremenu izmenio drugi korisnik. Osveži projekat pre ponovnog čuvanja.");}
}

function mapSummary(row: Row): ProjectSummary {
  const valueScore = Number(row.value_score) as ProjectSummary["valueScore"];
  const lifecycleStatus = row.lifecycle_status as ProjectSummary["lifecycleStatus"];
  const mandatoryDeadline = date(row.mandatory_deadline);
  const urgencyScore = calculateUrgency(mandatoryDeadline, lifecycleStatus);
  const consequenceScore = Number(row.consequence_score) as ProjectSummary["consequenceScore"];
  return {
    id: String(row.id), projectCode: String(row.project_code), projectNumber: Number(row.project_number), name: String(row.name), category: row.category as ProjectSummary["category"],
    leadDepartment: row.department_name ? String(row.department_name) : null,
    leadDepartmentId: row.lead_department_id ? String(row.lead_department_id) : null, roles:mapRoles(row.roles),
    description:row.description ? String(row.description) : null, objective:row.objective ? String(row.objective) : null, outcome:row.outcome ? String(row.outcome) : null,
    lifecycleStatus, health: (row.health ?? "green") as ProjectSummary["health"],
    trend: (row.trend ?? "stable") as ProjectSummary["trend"], progress: row.progress === null || row.progress === undefined ? null : Number(row.progress),
    plannedStart:date(row.planned_start),actualStart:date(row.actual_start),
    baselineFinish: date(row.baseline_finish), forecastFinish: date(row.status_forecast_finish ?? row.forecast_finish), mandatoryDeadline,
    valueScore, urgencyScore, consequenceScore, finalPriority: row.final_priority as ProjectSummary["finalPriority"],
    suggestedPriority: suggestPriority(valueScore, urgencyScore, consequenceScore), nextMilestone: row.next_milestone ? String(row.next_milestone) : null,
    nextMilestoneDate: date(row.next_milestone_date), blockerState: (row.blocker_state ?? "none") as ProjectSummary["blockerState"],
    topBlocker: row.top_blocker ? String(row.top_blocker) : null, decisionRequired: Boolean(row.decision_required),
    decisionText: row.decision_text ? String(row.decision_text) : null, decisionDueDate: date(row.decision_due_date),
    managementAttention: Boolean(row.status_management_attention ?? row.management_attention), isDemo:Boolean(row.is_demo),
    lastUpdatedAt:timestamp(row.updated_at),lastStatusAt:row.report_created_at?timestamp(row.report_created_at):null
  };
}

const summarySql = `
  SELECT p.*, s.health, s.trend, s.progress, s.forecast_finish AS status_forecast_finish,
    s.next_milestone, s.next_milestone_date, s.blocker_state, s.top_blocker,
    s.decision_required, s.decision_text, s.decision_due_date,
    s.management_attention AS status_management_attention, s.created_at AS report_created_at,
    department.name AS department_name, COALESCE(project_roles.assignments,'[]'::jsonb) AS roles
  FROM projects p
  LEFT JOIN departments department ON department.id = p.lead_department_id
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
      'id',assignment.id,'name',assignment.person_name,'role',assignment.role,
      'isPrimary',assignment.is_primary,'position',assignment.position
    ) ORDER BY assignment.role,assignment.position,lower(assignment.person_name)) AS assignments
    FROM project_role_assignments assignment WHERE assignment.project_id=p.id
  ) project_roles ON true
  LEFT JOIN LATERAL (
    SELECT * FROM status_reports sr WHERE sr.project_id = p.id ORDER BY sr.created_at DESC,sr.id DESC LIMIT 1
  ) s ON true`;

export async function listProjects(): Promise<ProjectSummary[]> {
  const result = await pool!.query(`${summarySql} ORDER BY p.project_number`);
  return result.rows.map(mapSummary);
}

export async function getPortfolioSettings(): Promise<PortfolioSettings> {
  const result = await pool!.query(`SELECT title,tagline,default_view,default_group,default_sort_key,default_sort_direction,
    pdf_view,pdf_group,pdf_include_inactive,header_graphic,view_columns,custom_views,updated_at FROM portfolio_settings WHERE id = 1`);
  const row = result.rows[0];
  return {
    title: String(row.title),
    tagline: String(row.tagline),
    defaultView: row.default_view,
    defaultGroup: row.default_group,
    defaultSortKey: row.default_sort_key,
    defaultSortDirection: row.default_sort_direction,
    pdfView: row.pdf_view,
    pdfGroup: row.pdf_group,
    pdfIncludeInactive: Boolean(row.pdf_include_inactive),
    headerGraphic: row.header_graphic ? String(row.header_graphic) : null,
    viewColumns: completeViewColumns(row.view_columns), customViews:row.custom_views ?? [],
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

export async function updatePortfolioSettings(input: PortfolioSettingsInput): Promise<PortfolioSettings> {
  const viewColumns=completeViewColumns(input.viewColumns);
  const result = await pool!.query(
    `INSERT INTO portfolio_settings
      (id,title,tagline,default_view,default_group,default_sort_key,default_sort_direction,pdf_view,pdf_group,pdf_include_inactive,header_graphic,view_columns,custom_views,updated_at)
     VALUES (1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,now())
     ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,tagline=EXCLUDED.tagline,default_view=EXCLUDED.default_view,
       default_group=EXCLUDED.default_group,default_sort_key=EXCLUDED.default_sort_key,default_sort_direction=EXCLUDED.default_sort_direction,
       pdf_view=EXCLUDED.pdf_view,pdf_group=EXCLUDED.pdf_group,pdf_include_inactive=EXCLUDED.pdf_include_inactive,
       header_graphic=EXCLUDED.header_graphic,view_columns=EXCLUDED.view_columns,custom_views=EXCLUDED.custom_views,updated_at=now()
     RETURNING title,tagline,default_view,default_group,default_sort_key,default_sort_direction,pdf_view,pdf_group,pdf_include_inactive,header_graphic,view_columns,custom_views,updated_at`,
    [input.title,input.tagline,input.defaultView,input.defaultGroup,input.defaultSortKey,input.defaultSortDirection,input.pdfView,input.pdfGroup,input.pdfIncludeInactive,input.headerGraphic,JSON.stringify(viewColumns),JSON.stringify(input.customViews)]
  );
  const row = result.rows[0];
  return {
    title:String(row.title),tagline:String(row.tagline),defaultView:row.default_view,defaultGroup:row.default_group,
    defaultSortKey:row.default_sort_key,defaultSortDirection:row.default_sort_direction,pdfView:row.pdf_view,pdfGroup:row.pdf_group,
    pdfIncludeInactive:Boolean(row.pdf_include_inactive),headerGraphic:row.header_graphic?String(row.header_graphic):null,viewColumns:completeViewColumns(row.view_columns),customViews:row.custom_views??[],updatedAt:new Date(row.updated_at).toISOString()
  };
}

const mapDepartment = (row:Row):Department => ({
  id:String(row.id),code:String(row.code),name:String(row.name),position:Number(row.position),
  createdAt:new Date(String(row.created_at)).toISOString(),updatedAt:new Date(String(row.updated_at)).toISOString()
});

export async function listDepartments():Promise<Department[]> {
  const result=await pool!.query("SELECT * FROM departments ORDER BY position,lower(name)");
  return result.rows.map(mapDepartment);
}

export async function createDepartment(code:string,name:string,actorName?:string):Promise<Department> {
  const client=await pool.connect();
  try {
  await client.query("BEGIN");await client.query("LOCK TABLE departments IN SHARE ROW EXCLUSIVE MODE");
  const duplicate=await client.query("SELECT 1 FROM departments WHERE lower(name)=lower($1) OR lower(code)=lower($2)",[name,code]);
  if(duplicate.rowCount) throw new Error("Sektor sa tim nazivom već postoji.");
  const result=await client.query(`INSERT INTO departments (id,code,name,position) VALUES ($1,$2,$3,(SELECT COALESCE(MAX(position),0)+1 FROM departments)) RETURNING *`,[randomUUID(),code,name]);
  const department=mapDepartment(result.rows[0]);await writeAudit(client,"department",department.id,"created","Sektor je kreiran.",{code:{before:null,after:code},name:{before:null,after:name}},actorName);await client.query("COMMIT");return department;
  } catch(error) { await client.query("ROLLBACK");throw error; } finally { client.release(); }
}

export async function renameDepartment(id:string,code:string|undefined,name:string,actorName?:string):Promise<Department|undefined> {
  const client=await pool!.connect();
  try {
    await client.query("BEGIN");
    const current=await client.query("SELECT * FROM departments WHERE id=$1 FOR UPDATE",[id]);
    if(!current.rowCount){await client.query("ROLLBACK");return undefined;}
    code ??= String(current.rows[0].code);
    const duplicate=await client.query("SELECT 1 FROM departments WHERE (lower(name)=lower($1) OR lower(code)=lower($2)) AND id<>$3",[name,code,id]);
    if(duplicate.rowCount) throw new Error("Sektor sa tim nazivom već postoji.");
    const updated=await client.query("UPDATE departments SET code=$1,name=$2,updated_at=now() WHERE id=$3 RETURNING *",[code,name,id]);
    const department=mapDepartment(updated.rows[0]);await writeAudit(client,"department",id,"updated","Sektor je izmenjen.",{code:{before:current.rows[0].code,after:code},name:{before:current.rows[0].name,after:name}},actorName);
    await client.query("COMMIT");
    return department;
  } catch(error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function moveDepartment(id:string,direction:"up"|"down",actorName?:string):Promise<Department|undefined> {
  const client=await pool!.connect();
  try {
    await client.query("BEGIN");
    const current=await client.query("SELECT * FROM departments WHERE id=$1 FOR UPDATE",[id]);
    if(!current.rowCount){await client.query("ROLLBACK");return undefined;}
    const comparison=direction==="up"?"<":">";
    const ordering=direction==="up"?"DESC":"ASC";
    const neighbor=await client.query(`SELECT * FROM departments WHERE position ${comparison} $1 ORDER BY position ${ordering},lower(name) ${ordering} LIMIT 1 FOR UPDATE`,[current.rows[0].position]);
    if(neighbor.rowCount){
      await client.query("UPDATE departments SET position=$1,updated_at=now() WHERE id=$2",[neighbor.rows[0].position,id]);
      await client.query("UPDATE departments SET position=$1,updated_at=now() WHERE id=$2",[current.rows[0].position,neighbor.rows[0].id]);
      await writeAudit(client,"department",id,"moved","Promenjen je redosled sektora.",{position:{before:current.rows[0].position,after:neighbor.rows[0].position}},actorName);
    }
    const updated=await client.query("SELECT * FROM departments WHERE id=$1",[id]);
    await client.query("COMMIT");
    return mapDepartment(updated.rows[0]);
  } catch(error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function deleteDepartment(id:string,actorName?:string):Promise<{deleted:boolean;affectedProjects:number}> {
  const client=await pool!.connect();
  try {
    await client.query("BEGIN");
    const current=await client.query("SELECT name FROM departments WHERE id=$1 FOR UPDATE",[id]);
    if(!current.rowCount){await client.query("ROLLBACK");return {deleted:false,affectedProjects:0};}
    const affected=await client.query("UPDATE projects SET lead_department_id=NULL,updated_at=now() WHERE lead_department_id=$1",[id]);
    await client.query("DELETE FROM departments WHERE id=$1",[id]);
    await writeAudit(client,"department",id,"deleted","Sektor je izbrisan.",{name:{before:current.rows[0].name,after:null}},actorName);
    await client.query("COMMIT");
    return {deleted:true,affectedProjects:affected.rowCount ?? 0};
  } catch(error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function getProject(id: string): Promise<ProjectDetail | undefined> {
  const projectResult = await pool!.query(`${summarySql} WHERE p.id = $1`, [id]);
  if (!projectResult.rows[0]) return undefined;
  return mapSummary(projectResult.rows[0]);
}

export async function createProject(input: ProjectInput,actorName?:string): Promise<ProjectDetail> {
  const id = randomUUID();
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const projectNumber=Number((await client.query("SELECT nextval('project_number_seq') AS value")).rows[0].value);
    const department=input.leadDepartmentId
      ? await client.query("SELECT code FROM departments WHERE id=$1",[input.leadDepartmentId])
      : null;
    if(input.leadDepartmentId&&!department?.rowCount)throw new Error("Izabrani sektor ne postoji.");
    const generatedProjectCode=projectCode(new Date().getUTCFullYear(),String(department?.rows[0]?.code??"GEN"),projectNumber);
    const value=input.valueScore??0,urgency=calculateUrgency(input.mandatoryDeadline??null,input.lifecycleStatus??"planning"),consequence=input.consequenceScore??0;
    const suggested=suggestPriority(value,urgency,consequence);
    await client.query(`INSERT INTO projects
      (id,project_number,project_code,name,category,lead_department_id,lifecycle_status,description,objective,outcome,planned_start,actual_start,baseline_finish,forecast_finish,mandatory_deadline,value_score,urgency_score,consequence_score,final_priority,management_attention,is_demo)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [id,projectNumber,generatedProjectCode,input.name,input.category,input.leadDepartmentId??null,input.lifecycleStatus??"planning",input.description??null,input.objective??null,input.outcome??null,input.plannedStart??null,input.actualStart??null,input.baselineFinish??null,input.forecastFinish??null,input.mandatoryDeadline??null,value,urgency,consequence,input.finalPriority??suggested,input.managementAttention??false,input.isDemo??false]);
    await replaceProjectRoles(client,id,input.roles);
    await writeAudit(client,"project",id,"created","Projekat je kreiran.",null,actorName);await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  return (await getProject(id))!;
}

export async function updateProject(id: string, input: Partial<ProjectInput>,expectedUpdatedAt?:string,actorName?:string): Promise<ProjectDetail | undefined> {
  const client=await pool.connect();
  const fields: string[] = [], values: unknown[] = [];
  const map: Record<string, string> = { name:"name",category:"category",leadDepartmentId:"lead_department_id",lifecycleStatus:"lifecycle_status",description:"description",objective:"objective",outcome:"outcome",plannedStart:"planned_start",actualStart:"actual_start",baselineFinish:"baseline_finish",mandatoryDeadline:"mandatory_deadline",valueScore:"value_score",consequenceScore:"consequence_score",finalPriority:"final_priority",isDemo:"is_demo" };
  for (const [key, column] of Object.entries(map)) {
    if (!(key in input)) continue;
    values.push(input[key as keyof ProjectInput] ?? null);
    fields.push(`${column} = $${values.length}`);
  }
  if(!fields.length&&!("roles" in input)){client.release();return getProject(id);}
  try{
    await client.query("BEGIN");const locked=await client.query("SELECT * FROM projects WHERE id=$1 FOR UPDATE",[id]);if(!locked.rowCount){await client.query("ROLLBACK");return undefined;}
    if(expectedUpdatedAt&&timestamp(locked.rows[0].updated_at)!==expectedUpdatedAt)throw new ProjectConflictError();
    const nextBaseline=input.baselineFinish===undefined?date(locked.rows[0].baseline_finish):input.baselineFinish;
    const nextMandatory=input.mandatoryDeadline===undefined?date(locked.rows[0].mandatory_deadline):input.mandatoryDeadline;
    if(nextBaseline&&nextMandatory&&nextBaseline>nextMandatory)throw new Error("Prvobitni rok ne može biti posle obaveznog krajnjeg roka.");
    if(input.lifecycleStatus==="completed"&&locked.rows[0].lifecycle_status!=="completed"){
      const latest=await client.query("SELECT progress FROM status_reports WHERE project_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1",[id]);
      if(Number(latest.rows[0]?.progress)!==100)throw new Error("Pre završavanja projekta sačuvaj status sa 100% napretka.");
    }
    const changed:Record<string,{before:unknown;after:unknown}>={};for(const [key,column] of Object.entries(map)){if(!(key in input))continue;const before=auditValue(key,locked.rows[0][column]),after=auditValue(key,input[key as keyof ProjectInput]);if(String(before??"")!==String(after??""))changed[key]={before,after};}
    if(input.roles){
      const beforeRoles=mapRoles((await client.query(`SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id',id,'name',person_name,'role',role,'isPrimary',is_primary,'position',position
      ) ORDER BY role,position),'[]'::jsonb) AS roles FROM project_role_assignments WHERE project_id=$1`,[id])).rows[0].roles);
      const nextRoles=normalizeRoles(input.roles);
      if(JSON.stringify(roleAuditValue(beforeRoles))!==JSON.stringify(roleAuditValue(nextRoles)))changed.roles={before:roleAuditValue(beforeRoles),after:roleAuditValue(nextRoles)};
      await replaceProjectRoles(client,id,nextRoles);
    }
    if(fields.length){values.push(id);await client.query(`UPDATE projects SET ${fields.join(", ")}, updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE id=$${values.length}`,values);}
    else await client.query("UPDATE projects SET updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE id=$1",[id]);
    if(Object.keys(changed).length)await writeAudit(client,"project",id,"updated","Izmenjeni su podaci projekta.",changed,actorName);
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  return getProject(id);
}

export async function deleteProject(id:string,actorName?:string):Promise<boolean>{
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const current=await client.query("SELECT project_code,name FROM projects WHERE id=$1 FOR UPDATE",[id]);
    if(!current.rowCount){await client.query("ROLLBACK");return false;}
    await writeAudit(client,"project",id,"deleted","Projekat je obrisan.",{
      projectCode:{before:current.rows[0].project_code,after:null},
      name:{before:current.rows[0].name,after:null}
    },actorName);
    await client.query("DELETE FROM projects WHERE id=$1",[id]);
    await client.query("COMMIT");
    return true;
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

export async function addStatusReport(projectId: string, input: StatusReportInput,actorName?:string): Promise<ProjectDetail | undefined> {
  const client=await pool.connect();
  try{
    await client.query("BEGIN");const exists=await client.query("SELECT 1 FROM projects WHERE id=$1 FOR UPDATE",[projectId]);if(!exists.rowCount){await client.query("ROLLBACK");return undefined;}
    const previous=(await client.query("SELECT * FROM status_reports WHERE project_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1",[projectId])).rows[0];
    await client.query(`INSERT INTO status_reports
      (id,project_id,health,trend,progress,forecast_finish,next_milestone,next_milestone_date,blocker_state,top_blocker,decision_required,decision_text,decision_due_date,management_attention,summary,version_number)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,(SELECT COALESCE(MAX(version_number),0)+1 FROM status_reports WHERE project_id=$2))`,
      [randomUUID(),projectId,input.health,input.trend,input.progress??null,input.forecastFinish??null,input.nextMilestone??null,input.nextMilestoneDate??null,input.blockerState,input.topBlocker??null,input.decisionRequired,input.decisionText??null,input.decisionDueDate??null,input.managementAttention,input.summary]);
    if(input.blockerState==="blocked"){
      await client.query(`UPDATE projects SET
        lifecycle_before_block=CASE WHEN lifecycle_status<>'blocked' THEN lifecycle_status ELSE lifecycle_before_block END,
        lifecycle_status='blocked' WHERE id=$1`,[projectId]);
    }else{
      await client.query(`UPDATE projects SET lifecycle_status=lifecycle_before_block,lifecycle_before_block=NULL
        WHERE id=$1 AND lifecycle_status='blocked' AND lifecycle_before_block IS NOT NULL`,[projectId]);
    }
    await client.query("UPDATE projects SET updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE id=$1",[projectId]);
    const statusMap:Record<string,string>={health:"health",trend:"trend",progress:"progress",forecastFinish:"forecast_finish",nextMilestone:"next_milestone",nextMilestoneDate:"next_milestone_date",blockerState:"blocker_state",topBlocker:"top_blocker",decisionRequired:"decision_required",decisionText:"decision_text",decisionDueDate:"decision_due_date",managementAttention:"management_attention",summary:"summary"};
    const changed:Record<string,{before:unknown;after:unknown}>={};for(const [key,value] of Object.entries(input)){const before=auditValue(key,previous?.[statusMap[key]!]),after=auditValue(key,value);if(String(before??"")!==String(after??""))changed[key]={before,after};}
    await writeAudit(client,"project",projectId,"status_updated","Dodat je novi statusni presek.",changed,actorName);await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  return getProject(projectId);
}

export async function listStatusReports(projectId:string):Promise<StatusReportHistoryItem[]> {
  const result=await pool!.query("SELECT * FROM status_reports WHERE project_id=$1 ORDER BY created_at DESC,id DESC",[projectId]);
  return result.rows.map(row=>({id:String(row.id),createdAt:new Date(row.created_at).toISOString(),health:row.health,trend:row.trend,
    progress:row.progress===null?null:Number(row.progress),forecastFinish:date(row.forecast_finish),nextMilestone:row.next_milestone,
    nextMilestoneDate:date(row.next_milestone_date),blockerState:row.blocker_state,topBlocker:row.top_blocker,
    decisionRequired:Boolean(row.decision_required),decisionText:row.decision_text,decisionDueDate:date(row.decision_due_date),
    managementAttention:Boolean(row.management_attention),summary:row.summary,versionNumber:Number(row.version_number)}));
}

export async function listAuditEvents(projectId:string):Promise<AuditEvent[]> {
  const result=await pool!.query("SELECT * FROM audit_events WHERE entity_type='project' AND entity_id=$1 ORDER BY occurred_at DESC",[projectId]);
  return result.rows.map(row=>({id:String(row.id),entityType:row.entity_type,entityId:String(row.entity_id),action:String(row.action),
    actorName:String(row.actor_name),summary:row.summary?String(row.summary):null,changedFields:row.changed_fields??null,occurredAt:new Date(row.occurred_at).toISOString()}));
}
