import assert from "node:assert/strict";
import test from "node:test";
import { seedProjects } from "../apps/server/src/seed-data.ts";
import { buildPortfolioPdfDefinition } from "../apps/web/src/pdf-report.ts";
import type { StatusReportHistoryItem } from "../packages/contracts/src/index.ts";

const project={...seedProjects[0]!,decisionRequired:false,decisionText:null,decisionDueDate:null,lastStatusSummary:"Aktuelni komentar."};
const previous:StatusReportHistoryItem={
  id:"previous",createdAt:"2026-08-01T10:00:00.000Z",versionNumber:1,
  health:"amber",trend:"stable",progress:32,forecastFinish:project.forecastFinish,
  nextMilestone:project.nextMilestone,nextMilestoneDate:project.nextMilestoneDate,
  blockerState:"none",topBlocker:null,decisionRequired:false,decisionText:null,
  decisionDueDate:null,managementAttention:false,summary:"Prethodni komentar."
};
const current={...previous,id:"current",createdAt:"2026-08-08T10:00:00.000Z",versionNumber:2,summary:"Aktuelni komentar."};

test("direktorski PDF koristi komentar i indikator umesto statusne kolone",()=>{
  const definition=buildPortfolioPdfDefinition([project],"executive","all","Bez filtera");
  const text=JSON.stringify(definition);
  assert.match(text,/KOMENTAR/);
  assert.doesNotMatch(text,/\"STATUS\"/);
  assert.match(text,/ellipse/);
});

test("detaljni PDF prikazuje prethodne komentare i skriva nepotrebnu odluku",()=>{
  const definition=buildPortfolioPdfDefinition([project],"detail","all","Bez filtera",undefined,{[project.id]:[current,previous]});
  const text=JSON.stringify(definition);
  assert.match(text,/Prethodni statusni preseci/);
  assert.match(text,/Prethodni komentar/);
  assert.doesNotMatch(text,/Potrebna odluka/);
  assert.doesNotMatch(text,/Nije potrebna odluka/);
});
