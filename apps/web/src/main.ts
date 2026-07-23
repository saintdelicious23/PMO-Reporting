import "./styles.css";
import { api } from "./api.ts";
import type { AppUser, AuditEvent, Department, PortfolioSettings, PortfolioSortKey, Priority, ProjectCategory, ProjectDetail, ProjectSummary, Score, StatusReportHistoryItem, UrgencyScore } from "../../../packages/contracts/src/index.ts";
import { downloadPortfolioPdf } from "./pdf-report.ts";
import { columnLabels, defaultViewColumns, viewOptions, type ColumnKey, type GroupMode, type ViewMode } from "./view-config.ts";

type SortKey = PortfolioSortKey;
type Filters = { search:string; health:string; priority:string; department:string; attention:boolean };
type LayoutMode = "auto"|"table"|"cards";

const labels = {
  category: { strategic:"Strateški projekat", mandatory:"Regulatorne obaveze", operational_improvement:"Operativno unapređenje" },
  health: { green:"Zeleno", amber:"Žuto", red:"Crveno", critical:"Kritično" },
  lifecycle: { planning:"Planiranje",active:"Aktivan",on_hold:"Privremeno obustavljen",blocked:"Blokiran",completed:"Završen",cancelled:"Otkazan" },
  priority: { low:"Nizak",medium:"Srednji",high:"Visok",very_high:"Veoma visok",critical:"Kritičan" },
  trend: { improving:"Poboljšava se",stable:"Stabilno",declining:"Pogoršava se" },
} as const;

const categoryOrder: ProjectCategory[] = ["strategic","mandatory","operational_improvement"];
const priorityRank: Record<Priority,number> = { low:0,medium:1,high:2,very_high:3,critical:4 };
const healthRank = { green:0,amber:1,red:2,critical:3 } as const;
const trendRank = { declining:0,stable:1,improving:2 } as const;
const sortLabels:Record<SortKey,string>={id:"Puni ID",projectNumber:"Redni broj",name:"Naziv",category:"Kategorija",leadDepartment:"Sektor",owner:"Vlasnik",sponsor:"Sponzor",coordinator:"Rukovodilac / koordinator",deliveryLead:"Glavni izvršilac",lifecycleStatus:"Životni ciklus",description:"Opis",objective:"Cilj",outcome:"Krajnji ishod",health:"Stanje",trend:"Kretanje",progress:"Napredak",baselineFinish:"Prvobitni rok",forecastFinish:"Procena završetka",mandatoryDeadline:"Obavezni rok",valueScore:"Vrednost",urgencyScore:"Hitnost",consequenceScore:"Posledica neizvršenja",finalPriority:"Prioritet",suggestedPriority:"Predloženi prioritet",nextMilestone:"Sledeća ključna tačka",nextMilestoneDate:"Datum ključne tačke",blockerState:"Stanje blokade",topBlocker:"Prepreka",decisionRequired:"Potrebna odluka",decisionText:"Tekst odluke",decisionDueDate:"Rok odluke",managementAttention:"Reakcija menadžmenta",isDemo:"Probni podatak",lastUpdatedAt:"Ažuriranje"};

let projects: ProjectSummary[] = [];
let departments:Department[]=[];
let users:AppUser[]=[];
let selected: ProjectDetail | null = null;
let portfolioSettings:PortfolioSettings={
  title:"Portfolio projekata",
  tagline:"Upravljačko izveštavanje",
  defaultView:"detailed",
  defaultGroup:"category",
  defaultSortKey:"name",
  defaultSortDirection:"asc",
  pdfView:"current",
  pdfGroup:"current",
  pdfIncludeInactive:true,
  headerGraphic:null,
  viewColumns:structuredClone(defaultViewColumns),
  customViews:[],
  activeUserId:null,
  updatedAt:new Date(0).toISOString()
};
let sortKey: SortKey = "name";
let sortDirection: "asc"|"desc" = "asc";
let filters: Filters = { search:"",health:"",priority:"",department:"",attention:false };
const savedView=localStorage.getItem("reportingView");
let viewMode:ViewMode = savedView&&savedView in viewOptions?savedView as ViewMode:"detailed";
const savedGroup=localStorage.getItem("reportingGroup");
let groupMode:GroupMode = savedGroup==="all"?"all":"category";
const savedLayout=localStorage.getItem("reportingLayout");
let layoutMode:LayoutMode=savedLayout==="table"||savedLayout==="cards"?savedLayout:"auto";
const mobileLayoutQuery=window.matchMedia("(max-width: 900px)");
let showDemo=localStorage.getItem("reportingShowDemo")!=="false";
let filterPanelOpen=false;
let editedView:ViewMode="detailed";
let workingViewColumns=structuredClone(defaultViewColumns);
let workingCustomViews:PortfolioSettings["customViews"]=[];
let pendingHeaderGraphic:string|null=null;
const statusHistoryCache=new Map<string,StatusReportHistoryItem[]>();

const app = document.querySelector<HTMLDivElement>("#app")!;

const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[char]!));
const formatDate = (value: string|null) => value ? new Intl.DateTimeFormat("sr-Latn-RS",{day:"2-digit",month:"short",year:"numeric"}).format(new Date(`${value.slice(0,10)}T12:00:00`)) : "Nije određeno";
const daysFromNow = (value: string|null) => value ? Math.ceil((new Date(`${value}T23:59:59`).getTime()-Date.now())/86400000) : null;
const stale = (value: string|null) => !value || (Date.now()-new Date(value).getTime())/86400000 > 7;
const statusUpdateLabel=(value:string|null)=>value?relativeUpdate(value):"status nije unet";
const nullable = (form: FormData,key:string) => String(form.get(key) ?? "").trim() || null;
const numberOrNull = (form:FormData,key:string) => { const value = String(form.get(key) ?? ""); return value === "" ? null : Number(value); };
const needsAttention = (project:ProjectSummary) => project.managementAttention||project.decisionRequired||project.health==="critical"||project.lifecycleStatus==="blocked";
const departmentOptions = (selectedId:string|null=null) => `<option value="">Nije definisano</option>${departments.map(department=>`<option value="${department.id}" ${selectedId===department.id?"selected":""}>${esc(department.code)} · ${esc(department.name)}</option>`).join("")}`;

