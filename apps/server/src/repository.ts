import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import type { AppUser, AuditEvent, Department, PortfolioSettings, PortfolioSettingsInput, ProjectDetail, ProjectInput, ProjectSummary, StatusReportHistoryItem, StatusReportInput } from "../../../packages/contracts/src/index.ts";
import { calculateUrgency, suggestPriority } from "../../../packages/contracts/src/index.ts";
import { pool } from "./database.ts";

type Row = QueryResultRow & Record<string, unknown>;
const date = (value: unknown) => value instanceof Date ? value.toISOString().slice(0, 10) : value ? String(value).slice(0, 10) : null;
const auditValue=(key:string,value:unknown)=>["baselineFinish","forecastFinish","mandatoryDeadline","nextMilestoneDate","decisionDueDate"].includes(key)?date(value):value??null;
async function writeAudit(client:Pick<PoolClient,"query">,entityType:string,entityId:string,action:string,summary:string,changedFields:Record<string,{before:unknown;after:unknown}>|null){
  await client.query(`INSERT INTO audit_events(id,entity_type,entity_id,action,actor_name,summary,changed_fields)
    VALUES($1,$2,$3,$4,COALESCE((SELECT u.display_name FROM portfolio_settings s JOIN app_users u ON u.id=s.active_user_id WHERE s.id=1),'Lokalni korisnik'),$5,$6::jsonb)`,
    [randomUUID(),entityType,entityId,action,summary,changedFields?JSON.stringify(changedFields):null]);
}

function mapSummary(row: Row): ProjectSummary {
  const valueScore = Number(row.value_score) as ProjectSummary["valueScore"];
  const lifecycleStatus = row.lifecycle_status as ProjectSummary["lifecycleStatus"];
  const mandatoryDeadline = date(row.mandatory_deadline);
  const urgencyScore = calculateUrgency(mandatoryDeadline, lifecycleStatus);
  const consequenceScore = Number(row.consequence_score) as ProjectSummary["consequenceScore"];
  return {
    id: String(row.id), projectCode: String(row.project_code ?? `PRJ-${String(row.project_number).padStart(4,"0")}`), projectNumber: Number(row.project_number), name: String(row.name), category: row.category as ProjectSummary["category"],
    leadDepartment: row.department_name ? String(row.department_name) : null,
    leadDepartmentId: row.lead_department_id ? String(row.lead_department_id) : null, owner: String(row.owner), sponsor: row.sponsor ? String(row.sponsor) : null,
    coordinator: row.coordinator ? String(row.coordinator) : null, deliveryLead: row.delivery_lead ? String(row.delivery_lead) : null,
    description:row.description ? String(row.description) : null, objective:row.objective ? String(row.objective) : null, outcome:row.outcome ? String(row.outcome) : null,
    lifecycleStatus, health: (row.health ?? "green") as ProjectSummary["health"],
    trend: (row.trend ?? "stable") as ProjectSummary["trend"], progress: row.progress === null || row.progress === undefined ? null : Number(row.progress),
    baselineFinish: date(row.baseline_finish), forecastFinish: date(row.status_forecast_finish ?? row.forecast_finish), mandatoryDeadline,
    valueScore, urgencyScore, consequenceScore, finalPriority: row.final_priority as ProjectSummary["finalPriority"],
    priorityOverrideReason:row.priority_override_reason ? String(row.priority_override_reason) : null,
    suggestedPriority: suggestPriority(valueScore, urgencyScore, consequenceScore), nextMilestone: row.next_milestone ? String(row.next_milestone) : null,
    nextMilestoneDate: date(row.next_milestone_date), blockerState: (row.blocker_state ?? "none") as ProjectSummary["blockerState"],
    topBlocker: row.top_blocker ? String(row.top_blocker) : null, decisionRequired: Boolean(row.decision_required),
    decisionText: row.decision_text ? String(row.decision_text) : null, decisionDueDate: date(row.decision_due_date),
    managementAttention: Boolean(row.status_management_attention ?? row.management_attention), isDemo:Boolean(row.is_demo),
    lastUpdatedAt:new Date(String(row.updated_at)).toISOString(),lastStatusAt:row.report_created_at?new Date(String(row.report_created_at)).toISOString():null
  };
}

const summarySql = `
  SELECT p.*, s.health, s.trend, s.progress, s.forecast_finish AS status_forecast_finish,
    s.next_milestone, s.next_milestone_date, s.blocker_state, s.top_blocker,
    s.decision_required, s.decision_text, s.decision_due_date,
    s.management_attention AS status_management_attention, s.created_at AS report_created_at,
    department.name AS department_name
  FROM projects p
  LEFT JOIN departments department ON department.id = p.lead_department_id
  LEFT JOIN LATERAL (
    SELECT * FROM status_reports sr WHERE sr.project_id = p.id ORDER BY sr.created_at DESC,sr.id DESC LIMIT 1
  ) s ON true`;

