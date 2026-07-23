import assert from "node:assert/strict";
import test from "node:test";
import { portfolioSettingsSchema, projectInputSchema, statusInputSchema } from "../apps/server/src/validation.ts";

const baseSettings = {
  title: "Portfolio",
  tagline: "",
  defaultView: "detailed",
  defaultGroup: "all",
  defaultSortKey: "finalPriority",
  defaultSortDirection: "desc",
  pdfView: "current",
  pdfGroup: "current",
  pdfIncludeInactive: false,
  headerGraphic: null,
  viewColumns: { detailed:["name"], engaged:["name"], executive:["name"], goldfish:["name"] },
  customViews: [],
  activeUserId: "00000000-0000-4000-8000-000000000001"
};

test("projekat prihvata UUID sektora nezavisno od UUID verzije", () => {
  const result = projectInputSchema.safeParse({
    name: "Test projekat",
    category: "strategic",
    owner: "Vlasnik",
    leadDepartmentId: "8ca8be00-4bb4-2f9b-c675-0a7a3e5d6b12"
  });
  assert.equal(result.success, true);
});

test("podešavanja odbijaju obrisan osnovni ili referencirani pregled", () => {
  assert.equal(portfolioSettingsSchema.safeParse(baseSettings).success, true);
  assert.equal(portfolioSettingsSchema.safeParse({
    ...baseSettings,
    defaultView: "missing"
  }).success, false);
  assert.equal(portfolioSettingsSchema.safeParse({
    ...baseSettings,
    viewColumns: { detailed:["name"], engaged:["name"], executive:["name"] }
  }).success, false);
});

test("korisnički pregled mora imati jedinstven ID i kolone", () => {
  const result = portfolioSettingsSchema.safeParse({
    ...baseSettings,
    customViews: [
      { id:"risk",label:"Rizici",description:"" },
      { id:"risk",label:"Rizici 2",description:"" }
    ]
  });
  assert.equal(result.success, false);
});

test("statusni komentar, tekst odluke i identifikacija blokera su opcioni", () => {
  const status = {
    health:"amber",
    trend:"stable",
    progress:50,
    blockerState:"none",
    topBlocker:null,
    decisionRequired:true,
    decisionText:null,
    decisionDueDate:null,
    managementAttention:true,
    summary:null
  };
  assert.equal(statusInputSchema.safeParse(status).success, true);
  assert.equal(statusInputSchema.safeParse({...status,blockerState:"blocked"}).success, true);
  assert.equal(statusInputSchema.safeParse({...status,blockerState:"blocked",topBlocker:"Čeka se dobavljač"}).success, true);
});