function shell() {
  app.innerHTML = `
    <header class="app-header">
      <div class="brand" id="header-brand"></div>
      <div class="header-actions"><button class="header-icon-button demo-header-toggle ${showDemo?"active":""}" id="demo-toggle" aria-label="Uključi ili isključi probne podatke" aria-pressed="${showDemo}" title="Probni podaci"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6M10 3v5l-5 9a2.5 2.5 0 0 0 2.2 3.7h9.6A2.5 2.5 0 0 0 19 17l-5-9V3M7.5 15h9"/></svg></button><span class="header-action-separator" aria-hidden="true"></span><button class="header-icon-button" id="open-settings" aria-label="Otvori podešavanja" title="Podešavanja"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.55V21h-4v-.08A1.7 1.7 0 0 0 8.97 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.52-1.03H3v-4h.08A1.7 1.7 0 0 0 4.6 8.94a1.7 1.7 0 0 0-.34-1.88L4.2 7l2.83-2.83.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 10 3.05V3h4v.05a1.7 1.7 0 0 0 1.03 1.52 1.7 1.7 0 0 0 1.88-.34l.06-.06L19.8 7l-.06.06a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z"/></svg></button><button class="header-icon-button print-button" id="print-report" aria-label="Preuzmi PDF" title="Preuzmi PDF"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14"/></svg></button><button class="header-icon-button add" id="new-project" aria-label="Dodaj projekat" title="Dodaj projekat"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button></div>
    </header>
    <main class="page-shell">
      <section class="kpi-grid" id="kpis"></section>
      <section class="overview-row"><section class="attention-strip" id="attention-strip"></section><section class="view-panel"><div><span class="control-label">Pregled</span><div class="segmented view-segments">${Object.entries(viewOptions).map(([value,option])=>`<button type="button" data-view-mode="${value}" class="${viewMode===value?"active":""}">${option.label}</button>`).join("")}</div></div><div><span class="control-label">Organizacija</span><div class="segmented"><button type="button" data-group-mode="category" class="${groupMode==="category"?"active":""}">Kategorije</button><button type="button" data-group-mode="all" class="${groupMode==="all"?"active":""}">Svi zajedno</button></div></div><div><span class="control-label">Raspored</span><div class="segmented"><button type="button" data-layout-mode="auto" class="${layoutMode==="auto"?"active":""}">Automatski</button><button type="button" data-layout-mode="table" class="${layoutMode==="table"?"active":""}">Tabela</button><button type="button" data-layout-mode="cards" class="${layoutMode==="cards"?"active":""}">Kartice</button></div></div></section></section>
      <section class="toolbar" aria-label="Pretraga i organizacija projekata">
        <label class="search-field"><span>⌕</span><input id="search" type="search" placeholder="Pretraži projekte, vlasnika, sektor…" /></label>
        <button class="toolbar-button" id="open-filters" aria-expanded="false">Filteri <span id="filter-count">0</span></button>
      </section>
      <section class="filter-panel" id="filter-panel" hidden><div><label>Stanje<select id="health-filter"><option value="">Sva stanja</option>${Object.entries(labels.health).map(([v,l])=>`<option value="${v}">${l}</option>`).join("")}</select></label><label>Prioritet<select id="priority-filter"><option value="">Svi prioriteti</option>${Object.entries(labels.priority).map(([v,l])=>`<option value="${v}">${l}</option>`).join("")}</select></label><label>Sektor<select id="department-filter"><option value="">Svi sektori</option></select></label><label>Sortiranje<div class="sort-controls"><select id="sort-key" aria-label="Sortiraj po">${Object.entries(sortLabels).map(([value,label])=>`<option value="${value}">${label}</option>`).join("")}</select><button class="icon-button" id="sort-direction" title="Promeni smer" aria-label="Promeni smer sortiranja">A→Z</button></div></label></div><button class="text-button" id="clear-filters" type="button">Poništi filtere</button></section>
      <section id="portfolio"></section>
    </main>
    <div class="drawer-scrim" id="drawer-scrim"></div><aside class="drawer" id="drawer" aria-label="Detalj projekta"></aside>
    <dialog id="create-dialog" class="modal"><form method="dialog" id="create-form"><div class="modal-head"><div><p class="eyebrow">Novi zapis</p><h2>Kreiraj projekat</h2></div><button type="button" class="close-button" data-close-dialog="create-dialog" aria-label="Zatvori">×</button></div><div class="form-grid"><label class="field span-2"><span>Naziv projekta *</span><input name="name" required minlength="2" autofocus /></label><label class="field"><span>Kategorija *</span><select name="category" required>${categoryOrder.map(c=>`<option value="${c}">${labels.category[c]}</option>`).join("")}</select></label><label class="field"><span>Vlasnik *</span><input name="owner" required /></label><label class="field span-2"><span>Vodeći sektor</span><select name="leadDepartment" id="create-department">${departmentOptions()}</select></label><label class="check-field span-3"><input type="checkbox" name="isDemo" /><span><b>Probni podatak</b><small>Projekat se može potpuno izuzeti iz prikaza i statistike.</small></span></label></div><div class="modal-actions"><button type="button" class="button ghost" data-close-dialog="create-dialog">Otkaži</button><button type="submit" value="default" class="button primary">Kreiraj projekat</button></div></form></dialog>
    <dialog id="settings-dialog" class="modal settings-modal"><form method="dialog" id="settings-form"><div class="modal-head"><div><p class="eyebrow">Administracija portfolija</p><h2>Podešavanja</h2></div><button type="button" class="close-button" data-close-settings aria-label="Zatvori">×</button></div>
      <nav class="settings-tabs" aria-label="Grupe podešavanja"><button type="button" class="active" data-settings-tab="general">Opšte</button><button type="button" data-settings-tab="views">Editor pregleda</button><button type="button" data-settings-tab="departments">Sektori</button><button type="button" data-settings-tab="reporting">Izveštavanje</button></nav>
      <section class="settings-pane" data-settings-pane="general"><div class="settings-intro"><strong>Opšte postavke</strong><p>Naslov, podnaslov i grafika u plavom zaglavlju, plus početni prikaz za nove korisnike.</p></div><div class="form-grid"><label class="field span-2"><span>Naslov *</span><input name="title" required minlength="2" maxlength="160" /></label><label class="field"><span>Podnaslov</span><input name="tagline" maxlength="160" /></label><div class="graphic-setting span-3"><div id="graphic-preview" class="graphic-preview"></div><div><label class="button ghost upload-button">Izaberi grafiku<input type="file" id="header-graphic-input" accept="image/png,image/jpeg,image/webp" /></label><button type="button" class="button ghost" id="remove-header-graphic">Ukloni</button><small>PNG, JPG ili WebP, do 500 KB. Prikazuje se levo od naslova.</small></div></div><label class="field"><span>Početni pregled</span><select name="defaultView">${Object.entries(viewOptions).map(([value,option])=>`<option value="${value}">${option.label}</option>`).join("")}</select></label><label class="field"><span>Početno grupisanje</span><select name="defaultGroup"><option value="category">Po kategorijama</option><option value="all">Svi projekti zajedno</option></select></label><label class="field"><span>Početno sortiranje</span><select name="defaultSortKey">${Object.entries(sortLabels).map(([value,label])=>`<option value="${value}">${label}</option>`).join("")}</select></label><label class="field"><span>Smer sortiranja</span><select name="defaultSortDirection"><option value="asc">Rastuće</option><option value="desc">Opadajuće</option></select></label></div></section>
      <section class="settings-pane" data-settings-pane="views" hidden><div class="settings-intro"><strong>Editor pregleda</strong><p>Odaberi pregled, uključi kolone i prevuci ih u željeni redosled. Osnovni pregledi se ne mogu obrisati.</p></div><div class="view-editor-head"><label class="field"><span>Pregled</span><select id="edited-view">${Object.entries(viewOptions).map(([value,option])=>`<option value="${value}">${option.label}</option>`).join("")}</select></label><button type="button" class="button primary small" data-add-view>+ Dodaj pregled</button><button type="button" class="button danger small" data-delete-view>Obriši pregled</button><p id="edited-view-description"></p></div><div class="column-editor" id="column-editor"></div></section>
      <section class="settings-pane" data-settings-pane="departments" hidden><div class="settings-intro"><strong>Dostupni sektori</strong><p>Svaki sektor ima jedinstvenu šifru. Brisanjem sektora povezani projekti ostaju bez vodećeg sektora.</p></div><div class="department-add"><input id="new-department-code" maxlength="16" placeholder="Šifra, npr. FIN" /><input id="new-department-name" maxlength="120" placeholder="Naziv novog sektora" /><button class="button primary" id="add-department" type="button">+ Dodaj sektor</button></div><div class="department-settings-list" id="department-settings-list"></div></section>
      <section class="settings-pane" data-settings-pane="reporting" hidden><div class="settings-intro"><strong>Izveštavanje</strong><p>Podrazumevani PDF može pratiti trenutni ekran ili koristiti unapred definisan nivo detalja. Status stariji od sedam dana automatski se označava kao zastareo.</p></div><div class="form-grid"><label class="field"><span>PDF pregled</span><select name="pdfView"><option value="current">Kao trenutni prikaz</option>${Object.entries(viewOptions).map(([value,option])=>`<option value="${value}">${option.label}</option>`).join("")}</select></label><label class="field"><span>PDF grupisanje</span><select name="pdfGroup"><option value="current">Kao trenutni prikaz</option><option value="category">Po kategorijama</option><option value="all">Svi projekti zajedno</option></select></label><label class="check-field span-3"><input type="checkbox" name="pdfIncludeInactive" /><span><b>Uključi završene i otkazane projekte u PDF</b><small>Ako nije označeno, PDF sadrži samo aktivne projekte.</small></span></label></div></section>
      <div class="modal-actions"><button type="button" class="button ghost" data-close-settings>Otkaži</button><button type="submit" value="default" class="button primary">Sačuvaj podešavanja</button></div></form></dialog>
    <dialog id="status-history-dialog" class="modal status-history-modal"><div class="modal-head"><div><p class="eyebrow">Istorija izmena</p><h2 id="status-history-title">Status projekta</h2></div><button type="button" class="close-button" data-close-dialog="status-history-dialog" aria-label="Zatvori">×</button></div><div id="status-history-content"></div><div class="modal-actions"><button type="button" class="button ghost" data-close-dialog="status-history-dialog">Zatvori</button></div></dialog>
    <div class="hover-tooltip" id="hover-tooltip" role="tooltip"></div><div class="toast" id="toast" role="status"></div>`;
}

function render() {
  document.body.dataset.view=viewMode;
  document.body.dataset.group=groupMode;
  renderHeaderBrand(); renderKpis(); renderDepartments(); renderAttention(); renderViewControls(); renderFilterState(); renderPortfolio();
}

function renderHeaderBrand() {
  const brand=document.querySelector<HTMLElement>("#header-brand");
  if(!brand)return;
  brand.innerHTML=`${portfolioSettings.headerGraphic?`<img src="${esc(portfolioSettings.headerGraphic)}" alt="" />`:""}<div><strong>${esc(portfolioSettings.title)}</strong><small>${esc(portfolioSettings.tagline)}</small></div>`;
}

const portfolioProjects=()=>showDemo?projects:projects.filter(project=>!project.isDemo);
const allViewOptions=()=>({...viewOptions,...Object.fromEntries(portfolioSettings.customViews.map(view=>[view.id,{label:view.label,description:view.description,columns:portfolioSettings.viewColumns[view.id]??["name"]}]))});
const activeColumns=():ColumnKey[]=>portfolioSettings.viewColumns[viewMode]??allViewOptions()[viewMode]?.columns??["name"];

function renderKpis() {
  const active = portfolioProjects().filter(p=>!["completed","cancelled"].includes(p.lifecycleStatus));
  const kpis = [
    ["Aktivni projekti",active.length,"neutral"],
    ["Po planu",active.filter(p=>p.health==="green").length,"green"],
    ["U riziku",active.filter(p=>p.health==="amber").length,"amber"],
    ["Crveno / kritično",active.filter(p=>p.health==="red"||p.health==="critical").length,"red"],
    ["Za reakciju",active.filter(needsAttention).length,"rose"],
    ["Status > 7 dana",active.filter(project=>stale(project.lastStatusAt)).length,"slate"]
  ];
  document.querySelector("#kpis")!.innerHTML = kpis.map(([label,value,tone])=>`<article class="kpi-card ${tone}"><span>${label}</span><strong>${value}</strong></article>`).join("");
}

function renderDepartments() {
  const select = document.querySelector<HTMLSelectElement>("#department-filter")!;
  const names = [...new Set([...departments.map(department=>department.name),...portfolioProjects().map(project=>project.leadDepartment).filter((name):name is string=>Boolean(name))])].sort((a,b)=>a.localeCompare(b,"sr"));
  const current = select.value || filters.department;
  select.innerHTML = `<option value="">Svi sektori</option>${names.map(name=>`<option value="${esc(name)}">${esc(name)}</option>`).join("")}`;
  if(current&&names.includes(current))select.value=current;else if(current)filters.department="";
  const createSelect=document.querySelector<HTMLSelectElement>("#create-department");
  if(createSelect){const createValue=createSelect.value;createSelect.innerHTML=departmentOptions(createValue);}
}

function renderAttention() {
  const source=portfolioProjects();
  const urgent = source.filter(needsAttention);
  const overdueDecisions = urgent.filter(p=>p.decisionRequired && (daysFromNow(p.decisionDueDate)??1)<0).length;
  const critical=source.filter(p=>p.health==="critical").length;
  const blocked=source.filter(p=>p.lifecycleStatus==="blocked").length;
  document.querySelector("#attention-strip")!.innerHTML = `<div class="attention-heading"><span class="attention-icon">!</span><div><strong>Reakcija menadžmenta</strong><small>${urgent.length} projekata zahteva pregled</small></div><button class="text-button ${filters.attention?"active":""}" data-show-attention>${filters.attention?"Prikaži sve":"Prikaži"} →</button></div><div class="attention-facts"><span><b>${critical}</b><small>kritično</small></span><span><b>${blocked}</b><small>blokirano</small></span><span><b>${overdueDecisions}</b><small>odluke preko roka</small></span></div>`;
}