export async function listProjects(): Promise<ProjectSummary[]> {
  const result = await pool!.query(`${summarySql} ORDER BY p.project_number`);
  return result.rows.map(mapSummary);
}

export async function getPortfolioSettings(): Promise<PortfolioSettings> {
  const result = await pool!.query(`SELECT title,tagline,default_view,default_group,default_sort_key,default_sort_direction,
    pdf_view,pdf_group,pdf_include_inactive,header_graphic,view_columns,custom_views,active_user_id,updated_at FROM portfolio_settings WHERE id = 1`);
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
    viewColumns: row.view_columns, customViews:row.custom_views ?? [],activeUserId:row.active_user_id?String(row.active_user_id):null,
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

export async function updatePortfolioSettings(input: PortfolioSettingsInput): Promise<PortfolioSettings> {
  const result = await pool!.query(
    `INSERT INTO portfolio_settings
      (id,title,tagline,default_view,default_group,default_sort_key,default_sort_direction,pdf_view,pdf_group,pdf_include_inactive,header_graphic,view_columns,custom_views,active_user_id,updated_at)
     VALUES (1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,now())
     ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,tagline=EXCLUDED.tagline,default_view=EXCLUDED.default_view,
       default_group=EXCLUDED.default_group,default_sort_key=EXCLUDED.default_sort_key,default_sort_direction=EXCLUDED.default_sort_direction,
       pdf_view=EXCLUDED.pdf_view,pdf_group=EXCLUDED.pdf_group,pdf_include_inactive=EXCLUDED.pdf_include_inactive,
       header_graphic=EXCLUDED.header_graphic,view_columns=EXCLUDED.view_columns,custom_views=EXCLUDED.custom_views,active_user_id=EXCLUDED.active_user_id,updated_at=now()
     RETURNING title,tagline,default_view,default_group,default_sort_key,default_sort_direction,pdf_view,pdf_group,pdf_include_inactive,header_graphic,view_columns,custom_views,active_user_id,updated_at`,
    [input.title,input.tagline,input.defaultView,input.defaultGroup,input.defaultSortKey,input.defaultSortDirection,input.pdfView,input.pdfGroup,input.pdfIncludeInactive,input.headerGraphic,JSON.stringify(input.viewColumns),JSON.stringify(input.customViews),input.activeUserId]
  );
  const row = result.rows[0];
  return {
    title:String(row.title),tagline:String(row.tagline),defaultView:row.default_view,defaultGroup:row.default_group,
    defaultSortKey:row.default_sort_key,defaultSortDirection:row.default_sort_direction,pdfView:row.pdf_view,pdfGroup:row.pdf_group,
    pdfIncludeInactive:Boolean(row.pdf_include_inactive),headerGraphic:row.header_graphic?String(row.header_graphic):null,viewColumns:row.view_columns,customViews:row.custom_views??[],activeUserId:row.active_user_id?String(row.active_user_id):null,updatedAt:new Date(row.updated_at).toISOString()
  };
}

const mapUser=(row:Row):AppUser=>({id:String(row.id),displayName:String(row.display_name),isActive:Boolean(row.is_active),createdAt:new Date(row.created_at).toISOString(),updatedAt:new Date(row.updated_at).toISOString()});
export async function listUsers():Promise<AppUser[]>{const result=await pool.query("SELECT * FROM app_users WHERE is_active=true ORDER BY lower(display_name)");return result.rows.map(mapUser);}
export async function createUser(displayName:string):Promise<AppUser>{const result=await pool.query("INSERT INTO app_users(id,display_name) VALUES($1,$2) RETURNING *",[randomUUID(),displayName]);return mapUser(result.rows[0]);}

const mapDepartment = (row:Row):Department => ({
  id:String(row.id),code:String(row.code),name:String(row.name),position:Number(row.position),
  createdAt:new Date(String(row.created_at)).toISOString(),updatedAt:new Date(String(row.updated_at)).toISOString()
});

export async function listDepartments():Promise<Department[]> {
  const result=await pool!.query("SELECT * FROM departments ORDER BY position,lower(name)");
  return result.rows.map(mapDepartment);
}

export async function createDepartment(code:string,name:string):Promise<Department> {
  const client=await pool.connect();
  try {
  await client.query("BEGIN");await client.query("LOCK TABLE departments IN SHARE ROW EXCLUSIVE MODE");
  const duplicate=await client.query("SELECT 1 FROM departments WHERE lower(name)=lower($1) OR lower(code)=lower($2)",[name,code]);
  if(duplicate.rowCount) throw new Error("Sektor sa tim nazivom već postoji.");
  const result=await client.query(`INSERT INTO departments (id,code,name,position) VALUES ($1,$2,$3,(SELECT COALESCE(MAX(position),0)+1 FROM departments)) RETURNING *`,[randomUUID(),code,name]);
  const department=mapDepartment(result.rows[0]);await writeAudit(client,"department",department.id,"created","Sektor je kreiran.",{code:{before:null,after:code},name:{before:null,after:name}});await client.query("COMMIT");return department;
  } catch(error) { await client.query("ROLLBACK");throw error; } finally { client.release(); }
}

export async function renameDepartment(id:string,code:string|undefined,name:string):Promise<Department|undefined> {
  const client=await pool!.connect();
  try {
    await client.query("BEGIN");
    const current=await client.query("SELECT * FROM departments WHERE id=$1 FOR UPDATE",[id]);
    if(!current.rowCount){await client.query("ROLLBACK");return undefined;}
    code ??= String(current.rows[0].code);
    const duplicate=await client.query("SELECT 1 FROM departments WHERE (lower(name)=lower($1) OR lower(code)=lower($2)) AND id<>$3",[name,code,id]);
    if(duplicate.rowCount) throw new Error("Sektor sa tim nazivom već postoji.");
    const updated=await client.query("UPDATE departments SET code=$1,name=$2,updated_at=now() WHERE id=$3 RETURNING *",[code,name,id]);
    const department=mapDepartment(updated.rows[0]);await writeAudit(client,"department",id,"updated","Sektor je izmenjen.",{code:{before:current.rows[0].code,after:code},name:{before:current.rows[0].name,after:name}});
    await client.query("COMMIT");
    return department;
  } catch(error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function moveDepartment(id:string,direction:"up"|"down"):Promise<Department|undefined> {
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
      await writeAudit(client,"department",id,"moved","Promenjen je redosled sektora.",{position:{before:current.rows[0].position,after:neighbor.rows[0].position}});
    }
    const updated=await client.query("SELECT * FROM departments WHERE id=$1",[id]);
    await client.query("COMMIT");
    return mapDepartment(updated.rows[0]);
  } catch(error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function deleteDepartment(id:string):Promise<{deleted:boolean;affectedProjects:number}> {
  const client=await pool!.connect();
  try {
    await client.query("BEGIN");
    const current=await client.query("SELECT name FROM departments WHERE id=$1 FOR UPDATE",[id]);
    if(!current.rowCount){await client.query("ROLLBACK");return {deleted:false,affectedProjects:0};}
    const affected=await client.query("UPDATE projects SET lead_department_id=NULL,updated_at=now() WHERE lead_department_id=$1",[id]);
    await client.query("DELETE FROM departments WHERE id=$1",[id]);
    await writeAudit(client,"department",id,"deleted","Sektor je izbrisan.",{name:{before:current.rows[0].name,after:null}});
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

export async function createProject(input: ProjectInput): Promise<ProjectDetail> {
  const id = randomUUID();
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const projectNumber=Number((await client.query("SELECT nextval('project_number_seq') AS value")).rows[0].value);
    const value=input.valueScore??0,urgency=calculateUrgency(input.mandatoryDeadline??null,input.lifecycleStatus??"planning"),consequence=input.consequenceScore??0;
    const suggested=suggestPriority(value,urgency,consequence);
    await client.query(`INSERT INTO projects
      (id,project_number,project_code,name,category,lead_department_id,owner,sponsor,coordinator,delivery_lead,lifecycle_status,description,objective,outcome,baseline_finish,forecast_finish,mandatory_deadline,value_score,urgency_score,consequence_score,final_priority,priority_override_reason,management_attention,is_demo)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
      [id,projectNumber,input.projectCode??`PRJ-${String(projectNumber).padStart(4,"0")}`,input.name,input.category,input.leadDepartmentId??null,input.owner,input.sponsor??null,input.coordinator??null,input.deliveryLead??null,input.lifecycleStatus??"planning",input.description??null,input.objective??null,input.outcome??null,input.baselineFinish??null,input.forecastFinish??null,input.mandatoryDeadline??null,value,urgency,consequence,input.finalPriority??suggested,input.priorityOverrideReason??null,input.managementAttention??false,input.isDemo??false]);
    await writeAudit(client,"project",id,"created","Projekat je kreiran.",null);await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  return (await getProject(id))!;
}

export async function updateProject(id: string, input: Partial<ProjectInput>): Promise<ProjectDetail | undefined> {
  const client=await pool.connect();
  const fields: string[] = [], values: unknown[] = [];
  const map: Record<string, string> = { projectCode:"project_code",name:"name",category:"category",leadDepartmentId:"lead_department_id",owner:"owner",sponsor:"sponsor",coordinator:"coordinator",deliveryLead:"delivery_lead",lifecycleStatus:"lifecycle_status",description:"description",objective:"objective",outcome:"outcome",baselineFinish:"baseline_finish",mandatoryDeadline:"mandatory_deadline",valueScore:"value_score",consequenceScore:"consequence_score",finalPriority:"final_priority",priorityOverrideReason:"priority_override_reason",isDemo:"is_demo" };
  for (const [key, column] of Object.entries(map)) {
    if (!(key in input)) continue;
    values.push(input[key as keyof ProjectInput] ?? null);
    fields.push(`${column} = $${values.length}`);
  }
  if(!fields.length){client.release();return getProject(id);}
  try{
    await client.query("BEGIN");const locked=await client.query("SELECT * FROM projects WHERE id=$1 FOR UPDATE",[id]);if(!locked.rowCount){await client.query("ROLLBACK");return undefined;}
    const nextBaseline=input.baselineFinish===undefined?date(locked.rows[0].baseline_finish):input.baselineFinish;
    const nextMandatory=input.mandatoryDeadline===undefined?date(locked.rows[0].mandatory_deadline):input.mandatoryDeadline;
    if(nextBaseline&&nextMandatory&&nextBaseline>nextMandatory)throw new Error("Prvobitni rok ne može biti posle obaveznog krajnjeg roka.");
    if(input.lifecycleStatus==="completed"&&locked.rows[0].lifecycle_status!=="completed"){
      const latest=await client.query("SELECT progress FROM status_reports WHERE project_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1",[id]);
      if(Number(latest.rows[0]?.progress)!==100)throw new Error("Pre završavanja projekta sačuvaj status sa 100% napretka.");
    }
    const changed:Record<string,{before:unknown;after:unknown}>={};for(const [key,column] of Object.entries(map)){if(!(key in input))continue;const before=auditValue(key,locked.rows[0][column]),after=auditValue(key,input[key as keyof ProjectInput]);if(String(before??"")!==String(after??""))changed[key]={before,after};}
    values.push(id);await client.query(`UPDATE projects SET ${fields.join(", ")}, updated_at=now() WHERE id=$${values.length}`,values);
    if(Object.keys(changed).length)await writeAudit(client,"project",id,"updated","Izmenjeni su podaci projekta.",changed);
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  return getProject(id);
}

export async function deleteProject(id:string):Promise<boolean>{
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const current=await client.query("SELECT project_code,name FROM projects WHERE id=$1 FOR UPDATE",[id]);
    if(!current.rowCount){await client.query("ROLLBACK");return false;}
    await writeAudit(client,"project",id,"deleted","Projekat je obrisan.",{
      projectCode:{before:current.rows[0].project_code,after:null},
      name:{before:current.rows[0].name,after:null}
    });
    await client.query("DELETE FROM projects WHERE id=$1",[id]);
    await client.query("COMMIT");
    return true;
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

export async function addStatusReport(projectId: string, input: StatusReportInput): Promise<ProjectDetail | undefined> {
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
        lifecycle_status='blocked',updated_at=now() WHERE id=$1`,[projectId]);
    }else{
      await client.query(`UPDATE projects SET lifecycle_status=lifecycle_before_block,lifecycle_before_block=NULL,updated_at=now()
        WHERE id=$1 AND lifecycle_status='blocked' AND lifecycle_before_block IS NOT NULL`,[projectId]);
    }
    const statusMap:Record<string,string>={health:"health",trend:"trend",progress:"progress",forecastFinish:"forecast_finish",nextMilestone:"next_milestone",nextMilestoneDate:"next_milestone_date",blockerState:"blocker_state",topBlocker:"top_blocker",decisionRequired:"decision_required",decisionText:"decision_text",decisionDueDate:"decision_due_date",managementAttention:"management_attention",summary:"summary"};
    const changed:Record<string,{before:unknown;after:unknown}>={};for(const [key,value] of Object.entries(input)){const before=auditValue(key,previous?.[statusMap[key]!]),after=auditValue(key,value);if(String(before??"")!==String(after??""))changed[key]={before,after};}
    await writeAudit(client,"project",projectId,"status_updated","Dodat je novi statusni presek.",changed);await client.query("COMMIT");
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
