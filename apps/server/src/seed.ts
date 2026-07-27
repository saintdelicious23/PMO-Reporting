import "dotenv/config";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { seedDepartmentCode, seedProjects, seedStats } from "./seed-data.ts";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL nije podešen.");
const pool = new pg.Pool({ connectionString:process.env.DATABASE_URL });
const ids = seedProjects.map(project=>project.id);
const statusId = (projectNumber:number,position:number) => `30000000-${String(projectNumber).padStart(4,"0")}-4000-8000-${String(position).padStart(12,"0")}`;
const dateShift = (value:string,days:number) => { const date=new Date(value); date.setDate(date.getDate()+days); return date.toISOString(); };

const client = await pool.connect();
try {
  await client.query("BEGIN");
  const foreign = await client.query("SELECT count(*)::int AS count FROM projects WHERE NOT (id = ANY($1::uuid[]))",[ids]);
  if(Number(foreign.rows[0]?.count??0)>0) throw new Error("Baza već sadrži projekte koji nisu deo demo skupa. Seed je zaustavljen da postojeći podaci ne bi bili prepisani.");

  await client.query("DELETE FROM projects WHERE id = ANY($1::uuid[])",[ids]);
  const departmentIds=new Map<string,string>();
  const departmentNames=[...new Set(seedProjects.map(project=>project.leadDepartment).filter((name):name is string=>Boolean(name)))].sort((a,b)=>a.localeCompare(b,"sr"));
  for(const name of departmentNames){
    let department=await client.query("SELECT id FROM departments WHERE lower(name)=lower($1)",[name]);
    if(!department.rowCount)department=await client.query(`INSERT INTO departments(id,code,name,position)
      VALUES($1,$2,$3,(SELECT COALESCE(MAX(position),0)+1 FROM departments)) RETURNING id`,[randomUUID(),seedDepartmentCode(name),name]);
    departmentIds.set(name,String(department.rows[0].id));
  }
  for(const project of seedProjects) {
    await client.query(`INSERT INTO projects
      (id,project_number,project_code,name,category,lead_department_id,lifecycle_status,description,objective,outcome,planned_start,actual_start,baseline_finish,forecast_finish,mandatory_deadline,value_score,urgency_score,consequence_score,final_priority,management_attention,is_demo,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,[
      project.id,project.projectNumber,project.projectCode,project.name,project.category,project.leadDepartment?departmentIds.get(project.leadDepartment)??null:null,project.lifecycleStatus,
      project.description,project.objective,project.outcome,project.plannedStart,project.actualStart,project.baselineFinish,project.forecastFinish,project.mandatoryDeadline,project.valueScore,project.urgencyScore,project.consequenceScore,
      project.finalPriority,project.managementAttention,true,dateShift(project.lastUpdatedAt,-90),project.lastUpdatedAt
    ]);
    for(const assignment of project.roles)await client.query(`INSERT INTO project_role_assignments
      (id,project_id,role,person_name,is_primary,position) VALUES($1,$2,$3,$4,$5,$6)`,
      [assignment.id,project.id,assignment.role,assignment.name,assignment.isPrimary,assignment.position]);

    const currentDate=project.lastUpdatedAt;
    const previousDate=dateShift(currentDate,-14);
    const previousHealth = project.trend==="improving" ? (project.health==="green"?"amber":project.health==="amber"?"red":"critical")
      : project.trend==="declining" ? (project.health==="critical"?"red":project.health==="red"?"amber":"green") : project.health;
    const reports = [
      { id:statusId(project.projectNumber,1),createdAt:previousDate,health:previousHealth,progress:project.progress===null?null:Math.max(0,project.progress-12),summary:`Prethodni presek za ${project.name}: potvrđen je radni obim, ali su ključne zavisnosti i rokovi još bili u proveri. Fokus perioda bio je na zatvaranju otvorenih pretpostavki i pripremi naredne kontrolne tačke.` },
      { id:statusId(project.projectNumber,2),createdAt:currentDate,health:project.health,progress:project.progress,summary:`Aktuelni presek za ${project.name}: ${project.nextMilestone?`naredna ključna tačka je „${project.nextMilestone}”.`:`naredna ključna tačka još nije definisana.`} ${project.topBlocker?`Glavno ograničenje je: ${project.topBlocker}`:"Nema potvrđenog kritičnog blokera."}` }
    ];
    for(const [reportIndex,report] of reports.entries()) await client.query(`INSERT INTO status_reports
      (id,project_id,health,trend,progress,forecast_finish,next_milestone,next_milestone_date,blocker_state,top_blocker,decision_required,decision_text,decision_due_date,management_attention,summary,version_number,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,[
      report.id,project.id,report.health,project.trend,report.progress,project.forecastFinish,
      project.nextMilestone,project.nextMilestoneDate,project.blockerState,project.topBlocker,project.decisionRequired,project.decisionText,project.decisionDueDate,
      project.managementAttention,report.summary,reportIndex+1,report.createdAt
    ]);
  }
  await client.query("SELECT setval('project_number_seq',GREATEST((SELECT COALESCE(max(project_number),1) FROM projects),1),true)");
  await client.query("COMMIT");
  process.stdout.write(`Probni podaci su učitani: ${seedStats.projects} projekata (${seedStats.strategic} strateških projekata, ${seedStats.mandatory} regulatornih obaveza, ${seedStats.operational} operativnih unapređenja).\n`);
} catch(error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