function renderViewControls(){
  const options=allViewOptions(),segments=document.querySelector<HTMLElement>(".view-segments");if(segments)segments.innerHTML=Object.entries(options).map(([value,option])=>`<button type="button" data-view-mode="${value}" class="${viewMode===value?"active":""}">${esc(option.label)}</button>`).join("");
  document.querySelectorAll<HTMLElement>("[data-view-mode]").forEach(button=>button.classList.toggle("active",button.dataset.viewMode===viewMode));
  document.querySelectorAll<HTMLElement>("[data-group-mode]").forEach(button=>button.classList.toggle("active",button.dataset.groupMode===groupMode));
  document.querySelectorAll<HTMLElement>("[data-layout-mode]").forEach(button=>button.classList.toggle("active",button.dataset.layoutMode===layoutMode));
}

const effectiveLayout=():"table"|"cards"=>layoutMode==="auto"?(mobileLayoutQuery.matches?"cards":"table"):layoutMode;

function activeFilterCount(){return [filters.health,filters.priority,filters.department].filter(Boolean).length;}
function renderFilterState(){
  const panel=document.querySelector<HTMLElement>("#filter-panel"),button=document.querySelector<HTMLButtonElement>("#open-filters"),count=document.querySelector<HTMLElement>("#filter-count"),demo=document.querySelector<HTMLButtonElement>("#demo-toggle");
  if(panel)panel.hidden=!filterPanelOpen;if(button)button.setAttribute("aria-expanded",String(filterPanelOpen));if(count)count.textContent=String(activeFilterCount());
  if(demo){demo.classList.toggle("active",showDemo);demo.setAttribute("aria-pressed",String(showDemo));demo.title=showDemo?"Probni projekti su uključeni":"Probni projekti su potpuno izuzeti";}
}

function filteredProjects() {
  const query = filters.search.toLocaleLowerCase("sr");
  const filtered = portfolioProjects().filter(p => {
    const haystack = `${p.id} ${p.projectCode} ${p.projectNumber} ${p.name} ${p.owner} ${p.sponsor??""} ${p.coordinator??""} ${p.deliveryLead??""} ${p.leadDepartment??""} ${p.description??""} ${p.objective??""} ${p.outcome??""}`.toLocaleLowerCase("sr");
    return (!query||haystack.includes(query)) && (!filters.health||p.health===filters.health) && (!filters.priority||p.finalPriority===filters.priority) && (!filters.department||p.leadDepartment===filters.department) && (!filters.attention||needsAttention(p));
  });
  const factor = sortDirection==="asc"?1:-1;
  return filtered.sort((a,b)=>{
    if(sortKey==="id") return a.projectCode.localeCompare(b.projectCode,"sr",{numeric:true})*factor;
    if(sortKey==="finalPriority"||sortKey==="suggestedPriority") return (priorityRank[a[sortKey]]-priorityRank[b[sortKey]])*factor;
    if(sortKey==="health") return (healthRank[a.health]-healthRank[b.health])*factor;
    if(sortKey==="trend") return (trendRank[a.trend]-trendRank[b.trend])*factor;
    if(["projectNumber","progress","valueScore","urgencyScore","consequenceScore"].includes(sortKey)) return ((Number(a[sortKey]??-1))-(Number(b[sortKey]??-1)))*factor;
    if(sortKey==="blockerState") return ((a.blockerState==="blocked"?1:0)-(b.blockerState==="blocked"?1:0))*factor;
    if(sortKey==="lastUpdatedAt")return String(a.lastStatusAt??"").localeCompare(String(b.lastStatusAt??""),"sr")*factor;
    const av=String(a[sortKey]??""),bv=String(b[sortKey]??""); return av.localeCompare(bv,"sr",{numeric:true})*factor;
  });
}

function sortHeader(key:SortKey,label:string,column:string=key) {
  const active=sortKey===key;
  const indicator=active?(sortDirection==="asc"?"↑":"↓"):"↕";
  const ariaSort=active?(sortDirection==="asc"?"ascending":"descending"):"none";
  return `<th data-column="${column}" aria-sort="${ariaSort}"><button class="sort-header ${active?"active":""}" data-sort-column="${key}"><span class="sort-label">${label}</span><span class="sort-indicator" aria-hidden="true">${indicator}</span></button></th>`;
}

const columnSortKey:Record<ColumnKey,SortKey>={name:"name",id:"id",projectNumber:"projectNumber",category:"category",lifecycleStatus:"lifecycleStatus",health:"health",trend:"trend",owner:"owner",sponsor:"sponsor",coordinator:"coordinator",deliveryLead:"deliveryLead",department:"leadDepartment",description:"description",objective:"objective",outcome:"outcome",valueScore:"valueScore",urgencyScore:"urgencyScore",consequenceScore:"consequenceScore",finalPriority:"finalPriority",suggestedPriority:"suggestedPriority",progress:"progress",baselineFinish:"baselineFinish",forecastFinish:"forecastFinish",mandatoryDeadline:"mandatoryDeadline",nextMilestone:"nextMilestone",nextMilestoneDate:"nextMilestoneDate",blockerState:"blockerState",blocker:"topBlocker",decisionRequired:"decisionRequired",decisionText:"decisionText",decisionDueDate:"decisionDueDate",managementAttention:"managementAttention",isDemo:"isDemo",lastUpdatedAt:"lastUpdatedAt"};

const yesNo=(value:boolean)=>value?"Da":"Ne";
const scoreText=(value:number,urgency=false)=>urgency&&value===5?"Rok probijen":["Nema","Nisko","Srednje","Visoko","Veoma visoko"][value]??String(value);
const longTextCell=(column:ColumnKey,value:string|null,fallback="Nije definisano")=>`<td data-column="${column}"><span class="long-text-cell" title="${esc(value??fallback)}">${esc(value??fallback)}</span></td>`;

function projectCell(column:ColumnKey,p:ProjectSummary) {
  if(column==="name")return `<td data-column="name"><div class="project-name"><button type="button" class="project-number status-history-trigger" data-status-history="${p.id}" aria-label="Istorija statusa" data-tooltip="Istorija statusnih preseka">${String(p.projectNumber).padStart(3,"0")}</button><div><strong>${esc(p.name)}</strong><small>${labels.lifecycle[p.lifecycleStatus]} · ${esc(statusUpdateLabel(p.lastStatusAt))}${p.isDemo?" · probni podatak":""}</small></div></div></td>`;
  if(column==="id")return `<td data-column="id"><code class="full-id">${esc(p.projectCode)}</code></td>`;
  if(column==="projectNumber")return `<td data-column="projectNumber"><strong class="cell-primary">${String(p.projectNumber).padStart(3,"0")}</strong></td>`;
  if(column==="category")return `<td data-column="category"><span class="category-label table-category ${p.category}">${labels.category[p.category]}</span></td>`;
  if(column==="lifecycleStatus")return `<td data-column="lifecycleStatus"><span class="lifecycle-pill ${p.lifecycleStatus}">${labels.lifecycle[p.lifecycleStatus]}</span></td>`;
  if(column==="health")return `<td data-column="health"><span class="health-badge ${p.health}"><i></i>${labels.health[p.health]}</span></td>`;
  if(column==="trend")return `<td data-column="trend"><span class="trend ${p.trend}">${p.trend==="improving"?"↗":p.trend==="declining"?"↘":"→"} ${labels.trend[p.trend]}</span></td>`;
  if(column==="owner")return `<td data-column="owner"><strong class="cell-primary">${esc(p.owner)}</strong></td>`;
  if(column==="sponsor")return `<td data-column="sponsor"><strong class="cell-primary">${esc(p.sponsor??"Nije definisano")}</strong></td>`;
  if(column==="coordinator")return `<td data-column="coordinator"><strong class="cell-primary">${esc(p.coordinator??"Nije definisano")}</strong></td>`;
  if(column==="deliveryLead")return `<td data-column="deliveryLead"><strong class="cell-primary">${esc(p.deliveryLead??"Nije definisano")}</strong></td>`;
  if(column==="department")return `<td data-column="department"><strong class="cell-primary">${esc(p.leadDepartment??"Bez sektora")}</strong></td>`;
  if(column==="description")return longTextCell(column,p.description);
  if(column==="objective")return longTextCell(column,p.objective);
  if(column==="outcome")return longTextCell(column,p.outcome);
  if(column==="valueScore")return `<td data-column="valueScore"><strong class="cell-primary">${scoreText(p.valueScore)}</strong></td>`;
  if(column==="urgencyScore")return `<td data-column="urgencyScore"><strong class="cell-primary">${scoreText(p.urgencyScore,true)}</strong></td>`;
  if(column==="consequenceScore")return `<td data-column="consequenceScore"><strong class="cell-primary">${scoreText(p.consequenceScore)}</strong></td>`;
  if(column==="finalPriority")return `<td data-column="finalPriority"><span class="priority-badge ${p.finalPriority}">${labels.priority[p.finalPriority]}</span></td>`;
  if(column==="suggestedPriority")return `<td data-column="suggestedPriority"><span class="priority-badge ${p.suggestedPriority}">${labels.priority[p.suggestedPriority]}</span></td>`;
  if(column==="progress")return `<td data-column="progress"><div class="progress-cell"><div><span style="width:${p.progress??0}%"></span></div><b>${p.progress===null?"—":`${Math.round(p.progress)}%`}</b></div></td>`;
  if(column==="baselineFinish")return `<td data-column="baselineFinish"><strong class="cell-primary">${formatDate(p.baselineFinish)}</strong></td>`;
  if(column==="forecastFinish")return `<td data-column="forecastFinish"><strong class="cell-primary">${formatDate(p.forecastFinish)}</strong>${p.baselineFinish&&p.forecastFinish!==p.baselineFinish?`<small class="cell-secondary variance">Prvobitni rok ${formatDate(p.baselineFinish)}</small>`:""}</td>`;
  if(column==="mandatoryDeadline")return `<td data-column="mandatoryDeadline"><strong class="cell-primary">${formatDate(p.mandatoryDeadline)}</strong></td>`;
  if(column==="nextMilestone")return longTextCell(column,p.nextMilestone);
  if(column==="nextMilestoneDate")return `<td data-column="nextMilestoneDate"><strong class="cell-primary">${esc(p.nextMilestone??"Nije definisano")}</strong><small class="cell-secondary">${p.nextMilestoneDate?formatDate(p.nextMilestoneDate):"Bez datuma"}</small></td>`;
  if(column==="blockerState")return `<td data-column="blockerState"><span class="blocker-state ${p.blockerState}">${p.blockerState==="blocked"?"Blokiran":"Nije blokiran"}</span></td>`;
  if(column==="blocker")return `<td data-column="blocker"><span class="blocker-text ${p.blockerState}" title="${esc(p.topBlocker??"Nema potvrđene prepreke")}">${esc(p.topBlocker??(p.blockerState==="blocked"?"Blokiran — razlog nije upisan":"Nema potvrđene prepreke"))}</span></td>`;
  if(column==="decisionRequired")return `<td data-column="decisionRequired"><strong class="boolean-cell ${p.decisionRequired?"yes":""}">${yesNo(p.decisionRequired)}</strong></td>`;
  if(column==="decisionText")return longTextCell(column,p.decisionText,"Nije potrebna odluka");
  if(column==="decisionDueDate")return `<td data-column="decisionDueDate"><strong class="cell-primary">${formatDate(p.decisionDueDate)}</strong></td>`;
  if(column==="managementAttention")return `<td data-column="managementAttention"><strong class="boolean-cell ${p.managementAttention?"yes":""}">${yesNo(p.managementAttention)}</strong></td>`;
  if(column==="isDemo")return `<td data-column="isDemo"><strong class="boolean-cell ${p.isDemo?"demo":""}">${p.isDemo?"1 · Da":"0 · Ne"}</strong></td>`;
  return `<td data-column="lastUpdatedAt"><strong class="cell-primary">${statusUpdateLabel(p.lastStatusAt)}</strong><small class="cell-secondary">${p.lastStatusAt?new Intl.DateTimeFormat("sr-Latn-RS",{dateStyle:"medium",timeStyle:"short"}).format(new Date(p.lastStatusAt)):"Nema sačuvanog statusa"}</small></td>`;
}

