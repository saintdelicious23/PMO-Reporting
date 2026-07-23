import "dotenv/config";
import assert from "node:assert/strict";
import test from "node:test";

test("osnovne izmene ne stvaraju status i status ne menja rokove", {skip:!process.env.DATABASE_URL}, async () => {
  const repository = await import("../apps/server/src/repository.ts");
  const { closeDatabase } = await import("../apps/server/src/database.ts");
  let projectId:string|null=null;
  try{
    const created=await repository.createProject({
      name:"Integracioni test projekta",
      category:"operational_improvement",
      owner:"Test",
      lifecycleStatus:"active",
      mandatoryDeadline:"2027-12-31",
      valueScore:2,
      consequenceScore:2,
      finalPriority:"medium"
    });
    projectId=created.id;
    assert.equal((await repository.listStatusReports(created.id)).length,0);

    const afterPriority=await repository.updateProject(created.id,{finalPriority:"low"});
    assert.equal(afterPriority?.mandatoryDeadline,"2027-12-31");
    assert.equal((await repository.listStatusReports(created.id)).length,0);

    const blocked=await repository.addStatusReport(created.id,{
      health:"amber",trend:"stable",progress:40,forecastFinish:"2027-11-30",
      blockerState:"blocked",topBlocker:null,decisionRequired:false,
      managementAttention:false,summary:null
    });
    assert.equal(blocked?.lifecycleStatus,"blocked");
    assert.equal(blocked?.mandatoryDeadline,"2027-12-31");

    const unblocked=await repository.addStatusReport(created.id,{
      health:"green",trend:"improving",progress:45,forecastFinish:"2027-10-31",
      blockerState:"none",topBlocker:null,decisionRequired:false,
      managementAttention:false,summary:null
    });
    assert.equal(unblocked?.lifecycleStatus,"active");
    assert.equal(unblocked?.mandatoryDeadline,"2027-12-31");

    const reports=await repository.listStatusReports(created.id);
    assert.deepEqual(reports.map(report=>report.versionNumber),[2,1]);
    const events=await repository.listAuditEvents(created.id);
    assert.equal(events.filter(event=>event.action==="status_updated").length,2);
  }finally{
    if(projectId)await repository.deleteProject(projectId);
    await closeDatabase();
  }
});