function projectRow(p: ProjectSummary,columns:ColumnKey[]) {
  const inactive = ["completed","cancelled"].includes(p.lifecycleStatus);
  const decisionOverdue = p.decisionRequired && (daysFromNow(p.decisionDueDate)??1)<0;
  return `<tr class="project-row ${p.managementAttention||p.decisionRequired?"attention-row":""} ${decisionOverdue?"decision-overdue":""} ${inactive?"inactive":""}" data-project-id="${p.id}" tabindex="0">
    ${columns.map(column=>projectCell(column,p)).join("")}
  </tr>`;
}

function projectCardField(column:ColumnKey,p:ProjectSummary){
  const inner=projectCell(column,p).replace(/^<td[^>]*>/,"").replace(/<\/td>$/,"");
  return `<div class="project-card-field" data-card-column="${column}"><span>${columnLabels[column]}</span><div>${inner}</div></div>`;
}

function projectCard(p:ProjectSummary,columns:ColumnKey[]){
  const inactive=["completed","cancelled"].includes(p.lifecycleStatus),decisionOverdue=p.decisionRequired&&(daysFromNow(p.decisionDueDate)??1)<0;
  const fields=columns.filter(column=>column!=="name"&&column!=="health"),visible=fields.slice(0,7),rest=fields.slice(7);
  const updateTooltip=`Status: ${statusUpdateLabel(p.lastStatusAt)}${stale(p.lastStatusAt)?` · potrebno je novo ažuriranje`:""}`;
  const signals=[p.blockerState==="blocked"||p.topBlocker?`<div class="card-signal blocker"><b>Prepreka</b><span>${esc(p.topBlocker??"Projekat je blokiran; razlog nije upisan.")}</span></div>`:"",p.decisionRequired?`<div class="card-signal decision ${decisionOverdue?"overdue":""}"><b>Potrebna odluka${p.decisionDueDate?` · ${formatDate(p.decisionDueDate)}`:""}</b><span>${esc(p.decisionText??"Tekst odluke nije upisan.")}</span></div>`:""] .filter(Boolean).join("");
  const extraFields=!rest.length?"":`<details class="project-card-more"><summary>Prikaži još ${rest.length} ${rest.length===1?"polje":"polja"}</summary><div class="project-card-grid">${rest.map(column=>projectCardField(column,p)).join("")}</div></details>`;
  return `<article class="project-card ${p.managementAttention||p.decisionRequired?"attention-card":""} ${decisionOverdue?"decision-overdue":""} ${inactive?"inactive":""}" data-project-id="${p.id}" tabindex="0"><header class="project-card-head"><button type="button" class="project-card-identity status-history-trigger" data-status-history="${p.id}" data-tooltip="Istorija statusnih izmena"><span class="project-number">${String(p.projectNumber).padStart(3,"0")}</span><span><strong>${esc(p.name)}</strong><small>${labels.lifecycle[p.lifecycleStatus]} · ${labels.category[p.category]}${p.isDemo?" · probni podatak":""}</small></span></button>${columns.includes("health")?`<span class="health-badge ${p.health}"><i></i>${labels.health[p.health]}</span>`:""}</header>${signals?`<div class="card-signals">${signals}</div>`:""}<div class="project-card-grid">${visible.map(column=>projectCardField(column,p)).join("")}</div>${extraFields}</article>`;
}

function renderPortfolio() {
  const list = filteredProjects();
  const source=portfolioProjects(),columns=activeColumns(),layout=effectiveLayout();
  document.body.dataset.layout=layout;
  const groups = groupMode==="all" ? [{key:"all",label:"Svi projekti",group:list,all:source}] : categoryOrder.map(category=>({key:category,label:labels.category[category],group:list.filter(p=>p.category===category),all:source.filter(p=>p.category===category)}));
  document.querySelector("#portfolio")!.innerHTML = groups.map(({key,label,group,all})=>{
    const content=layout==="table"?`<div class="table-wrap"><table style="--column-count:${columns.length}"><thead><tr>${columns.map(column=>sortHeader(columnSortKey[column],columnLabels[column],column)).join("")}</tr></thead><tbody>${group.length?group.map(project=>projectRow(project,columns)).join(""):`<tr><td colspan="${columns.length}" class="empty-state">Nema projekata koji odgovaraju filterima.</td></tr>`}</tbody></table></div>`:`<div class="project-card-list">${group.length?group.map(project=>projectCard(project,columns)).join(""):`<div class="empty-state">Nema projekata koji odgovaraju filterima.</div>`}</div>`;
    return `<section class="portfolio-group" data-category="${key}"><header class="group-head"><div><span class="category-dot ${key}"></span><h2>${label}</h2><span class="count">${group.length}${group.length!==all.length?` / ${all.length}`:""}</span></div><div class="group-summary"><span>${all.filter(p=>p.health==="red"||p.health==="critical").length} crveno/kritično</span><span>${all.filter(needsAttention).length} za reakciju</span><button class="collapse-button" aria-label="Sažmi grupu">⌃</button></div></header>${content}</section>`;
  }).join("");
}

function relativeUpdate(value:string) { const days=Math.floor((Date.now()-new Date(value).getTime())/86400000); return days<=0?"Danas":days===1?"Juče":`${days} dana`; }
function toast(message:string,tone:"ok"|"error"="ok") { const el=document.querySelector<HTMLDivElement>("#toast")!; el.textContent=message; el.className=`toast show ${tone}`; window.setTimeout(()=>el.classList.remove("show"),2600); }

async function openProject(id:string) {
  selected = await api.getProject(id); renderDrawer(); document.body.classList.add("drawer-open");
}

function renderDrawer(view:"overview"|"status"|"audit"="overview") {
  if(!selected) return; const p=selected;
  const drawer=document.querySelector<HTMLElement>("#drawer")!;
  drawer.innerHTML=`<header class="drawer-head"><div><span class="category-label ${p.category}">${labels.category[p.category]}</span><h2><span>${esc(p.projectCode)}</span>${esc(p.name)}</h2><p>${esc(p.owner)} · ${esc(p.leadDepartment??"Bez vodećeg sektora")}</p></div><button class="close-button" id="close-drawer" aria-label="Zatvori">×</button></header>
    <nav class="drawer-tabs"><button data-drawer-view="overview" class="${view==="overview"?"active":""}">Osnovno</button><button data-drawer-view="status" class="${view==="status"?"active":""}">Novi status</button><button data-drawer-view="audit" class="${view==="audit"?"active":""}">Istorija izmena</button></nav>
    <div class="drawer-body">${view==="overview"?overviewForm(p):view==="status"?statusForm(p):`<section class="editor-section" id="audit-view"><p>Učitavam istoriju…</p></section>`}</div>`;
  drawer.querySelector<HTMLFormElement>("#project-form")?.addEventListener("submit",saveProject);
  drawer.querySelector<HTMLFormElement>("#status-form")?.addEventListener("submit",saveStatus);
  if(view==="audit")void loadAuditView(p.id);
}

async function loadAuditView(id:string){const container=document.querySelector<HTMLElement>("#audit-view");if(!container)return;try{const events=await api.auditHistory(id);container.innerHTML=events.length?`<div class="status-timeline">${events.map(event=>auditEventCard(event)).join("")}</div>`:"<p>Još nema evidentiranih izmena.</p>";}catch(error){container.innerHTML=`<p>${esc(error instanceof Error?error.message:"Istorija nije dostupna")}</p>`;}}
function auditEventCard(event:AuditEvent){const changes=Object.entries(event.changedFields??{});return `<article class="status-timeline-item"><time>${esc(historyDate(event.occurredAt))}<br>${esc(event.actorName)}</time><div><strong>${esc(event.summary??event.action)}</strong>${changes.length?`<div class="status-change-list">${changes.map(([field,change])=>`<div><b>${esc(columnLabels[field as ColumnKey]??field)}</b><span class="change-before">${esc(historyValue(field as keyof StatusReportHistoryItem,change.before))}</span><span aria-hidden="true">→</span><span class="change-after">${esc(historyValue(field as keyof StatusReportHistoryItem,change.after))}</span></div>`).join("")}</div>`:""}</div></article>`;}

function overviewForm(p:ProjectDetail) { return `<form id="project-form"><section class="editor-section"><div class="section-title"><div><p class="eyebrow">Zapis projekta</p><h3>Osnovni podaci</h3></div><span class="lifecycle-pill ${p.lifecycleStatus}">${labels.lifecycle[p.lifecycleStatus]}</span></div><div class="form-grid">
  <label class="field span-2"><span>Naziv</span><input name="name" value="${esc(p.name)}" required /></label><label class="field"><span>Kategorija</span><select name="category">${categoryOrder.map(v=>`<option value="${v}" ${p.category===v?"selected":""}>${labels.category[v]}</option>`).join("")}</select></label>
  <label class="field"><span>Životni ciklus</span>${p.lifecycleStatus==="blocked"?`<input type="hidden" name="lifecycleStatus" value="blocked" /><select disabled><option>Blokiran · automatski</option></select>`:`<select name="lifecycleStatus">${Object.entries(labels.lifecycle).filter(([v])=>v!=="blocked").map(([v,l])=>`<option value="${v}" ${p.lifecycleStatus===v?"selected":""}>${l}</option>`).join("")}</select>`}</label><label class="field"><span>Vodeći sektor</span><select name="leadDepartmentId">${departmentOptions(p.leadDepartmentId)}</select></label><label class="field"><span>Vlasnik</span><input name="owner" value="${esc(p.owner)}" required /></label>
  <label class="field"><span>Sponzor</span><input name="sponsor" value="${esc(p.sponsor)}" /></label><label class="field"><span>Rukovodilac projekta / koordinator</span><input name="coordinator" value="${esc(p.coordinator)}" /></label><label class="field"><span>Glavni izvršilac</span><input name="deliveryLead" value="${esc(p.deliveryLead)}" /></label><label class="check-field span-3"><input type="checkbox" name="isDemo" ${p.isDemo?"checked":""}/><span><b>Probni podatak</b><small>1 = probni projekat; 0 = stvarni projekat. Probni projekti mogu biti potpuno isključeni iz prikaza i statistike.</small></span></label>
  <label class="field span-3"><span>Opis</span><textarea name="description">${esc(p.description)}</textarea></label><label class="field span-3"><span>Cilj</span><textarea name="objective">${esc(p.objective)}</textarea></label><label class="field span-3"><span>Krajnji ishod</span><textarea name="outcome">${esc(p.outcome)}</textarea></label></div></section>
  <section class="editor-section"><div class="section-title"><div><p class="eyebrow">Planiranje</p><h3>Datumi i prioritet</h3></div><span class="suggestion">Predloženo: ${labels.priority[p.suggestedPriority]}</span></div><div class="form-grid">
  <label class="field"><span>Prvobitni rok</span><input type="date" name="baselineFinish" value="${p.baselineFinish??""}" /></label><label class="field"><span>Obavezni krajnji rok</span><input type="date" name="mandatoryDeadline" value="${p.mandatoryDeadline??""}" /></label>
  ${scoreField("valueScore","Vrednost",p.valueScore,false)}${scoreField("urgencyScore","Hitnost",p.urgencyScore,true)}${scoreField("consequenceScore","Posledica neizvršenja",p.consequenceScore,false)}
  <label class="field"><span>Konačni prioritet</span><select name="finalPriority">${Object.entries(labels.priority).map(([v,l])=>`<option value="${v}" ${p.finalPriority===v?"selected":""}>${l}</option>`).join("")}</select></label><label class="field span-2"><span>Razlog odstupanja od predloga · opciono</span><textarea name="priorityOverrideReason" placeholder="Kratko obrazloženje ako je konačni prioritet drugačiji">${esc(p.priorityOverrideReason)}</textarea></label></div></section><div class="sticky-actions"><button class="button danger" type="button" data-delete-project>Obriši projekat</button><button class="button primary" type="submit">Sačuvaj izmene</button></div></form>`; }

function scoreField(name:string,label:string,value:number,dynamic:boolean) { return `<label class="field"><span>${label}${dynamic?" · automatski":""}</span><select name="${name}" ${dynamic?"disabled":""}>${["Nema","Nisko","Srednje","Visoko","Veoma visoko",...(dynamic?["Rok probijen"]:[])].map((l,i)=>`<option value="${i}" ${value===i?"selected":""}>${l}</option>`).join("")}</select></label>`; }

function statusForm(p:ProjectDetail) { return `<form id="status-form"><section class="editor-section"><div class="section-title"><div><p class="eyebrow">Novi presek</p><h3>Upravljački status</h3></div><span class="updated-label">${statusUpdateLabel(p.lastStatusAt)}</span></div><div class="form-grid">
  <label class="field"><span>Stanje</span><select name="health">${Object.entries(labels.health).map(([v,l])=>`<option value="${v}" ${p.health===v?"selected":""}>${l}</option>`).join("")}</select></label><label class="field"><span>Kretanje</span><select name="trend">${Object.entries(labels.trend).map(([v,l])=>`<option value="${v}" ${p.trend===v?"selected":""}>${l}</option>`).join("")}</select></label><label class="field"><span>Napredak (%)</span><input type="number" name="progress" min="0" max="100" value="${p.progress??""}" /></label>
  <label class="field"><span>Procenjeni završetak</span><input type="date" name="forecastFinish" value="${p.forecastFinish??""}" /></label><label class="field"><span>Sledeća ključna tačka</span><input name="nextMilestone" value="${esc(p.nextMilestone)}" /></label><label class="field"><span>Datum ključne tačke</span><input type="date" name="nextMilestoneDate" value="${p.nextMilestoneDate??""}" /></label>
  <label class="field"><span>Stanje blokade</span><select name="blockerState"><option value="none" ${p.blockerState==="none"?"selected":""}>Nije blokiran</option><option value="blocked" ${p.blockerState==="blocked"?"selected":""}>Blokiran</option></select></label><label class="field span-2"><span>Glavna prepreka · opciono</span><input name="topBlocker" value="${esc(p.topBlocker)}" placeholder="Navedi samo ako je korisno i primereno" /></label>
  <label class="check-field span-3"><input type="checkbox" name="decisionRequired" ${p.decisionRequired?"checked":""}/><span><b>Potrebna odluka</b><small>Označi ako se očekuje odluka rukovodstva</small></span></label><label class="field span-2"><span>Potrebna odluka</span><textarea name="decisionText">${esc(p.decisionText)}</textarea></label><label class="field"><span>Rok odluke</span><input type="date" name="decisionDueDate" value="${p.decisionDueDate??""}" /></label>
  <label class="check-field span-3 rose"><input type="checkbox" name="managementAttention" ${p.managementAttention?"checked":""}/><span><b>Reakcija menadžmenta</b><small>Naglasi projekat u upravljačkom pregledu</small></span></label><label class="field span-3"><span>Kratak komentar</span><textarea name="summary" placeholder="Najvažnija poruka za ovaj period"></textarea></label>
  </div><p class="field-hint">Svako čuvanje pravi novi statusni presek i ostaje u istoriji.</p></section><div class="sticky-actions"><button class="button primary" type="submit">Sačuvaj novi status</button></div></form>`; }

function bindEvents() {
  document.querySelector("#new-project")!.addEventListener("click",()=>document.querySelector<HTMLDialogElement>("#create-dialog")!.showModal());
  document.querySelector("#open-settings")!.addEventListener("click",()=>openSettingsDialog("general"));
  document.querySelector("#print-report")!.addEventListener("click",printReport);
  document.querySelector("#create-form")!.addEventListener("submit",createProject);
  document.querySelector("#settings-form")!.addEventListener("submit",savePortfolioSettings);
  document.querySelector("#add-department")!.addEventListener("click",addDepartment);
  document.querySelector("#new-department-name")!.addEventListener("keydown",event=>{if((event as KeyboardEvent).key==="Enter"){event.preventDefault();void addDepartment();}});
  document.querySelector("#drawer-scrim")!.addEventListener("click",closeDrawer);
  document.querySelector("#search")!.addEventListener("input",e=>{filters.search=(e.target as HTMLInputElement).value;renderPortfolio();});
  document.querySelector("#health-filter")!.addEventListener("change",e=>{filters.health=(e.target as HTMLSelectElement).value;renderFilterState();renderPortfolio();});
  document.querySelector("#priority-filter")!.addEventListener("change",e=>{filters.priority=(e.target as HTMLSelectElement).value;renderFilterState();renderPortfolio();});
  document.querySelector("#department-filter")!.addEventListener("change",e=>{filters.department=(e.target as HTMLSelectElement).value;renderFilterState();renderPortfolio();});
  document.querySelector("#open-filters")!.addEventListener("click",()=>{filterPanelOpen=!filterPanelOpen;renderFilterState();});
  document.querySelector("#clear-filters")!.addEventListener("click",clearFilters);
  document.querySelector("#demo-toggle")!.addEventListener("click",()=>{showDemo=!showDemo;localStorage.setItem("reportingShowDemo",String(showDemo));filters.department="";render();});
  document.querySelector("#sort-key")!.addEventListener("change",e=>{sortKey=(e.target as HTMLSelectElement).value as SortKey;renderPortfolio();});
  document.querySelector("#sort-direction")!.addEventListener("click",e=>{sortDirection=sortDirection==="asc"?"desc":"asc";(e.currentTarget as HTMLElement).textContent=sortDirection==="asc"?"A→Z":"Z→A";renderPortfolio();});
  app.addEventListener("click",handleDelegatedClick); app.addEventListener("keydown",e=>{const target=e.target as HTMLElement,row=target.closest<HTMLElement>("[data-project-id]");if(row&&!target.closest("summary,button,a,input,select,textarea,label")&&(e.key==="Enter"||e.key===" ")){e.preventDefault();void openProject(row.dataset.projectId!);}});
  document.querySelector("#edited-view")!.addEventListener("change",e=>{editedView=(e.target as HTMLSelectElement).value as ViewMode;renderColumnEditor();});
  document.querySelector("#header-graphic-input")!.addEventListener("change",handleHeaderGraphic);
  document.querySelector("#remove-header-graphic")!.addEventListener("click",()=>{pendingHeaderGraphic=null;renderGraphicPreview();});
  const columnEditor=document.querySelector<HTMLElement>("#column-editor")!;
  columnEditor.addEventListener("dragstart",handleColumnDragStart);columnEditor.addEventListener("dragover",handleColumnDragOver);columnEditor.addEventListener("drop",handleColumnDrop);
  app.addEventListener("pointerover",showHoverTooltip);app.addEventListener("pointermove",moveHoverTooltip);app.addEventListener("pointerout",hideHoverTooltip);
  mobileLayoutQuery.addEventListener("change",renderPortfolio);
}

function handleDelegatedClick(e:MouseEvent) {
  const target=e.target as HTMLElement;
  if(target.closest("[data-add-user]")){void addUser();return;}
  if(target.closest("[data-add-view]")){addView();return;}if(target.closest("[data-delete-view]")){deleteView();return;}
  const statusHistory=target.closest<HTMLElement>("[data-status-history]");if(statusHistory){void openStatusHistory(statusHistory.dataset.statusHistory!);return;}
  const settingsTab=target.closest<HTMLElement>("[data-settings-tab]");if(settingsTab){setSettingsTab(settingsTab.dataset.settingsTab as SettingsTab);return;}
  if(target.closest("[data-close-settings]")){document.querySelector<HTMLDialogElement>("#settings-dialog")!.close();return;}
  const closeDialog=target.closest<HTMLElement>("[data-close-dialog]");if(closeDialog){document.querySelector<HTMLDialogElement>(`#${closeDialog.dataset.closeDialog}`)?.close();return;}
  const moveDepartmentButton=target.closest<HTMLElement>("[data-move-department]");if(moveDepartmentButton){void moveDepartment(moveDepartmentButton.dataset.moveDepartment!,moveDepartmentButton.dataset.direction as "up"|"down");return;}
  const renameDepartmentButton=target.closest<HTMLElement>("[data-rename-department]");if(renameDepartmentButton){void renameDepartment(renameDepartmentButton.dataset.renameDepartment!);return;}
  const deleteDepartmentButton=target.closest<HTMLElement>("[data-delete-department]");if(deleteDepartmentButton){void deleteDepartment(deleteDepartmentButton.dataset.deleteDepartment!);return;}
  const viewButton=target.closest<HTMLElement>("[data-view-mode]");if(viewButton){viewMode=viewButton.dataset.viewMode as ViewMode;localStorage.setItem("reportingView",viewMode);document.body.dataset.view=viewMode;renderViewControls();renderPortfolio();return;}
  const groupButton=target.closest<HTMLElement>("[data-group-mode]");if(groupButton){groupMode=groupButton.dataset.groupMode as GroupMode;localStorage.setItem("reportingGroup",groupMode);document.body.dataset.group=groupMode;renderViewControls();renderPortfolio();return;}
  const layoutButton=target.closest<HTMLElement>("[data-layout-mode]");if(layoutButton){layoutMode=layoutButton.dataset.layoutMode as LayoutMode;localStorage.setItem("reportingLayout",layoutMode);renderViewControls();renderPortfolio();return;}
  const columnToggle=target.closest<HTMLInputElement>("[data-column-toggle]");if(columnToggle){toggleViewColumn(columnToggle.dataset.columnToggle as ColumnKey,columnToggle.checked);return;}
  const moveColumn=target.closest<HTMLElement>("[data-move-column]");if(moveColumn){moveViewColumn(moveColumn.dataset.moveColumn as ColumnKey,moveColumn.dataset.direction as "up"|"down");return;}
  const sortButton=target.closest<HTMLElement>("[data-sort-column]");if(sortButton){const nextKey=sortButton.dataset.sortColumn as SortKey;if(sortKey===nextKey)sortDirection=sortDirection==="asc"?"desc":"asc";else{sortKey=nextKey;sortDirection="asc";}syncSortControls();renderPortfolio();return;} const row=target.closest<HTMLElement>("[data-project-id]"); if(row&&!target.closest("summary,button,a,input,select,textarea,label")){void openProject(row.dataset.projectId!);return;}
  if(target.closest("#close-drawer")){closeDrawer();return;} if(target.closest("[data-delete-project]")){void deleteSelectedProject();return;} const view=target.closest<HTMLElement>("[data-drawer-view]");if(view){renderDrawer(view.dataset.drawerView as "overview"|"status"|"audit");return;}
  if(target.closest("[data-show-attention]")){toggleAttention();renderAttention();return;} if(target.closest(".collapse-button")){target.closest(".portfolio-group")?.classList.toggle("collapsed");return;}
}

function closeDrawer(){document.body.classList.remove("drawer-open");selected=null;}
function toggleAttention(){filters.attention=!filters.attention;syncAttentionButton();renderPortfolio();}
function syncAttentionButton(){renderAttention();}
function syncSortControls(){const select=document.querySelector<HTMLSelectElement>("#sort-key")!;const direction=document.querySelector<HTMLElement>("#sort-direction")!;select.value=sortKey;direction.textContent=sortDirection==="asc"?"A→Z":"Z→A";}
function positionHoverTooltip(event:PointerEvent){const tooltip=document.querySelector<HTMLElement>("#hover-tooltip");if(!tooltip||!tooltip.classList.contains("show"))return;const gap=14,x=Math.min(event.clientX+gap,window.innerWidth-tooltip.offsetWidth-gap),y=Math.min(event.clientY+gap,window.innerHeight-tooltip.offsetHeight-gap);tooltip.style.left=`${Math.max(gap,x)}px`;tooltip.style.top=`${Math.max(gap,y)}px`;}
async function loadStatusHistory(id:string){if(!statusHistoryCache.has(id))statusHistoryCache.set(id,await api.statusHistory(id));return statusHistoryCache.get(id)!;}
const historyDate=(value:string)=>new Intl.DateTimeFormat("sr-Latn-RS",{dateStyle:"medium",timeStyle:"short"}).format(new Date(value));
const historyFields:[keyof StatusReportHistoryItem,string][]=[["health","Stanje"],["trend","Kretanje"],["progress","Napredak"],["forecastFinish","Procena završetka"],["nextMilestone","Ključna tačka"],["nextMilestoneDate","Datum ključne tačke"],["blockerState","Stanje blokade"],["topBlocker","Komentar blokera"],["decisionRequired","Potrebna odluka"],["decisionText","Komentar odluke"],["decisionDueDate","Rok odluke"],["managementAttention","Reakcija menadžmenta"],["summary","Statusni komentar"]];
function historyValue(key:keyof StatusReportHistoryItem,value:unknown){if(value===null||value===undefined||value==="")return "Nije definisano";if(typeof value==="boolean")return value?"Uključeno":"Isključeno";if(key==="health")return labels.health[value as keyof typeof labels.health]??String(value);if(key==="trend")return labels.trend[value as keyof typeof labels.trend]??String(value);if(key==="blockerState")return value==="blocked"?"Blokirano":value==="none"?"Nema blokade":"Nije definisano";if(key==="progress")return `${value}%`;if(["forecastFinish","nextMilestoneDate","decisionDueDate"].includes(key))return formatDate(String(value));return String(value);}
function historyChanges(item:StatusReportHistoryItem,previous?:StatusReportHistoryItem){return historyFields.filter(([key])=>!previous||item[key]!==previous[key]).map(([key,label])=>({label,before:previous?historyValue(key,previous[key]):"Početno stanje",after:historyValue(key,item[key])}));}
async function openStatusHistory(id:string){const project=projects.find(item=>item.id===id),dialog=document.querySelector<HTMLDialogElement>("#status-history-dialog")!,content=document.querySelector<HTMLElement>("#status-history-content")!;document.querySelector("#status-history-title")!.textContent=project?`${project.projectCode} · ${project.name}`:"Status projekta";content.innerHTML="<p>Učitavam istoriju…</p>";dialog.showModal();try{const items=await loadStatusHistory(id);content.innerHTML=items.length?`<div class="status-timeline">${items.map((item,index)=>{const changes=historyChanges(item,items[index+1]);return `<article class="status-timeline-item"><time>${esc(historyDate(item.createdAt))}</time><div><strong>Status #${item.versionNumber} · ${labels.health[item.health]} · ${item.progress??"—"}%</strong>${changes.length?`<div class="status-change-list">${changes.map(change=>`<div><b>${esc(change.label)}</b><span class="change-before">${esc(change.before)}</span><span aria-hidden="true">→</span><span class="change-after">${esc(change.after)}</span></div>`).join("")}</div>`:"<p>U ovom preseku nema promenjenih polja.</p>"}</div></article>`;}).join("")}</div>`:"<p>Nema sačuvanih statusnih preseka.</p>";}catch(error){content.innerHTML=`<p>${esc(error instanceof Error?error.message:"Istorija nije dostupna")}</p>`;}}
async function showHoverTooltip(event:PointerEvent){if(!window.matchMedia("(hover: hover)").matches)return;const trigger=(event.target as HTMLElement).closest<HTMLElement>("[data-tooltip]");if(!trigger||trigger.contains(event.relatedTarget as Node))return;const tooltip=document.querySelector<HTMLElement>("#hover-tooltip")!;tooltip.textContent=trigger.dataset.tooltip??"";tooltip.classList.add("show");positionHoverTooltip(event);const id=trigger.dataset.statusHistory;if(id){try{const items=await loadStatusHistory(id),recent=items.slice(0,-1).flatMap((item,index)=>historyChanges(item,items[index+1]).map(change=>`${change.label}: ${change.before} → ${change.after}`)).slice(0,3);tooltip.textContent=recent.length?recent.join("\n"):"Nema evidentiranih promena";tooltip.style.whiteSpace="pre-line";positionHoverTooltip(event);}catch{tooltip.textContent="Istorija statusa nije dostupna.";}}}
function moveHoverTooltip(event:PointerEvent){positionHoverTooltip(event);}
function hideHoverTooltip(event:PointerEvent){const trigger=(event.target as HTMLElement).closest<HTMLElement>("[data-tooltip]");if(!trigger||trigger.contains(event.relatedTarget as Node))return;document.querySelector<HTMLElement>("#hover-tooltip")?.classList.remove("show");}
function filterSummary(){const parts:string[]=[];if(filters.search)parts.push(`Pretraga: ${filters.search}`);if(filters.health)parts.push(`Stanje: ${labels.health[filters.health as keyof typeof labels.health]??filters.health}`);if(filters.priority)parts.push(`Prioritet: ${labels.priority[filters.priority as keyof typeof labels.priority]??filters.priority}`);if(filters.department)parts.push(`Sektor: ${filters.department}`);if(filters.attention)parts.push("Samo projekti koji zahtevaju reakciju menadžmenta");return parts.length?parts.join(" · "):"Bez dodatnih filtera";}
function clearFilters(){filters={...filters,health:"",priority:"",department:"",attention:false};document.querySelector<HTMLSelectElement>("#health-filter")!.value="";document.querySelector<HTMLSelectElement>("#priority-filter")!.value="";document.querySelector<HTMLSelectElement>("#department-filter")!.value="";renderAttention();renderFilterState();renderPortfolio();}
async function printReport(){const button=document.querySelector<HTMLButtonElement>("#print-report")!;button.disabled=true;button.classList.add("working");try{const reportProjects=portfolioSettings.pdfIncludeInactive?filteredProjects():filteredProjects().filter(project=>!["completed","cancelled"].includes(project.lifecycleStatus));const reportView=portfolioSettings.pdfView==="current"?viewMode:portfolioSettings.pdfView as ViewMode;const reportGroup=portfolioSettings.pdfGroup==="current"?groupMode:portfolioSettings.pdfGroup as GroupMode;const summary=`${portfolioSettings.pdfIncludeInactive?filterSummary():`${filterSummary()} · Bez završenih i otkazanih projekata`}${showDemo?"":" · Probni podaci isključeni"}`;await downloadPortfolioPdf(reportProjects,reportView,reportGroup,summary,portfolioSettings);toast("PDF je preuzet");}catch(error){toast(error instanceof Error?error.message:"PDF nije generisan","error");}finally{button.disabled=false;button.classList.remove("working");}}

type SettingsTab="general"|"views"|"departments"|"reporting";
function setSettingsTab(tab:SettingsTab) {
  document.querySelectorAll<HTMLElement>("[data-settings-tab]").forEach(button=>button.classList.toggle("active",button.dataset.settingsTab===tab));
  document.querySelectorAll<HTMLElement>("[data-settings-pane]").forEach(pane=>pane.hidden=pane.dataset.settingsPane!==tab);
}

function renderGraphicPreview(){const preview=document.querySelector<HTMLElement>("#graphic-preview");if(!preview)return;preview.innerHTML=pendingHeaderGraphic?`<img src="${esc(pendingHeaderGraphic)}" alt="Pregled grafike zaglavlja" />`:`<span>Bez grafike</span>`;const remove=document.querySelector<HTMLButtonElement>("#remove-header-graphic");if(remove)remove.disabled=!pendingHeaderGraphic;}
function handleHeaderGraphic(event:Event){const file=(event.target as HTMLInputElement).files?.[0];if(!file)return;if(file.size>500*1024){toast("Grafika može imati najviše 500 KB","error");(event.target as HTMLInputElement).value="";return;}const reader=new FileReader();reader.onload=()=>{pendingHeaderGraphic=String(reader.result);renderGraphicPreview();};reader.readAsDataURL(file);}

function renderColumnEditor(){
  const container=document.querySelector<HTMLElement>("#column-editor");if(!container)return;
  const selectedColumns=workingViewColumns[editedView]??["name"];
  const ordered=[...selectedColumns,...(Object.keys(columnLabels) as ColumnKey[]).filter(column=>!selectedColumns.includes(column))];
  const options={...viewOptions,...Object.fromEntries(workingCustomViews.map(view=>[view.id,{...view,columns:workingViewColumns[view.id]??["name"]}]))},select=document.querySelector<HTMLSelectElement>("#edited-view")!;select.innerHTML=Object.entries(options).map(([id,option])=>`<option value="${id}">${esc(option.label)}</option>`).join("");select.value=editedView;
  document.querySelector<HTMLElement>("#edited-view-description")!.textContent=options[editedView]?.description??"";
  const deleteButton=document.querySelector<HTMLButtonElement>("[data-delete-view]");if(deleteButton)deleteButton.disabled=!workingCustomViews.some(view=>view.id===editedView);
  container.innerHTML=ordered.map((column,index)=>{const checked=selectedColumns.includes(column),locked=column==="name";return `<div class="column-editor-row ${checked?"selected":""}" draggable="${checked&&!locked}" data-column-item="${column}"><span class="drag-handle" aria-hidden="true">⋮⋮</span><label><input type="checkbox" data-column-toggle="${column}" ${checked?"checked":""} ${locked?"disabled":""}/><strong>${columnLabels[column]}</strong></label><span class="column-state">${locked?"Obavezno":checked?String(index+1):"Isključeno"}</span><button type="button" data-move-column="${column}" data-direction="up" aria-label="Pomeri nagore" ${!checked||locked||index<=1?"disabled":""}>↑</button><button type="button" data-move-column="${column}" data-direction="down" aria-label="Pomeri nadole" ${!checked||index===selectedColumns.length-1?"disabled":""}>↓</button></div>`;}).join("");
}
function toggleViewColumn(column:ColumnKey,checked:boolean){const list=workingViewColumns[editedView]??(workingViewColumns[editedView]=["name"]);if(column==="name")return;if(checked&&!list.includes(column))list.push(column);if(!checked)workingViewColumns[editedView]=list.filter(item=>item!==column);renderColumnEditor();}
function moveViewColumn(column:ColumnKey,direction:"up"|"down"){const list=workingViewColumns[editedView]??["name"],index=list.indexOf(column),next=direction==="up"?index-1:index+1;if(index<=0&&direction==="up"||next<=0||next>=list.length)return;[list[index],list[next]]=[list[next]!,list[index]!];renderColumnEditor();}
function handleColumnDragStart(event:DragEvent){const row=(event.target as HTMLElement).closest<HTMLElement>("[data-column-item]");if(!row||row.getAttribute("draggable")!=="true")return;event.dataTransfer?.setData("text/plain",row.dataset.columnItem!);event.dataTransfer!.effectAllowed="move";}
function handleColumnDragOver(event:DragEvent){if((event.target as HTMLElement).closest("[data-column-item]"))event.preventDefault();}
function handleColumnDrop(event:DragEvent){event.preventDefault();const source=event.dataTransfer?.getData("text/plain") as ColumnKey,target=(event.target as HTMLElement).closest<HTMLElement>("[data-column-item]")?.dataset.columnItem as ColumnKey;if(!source||!target||source===target)return;const list=workingViewColumns[editedView]??["name"],from=list.indexOf(source),to=list.indexOf(target);if(from<0||to<=0)return;list.splice(to,0,...list.splice(from,1));renderColumnEditor();}
function addView(){const label=window.prompt("Naziv novog pregleda:")?.trim();if(!label)return;const base=label.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,24)||"pregled";let id=base,n=2;while(viewOptions[id]||workingCustomViews.some(view=>view.id===id))id=`${base}-${n++}`;workingCustomViews.push({id,label,description:"Korisnički pregled"});workingViewColumns[id]=[...(workingViewColumns[editedView]??["name"])];editedView=id;renderColumnEditor();}
function deleteView(){const index=workingCustomViews.findIndex(view=>view.id===editedView);if(index<0||!window.confirm(`Obrisati pregled „${workingCustomViews[index]!.label}”?`))return;const deletedId=editedView;delete workingViewColumns[deletedId];workingCustomViews.splice(index,1);const form=document.querySelector<HTMLFormElement>("#settings-form")!,defaultSelect=form.elements.namedItem("defaultView") as HTMLSelectElement,pdfSelect=form.elements.namedItem("pdfView") as HTMLSelectElement;if(defaultSelect.value===deletedId)defaultSelect.value="detailed";if(pdfSelect.value===deletedId)pdfSelect.value="current";if(viewMode===deletedId){viewMode="detailed";localStorage.setItem("reportingView",viewMode);}editedView="detailed";renderColumnEditor();}

function renderDepartmentSettings() {
  const container=document.querySelector<HTMLElement>("#department-settings-list");
  if(!container)return;
  container.innerHTML=departments.length?departments.map((department,index)=>`<div class="department-setting-row"><input class="department-order" value="${esc(department.code)}" maxlength="16" data-department-code="${department.id}" aria-label="Šifra sektora" /><input value="${esc(department.name)}" maxlength="120" data-department-input="${department.id}" aria-label="Naziv sektora" /><button class="department-move" type="button" data-move-department="${department.id}" data-direction="up" title="Pomeri nagore" aria-label="Pomeri sektor nagore" ${index===0?"disabled":""}>↑</button><button class="department-move" type="button" data-move-department="${department.id}" data-direction="down" title="Pomeri nadole" aria-label="Pomeri sektor nadole" ${index===departments.length-1?"disabled":""}>↓</button><button class="button ghost small" type="button" data-rename-department="${department.id}">Sačuvaj</button><button class="button danger small" type="button" data-delete-department="${department.id}">Izbriši</button></div>`).join(""):`<div class="settings-empty">Nema definisanih sektora.</div>`;
}

function openSettingsDialog(tab:SettingsTab="general") {
  const dialog=document.querySelector<HTMLDialogElement>("#settings-dialog")!;
  const form=document.querySelector<HTMLFormElement>("#settings-form")!;
  (form.elements.namedItem("title") as HTMLInputElement).value=portfolioSettings.title;
  (form.elements.namedItem("tagline") as HTMLTextAreaElement).value=portfolioSettings.tagline;
  (form.elements.namedItem("defaultView") as HTMLSelectElement).value=portfolioSettings.defaultView;
  (form.elements.namedItem("defaultGroup") as HTMLSelectElement).value=portfolioSettings.defaultGroup;
  (form.elements.namedItem("defaultSortKey") as HTMLSelectElement).value=portfolioSettings.defaultSortKey;
  (form.elements.namedItem("defaultSortDirection") as HTMLSelectElement).value=portfolioSettings.defaultSortDirection;
  (form.elements.namedItem("pdfView") as HTMLSelectElement).value=portfolioSettings.pdfView;
  (form.elements.namedItem("pdfGroup") as HTMLSelectElement).value=portfolioSettings.pdfGroup;
  (form.elements.namedItem("pdfIncludeInactive") as HTMLInputElement).checked=portfolioSettings.pdfIncludeInactive;
  pendingHeaderGraphic=portfolioSettings.headerGraphic;workingViewColumns=structuredClone(portfolioSettings.viewColumns);workingCustomViews=structuredClone(portfolioSettings.customViews);renderSettingsViewSelects(form);renderUserSettings();renderGraphicPreview();renderColumnEditor();renderDepartmentSettings();setSettingsTab(tab);
  dialog.showModal();
}

function renderSettingsViewSelects(form:HTMLFormElement){const options=allViewOptions(),defaultSelect=form.elements.namedItem("defaultView") as HTMLSelectElement,pdfSelect=form.elements.namedItem("pdfView") as HTMLSelectElement;defaultSelect.innerHTML=Object.entries(options).map(([id,view])=>`<option value="${id}">${esc(view.label)}</option>`).join("");pdfSelect.innerHTML=`<option value="current">Kao trenutni prikaz</option>${Object.entries(options).map(([id,view])=>`<option value="${id}">${esc(view.label)}</option>`).join("")}`;defaultSelect.value=portfolioSettings.defaultView;pdfSelect.value=portfolioSettings.pdfView;}
function renderUserSettings(){const grid=document.querySelector<HTMLElement>('[data-settings-pane="general"] .form-grid')!;let block=document.querySelector<HTMLElement>("#user-profile-setting");if(!block){grid.insertAdjacentHTML("beforeend",`<div class="span-3 department-add" id="user-profile-setting"><label class="field"><span>Aktivni lokalni korisnik</span><select name="activeUserId"></select></label><input id="new-user-name" maxlength="80" placeholder="Ime novog korisnika" /><button type="button" class="button primary" data-add-user>+ Dodaj korisnika</button></div>`);block=document.querySelector("#user-profile-setting")!;}const select=block.querySelector<HTMLSelectElement>('select[name="activeUserId"]')!;select.innerHTML=users.map(user=>`<option value="${user.id}">${esc(user.displayName)}</option>`).join("");select.value=portfolioSettings.activeUserId??users[0]?.id??"";}
async function addUser(){const input=document.querySelector<HTMLInputElement>("#new-user-name")!,name=input.value.trim();if(name.length<2){toast("Unesi ime korisnika","error");return;}try{const user=await api.createUser(name);users=await api.listUsers();portfolioSettings.activeUserId=user.id;renderUserSettings();toast("Korisnik je dodat");}catch(error){toast(error instanceof Error?error.message:"Korisnik nije dodat","error");}}

async function savePortfolioSettings(e:Event) {
  e.preventDefault();
  const form=e.currentTarget as HTMLFormElement,f=new FormData(form),button=form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  button.disabled=true;button.textContent="Čuvam…";
  try{
    portfolioSettings=await api.updateSettings({title:String(f.get("title")),tagline:String(f.get("tagline")),defaultView:String(f.get("defaultView")) as PortfolioSettings["defaultView"],defaultGroup:String(f.get("defaultGroup")) as PortfolioSettings["defaultGroup"],defaultSortKey:String(f.get("defaultSortKey")) as PortfolioSettings["defaultSortKey"],defaultSortDirection:String(f.get("defaultSortDirection")) as PortfolioSettings["defaultSortDirection"],pdfView:String(f.get("pdfView")) as PortfolioSettings["pdfView"],pdfGroup:String(f.get("pdfGroup")) as PortfolioSettings["pdfGroup"],pdfIncludeInactive:f.get("pdfIncludeInactive")==="on",headerGraphic:pendingHeaderGraphic,viewColumns:workingViewColumns,customViews:workingCustomViews,activeUserId:nullable(f,"activeUserId")});
    renderHeaderBrand();renderViewControls();renderPortfolio();
    document.querySelector<HTMLDialogElement>("#settings-dialog")!.close();
    toast("Podešavanja su sačuvana");
  }catch(error){toast(error instanceof Error?error.message:"Podešavanja nisu sačuvana","error");}
  finally{button.disabled=false;button.textContent="Sačuvaj podešavanja";}
}

async function refreshDepartmentsAndProjects(){[departments,projects]=await Promise.all([api.listDepartments(),api.listProjects()]);renderDepartments();renderPortfolio();renderDepartmentSettings();}

async function addDepartment(){const input=document.querySelector<HTMLInputElement>("#new-department-name")!,codeInput=document.querySelector<HTMLInputElement>("#new-department-code")!;const name=input.value.trim(),code=codeInput.value.trim().toUpperCase();if(name.length<2||code.length<2){toast("Unesi šifru i naziv sektora","error");return;}try{await api.createDepartment(name,code);input.value="";codeInput.value="";await refreshDepartmentsAndProjects();toast("Sektor je dodat");}catch(error){toast(error instanceof Error?error.message:"Sektor nije dodat","error");}}

async function renameDepartment(id:string){const input=document.querySelector<HTMLInputElement>(`[data-department-input="${id}"]`),codeInput=document.querySelector<HTMLInputElement>(`[data-department-code="${id}"]`);const name=input?.value.trim()??"",code=codeInput?.value.trim().toUpperCase()??"";if(name.length<2||code.length<2){toast("Unesi šifru i naziv sektora","error");return;}try{await api.renameDepartment(id,name,code);await refreshDepartmentsAndProjects();toast("Sektor je sačuvan");}catch(error){toast(error instanceof Error?error.message:"Sektor nije sačuvan","error");}}

async function moveDepartment(id:string,direction:"up"|"down"){try{await api.moveDepartment(id,direction);departments=await api.listDepartments();renderDepartments();renderDepartmentSettings();}catch(error){toast(error instanceof Error?error.message:"Redosled nije sačuvan","error");}}

async function deleteDepartment(id:string){const department=departments.find(item=>item.id===id);if(!department)return;if(!window.confirm(`Izbrisati sektor „${department.name}”? Povezani projekti ostaće bez vodećeg sektora.`))return;try{const result=await api.deleteDepartment(id);await refreshDepartmentsAndProjects();toast(result.affectedProjects?`Sektor je izbrisan; ${result.affectedProjects} projekata je ostalo bez vodećeg sektora.`:"Sektor je izbrisan");}catch(error){toast(error instanceof Error?error.message:"Sektor nije izbrisan","error");}}

async function createProject(e:Event) { e.preventDefault();const form=e.currentTarget as HTMLFormElement;const data=new FormData(form);try{const project=await api.createProject({name:String(data.get("name")),category:String(data.get("category")) as ProjectCategory,owner:String(data.get("owner")),leadDepartmentId:nullable(data,"leadDepartment"),isDemo:data.get("isDemo")==="on"});projects=await api.listProjects();render();document.querySelector<HTMLDialogElement>("#create-dialog")!.close();form.reset();toast("Projekat je kreiran");await openProject(project.id);}catch(error){toast(error instanceof Error?error.message:"Kreiranje nije uspelo","error");}}

async function deleteSelectedProject(){
  if(!selected)return;
  const project=selected;
  if(!window.confirm(`Trajno obrisati projekat „${project.name}” i sve njegove statusne preseke?`))return;
  try{
    await api.deleteProject(project.id);
    statusHistoryCache.delete(project.id);
    projects=await api.listProjects();
    closeDrawer();
    render();
    toast("Projekat je obrisan");
  }catch(error){toast(error instanceof Error?error.message:"Projekat nije obrisan","error");}
}

async function saveProject(e:Event) {
  e.preventDefault();if(!selected)return;
  const form=e.currentTarget as HTMLFormElement,f=new FormData(form),button=form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  button.disabled=true;button.textContent="Čuvam…";
  try{
    selected=await api.updateProject(selected.id,{name:String(f.get("name")),category:String(f.get("category")) as ProjectCategory,leadDepartmentId:nullable(f,"leadDepartmentId"),owner:String(f.get("owner")),sponsor:nullable(f,"sponsor"),coordinator:nullable(f,"coordinator"),deliveryLead:nullable(f,"deliveryLead"),lifecycleStatus:String(f.get("lifecycleStatus")) as ProjectDetail["lifecycleStatus"],description:nullable(f,"description"),objective:nullable(f,"objective"),outcome:nullable(f,"outcome"),baselineFinish:nullable(f,"baselineFinish"),mandatoryDeadline:nullable(f,"mandatoryDeadline"),valueScore:Number(f.get("valueScore")) as Score,urgencyScore:Number(f.get("urgencyScore")) as UrgencyScore,consequenceScore:Number(f.get("consequenceScore")) as Score,finalPriority:String(f.get("finalPriority")) as Priority,priorityOverrideReason:nullable(f,"priorityOverrideReason"),isDemo:f.get("isDemo")==="on"});
    projects=await api.listProjects();render();renderDrawer("overview");toast("Izmene su sačuvane");
  }catch(error){toast(error instanceof Error?error.message:"Čuvanje nije uspelo","error");}
  finally{button.disabled=false;button.textContent="Sačuvaj izmene";}
}

async function saveStatus(e:Event) {
  e.preventDefault();if(!selected)return;
  const form=e.currentTarget as HTMLFormElement,f=new FormData(form),button=form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  button.disabled=true;button.textContent="Čuvam…";
  try{
    const decisionRequired=f.get("decisionRequired")==="on";
    selected=await api.addStatus(selected.id,{health:String(f.get("health")) as ProjectDetail["health"],trend:String(f.get("trend")) as ProjectDetail["trend"],progress:numberOrNull(f,"progress"),forecastFinish:nullable(f,"forecastFinish"),nextMilestone:nullable(f,"nextMilestone"),nextMilestoneDate:nullable(f,"nextMilestoneDate"),blockerState:String(f.get("blockerState")) as ProjectDetail["blockerState"],topBlocker:nullable(f,"topBlocker"),decisionRequired,decisionText:decisionRequired?nullable(f,"decisionText"):null,decisionDueDate:decisionRequired?nullable(f,"decisionDueDate"):null,managementAttention:f.get("managementAttention")==="on",summary:nullable(f,"summary")});statusHistoryCache.delete(selected.id);
    projects=await api.listProjects();render();renderDrawer("status");toast("Status je sačuvan");
  }catch(error){toast(error instanceof Error?error.message:"Status nije sačuvan","error");}
  finally{button.disabled=false;button.textContent="Sačuvaj novi status";}
}

async function init() {shell();bindEvents();try{const [,data,settings,departmentData,userData]=await Promise.all([api.health(),api.listProjects(),api.getSettings(),api.listDepartments(),api.listUsers()]);projects=data;departments=departmentData;users=userData;portfolioSettings={...settings,viewColumns:settings.viewColumns??structuredClone(defaultViewColumns),headerGraphic:settings.headerGraphic??null};if(!savedView)viewMode=settings.defaultView as ViewMode;if(!savedGroup)groupMode=settings.defaultGroup as GroupMode;sortKey=settings.defaultSortKey as SortKey;sortDirection=settings.defaultSortDirection;workingViewColumns=structuredClone(portfolioSettings.viewColumns);syncSortControls();render();}catch(error){document.querySelector("#portfolio")!.innerHTML=`<div class="fatal"><strong>Aplikacija ne može da se poveže sa lokalnim servisom.</strong><p>${esc(error instanceof Error?error.message:"Nepoznata greška")}</p></div>`;}}

void init();
