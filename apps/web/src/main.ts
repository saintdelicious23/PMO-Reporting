import "./styles.css";
import "./editorial.css";
import "./monolith.css";
import { api } from "./api.ts";
import type { AppUser, AuditEvent, Department, PortfolioSettings, PortfolioSortKey, Priority, ProjectCategory, ProjectDetail, ProjectRole, ProjectRoleAssignment, ProjectRoleInput, ProjectSummary, Score, StatusReportHistoryItem, UrgencyScore } from "../../../packages/contracts/src/index.ts";
import { downloadPortfolioPdf } from "./pdf-report.ts";
import { columnLabels, defaultViewColumns, viewOptions, type ColumnKey, type GroupMode, type ViewMode } from "./view-config.ts";
import { formatLocalDate, parseLocalDate } from "./date-input.ts";

type SortKey = PortfolioSortKey;
type Filters = { search:string; health:string; priority:string; department:string; attention:boolean };
type VisualTheme = "standard"|"editorial"|"monolith";

const labels = {
  category: { strategic:"Strateški projekat", mandatory:"Regulatorne obaveze", operational_improvement:"Operativno unapređenje" },
  health: { green:"Zeleno", amber:"Žuto", red:"Crveno", critical:"Kritično" },
  lifecycle: { planning:"Planiranje",active:"Aktivan",on_hold:"Privremeno obustavljen",blocked:"Blokiran",completed:"Završen",cancelled:"Otkazan" },
  priority: { low:"Nizak",medium:"Srednji",high:"Visok",very_high:"Veoma visok",critical:"Kritičan" },
  trend: { improving:"Poboljšava se",stable:"Stabilno",declining:"Pogoršava se" },
} as const;
const displayHealthLabels = { gray:"Sivo",...labels.health } as const;
type DisplayHealth = keyof typeof displayHealthLabels;
const displayHealth=(project:ProjectSummary):DisplayHealth=>project.lifecycleStatus==="planning"?"gray":project.health;
const roleMeta:Record<ProjectRole,{singular:string;plural:string;optional:boolean}> = {
  sponsor:{singular:"Sponzor",plural:"Sponzori",optional:true},
  owner:{singular:"Vlasnik",plural:"Vlasnici",optional:false},
  coordinator:{singular:"Koordinator",plural:"Koordinatori",optional:true},
  executor:{singular:"Izvršilac",plural:"Izvršioci",optional:true}
};
const roleForColumn:Partial<Record<ColumnKey,ProjectRole>>={owner:"owner",sponsor:"sponsor",coordinator:"coordinator",deliveryLead:"executor"};
const projectRoles=(project:ProjectSummary,role:ProjectRole)=>project.roles.filter(assignment=>assignment.role===role).sort((a,b)=>Number(b.isPrimary)-Number(a.isPrimary)||a.position-b.position);
const roleNames=(project:ProjectSummary,role:ProjectRole)=>projectRoles(project,role).map(assignment=>assignment.name);
const roleText=(project:ProjectSummary,role:ProjectRole,fallback="Nije definisano")=>{
  const assignments=projectRoles(project,role);
  return assignments.map(assignment=>`${assignment.name}${assignments.length>1&&assignment.isPrimary?" ★":""}`).join(", ")||fallback;
};
const roleLabel=(role:ProjectRole,count:number)=>count===1?roleMeta[role].singular:roleMeta[role].plural;

const categoryOrder: ProjectCategory[] = ["strategic","mandatory","operational_improvement"];
const priorityRank: Record<Priority,number> = { low:0,medium:1,high:2,very_high:3,critical:4 };
const healthRank:Record<DisplayHealth,number> = { gray:0,green:1,amber:2,red:3,critical:4 };
const trendRank = { declining:0,stable:1,improving:2 } as const;
const sortLabels:Record<SortKey,string>={id:"Puni ID",projectNumber:"Redni broj",name:"Naziv",category:"Kategorija",leadDepartment:"Sektor",owner:"Vlasnici",sponsor:"Sponzori",coordinator:"Koordinatori",deliveryLead:"Izvršioci",lifecycleStatus:"Životni ciklus",description:"Opis",objective:"Cilj",outcome:"Krajnji ishod",health:"Stanje",trend:"Kretanje",progress:"Napredak",plannedStart:"Planirani početak",actualStart:"Stvarni početak",baselineFinish:"Prvobitni rok",forecastFinish:"Procena završetka",mandatoryDeadline:"Obavezni rok",valueScore:"Vrednost",urgencyScore:"Hitnost",consequenceScore:"Posledica neizvršenja",finalPriority:"Prioritet",nextMilestone:"Sledeća ključna tačka",nextMilestoneDate:"Datum ključne tačke",blockerState:"Stanje blokade",topBlocker:"Prepreka",decisionRequired:"Potrebna odluka",decisionText:"Tekst odluke",decisionDueDate:"Rok odluke",managementAttention:"Reakcija menadžmenta",isDemo:"Probni podatak",lastUpdatedAt:"Ažuriranje"};

let projects: ProjectSummary[] = [];
let departments:Department[]=[];
let users:AppUser[]=[];
let currentAuthUser:AppUser|null=null;
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
  updatedAt:new Date(0).toISOString()
};
let sortKey: SortKey = "name";
let sortDirection: "asc"|"desc" = "asc";
let filters: Filters = { search:"",health:"",priority:"",department:"",attention:false };
const savedView=localStorage.getItem("reportingView");
let viewMode:ViewMode = savedView&&savedView in viewOptions?savedView as ViewMode:"detailed";
const savedGroup=localStorage.getItem("reportingGroup");
let groupMode:GroupMode = savedGroup==="all"||savedGroup==="department"?savedGroup:"category";
let showDemo=localStorage.getItem("reportingShowDemo")!=="false";
let filterPanelOpen=false;
let viewPanelOpen=false;
let expandedProjectId:string|null=null;
const savedTheme=localStorage.getItem("reportingTheme");
const normalizedTheme=savedTheme==="standard"||savedTheme==="monolith"||savedTheme==="editorial"?savedTheme:savedTheme?"monolith":null;
const themeOrder:VisualTheme[]=["editorial","monolith","standard"];
const themeLabels:Record<VisualTheme,string>={standard:"Standardni",editorial:"Editorial",monolith:"Monolit"};
let visualTheme:VisualTheme=normalizedTheme==="standard"||normalizedTheme==="monolith"||normalizedTheme==="editorial"?normalizedTheme:"editorial";
document.body.dataset.theme=visualTheme;
if(savedTheme&&savedTheme!==normalizedTheme)localStorage.setItem("reportingTheme",visualTheme);
const nextTheme=(theme:VisualTheme)=>themeOrder[(themeOrder.indexOf(theme)+1)%themeOrder.length]!;
const themeToggleLabel=(theme:VisualTheme)=>`Trenutno: ${themeLabels[theme]}. Pređi na: ${themeLabels[nextTheme(theme)]}.`;
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
const localDateInput=(name:string,value:string|null)=>`<span class="local-date-control"><input type="text" name="${name}" value="${formatLocalDate(value)}" inputmode="numeric" maxlength="10" placeholder="dd.mm.gggg" pattern="[0-9]{2}[.][0-9]{2}[.][0-9]{4}" title="Format: dd.mm.gggg" autocomplete="off" data-local-date /><span class="date-picker-icon" aria-hidden="true"><svg viewBox="0 0 20 20"><rect x="3" y="4.5" width="14" height="12.5" rx="2"/><path d="M6.5 2.5v4M13.5 2.5v4M3 8h14"/></svg></span><input type="date" class="date-picker-proxy" value="${value??""}" tabindex="-1" aria-label="Izaberi datum iz kalendara" data-date-picker="${name}" /></span>`;
const dateFromForm=(form:FormData,key:string,label:string)=>parseLocalDate(form.get(key),label);
function syncPickerFromDateText(input:HTMLInputElement){
  const picker=input.closest<HTMLElement>(".local-date-control")?.querySelector<HTMLInputElement>("[data-date-picker]");if(!picker)return;
  try{picker.value=parseLocalDate(input.value)??"";input.setCustomValidity("");}catch(error){picker.value="";input.setCustomValidity(error instanceof Error?error.message:"Datum nije ispravan.");}
}
function syncDateTextFromPicker(picker:HTMLInputElement){
  const input=picker.closest<HTMLElement>(".local-date-control")?.querySelector<HTMLInputElement>("[data-local-date]");if(!input)return;
  input.value=formatLocalDate(picker.value);input.setCustomValidity("");
}
const needsAttention = (project:ProjectSummary) => project.managementAttention||project.decisionRequired||project.health==="critical"||project.lifecycleStatus==="blocked";
const departmentOptions = (selectedId:string|null=null) => `<option value="">Nije definisano</option>${departments.map(department=>`<option value="${department.id}" ${selectedId===department.id?"selected":""}>${esc(department.code)} · ${esc(department.name)}</option>`).join("")}`;

function shell() {
  const themeLabel=themeToggleLabel(visualTheme);
  app.innerHTML = `
    <header class="app-header">
      <div class="brand" id="header-brand"></div>
      <div class="header-actions"><span class="header-user">${esc(currentAuthUser?.username??"")}${currentAuthUser?.isAdmin?" · admin":""}</span><button class="header-icon-button" id="logout" aria-label="Odjavi se" title="Odjavi se"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4H5v16h5M14 8l4 4-4 4M8 12h10"/></svg></button><button class="header-icon-button theme-header-toggle" id="theme-toggle" aria-label="${themeLabel}" title="${themeLabel}" data-tooltip="${themeLabel}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9c0-1.1-.9-2-2-2h-1.2a2 2 0 0 1-1.85-2.76l.27-.66A2.6 2.6 0 0 0 13.8 3H12Z"/><circle cx="7.5" cy="10" r=".8"/><circle cx="10" cy="6.8" r=".8"/><circle cx="7.8" cy="14" r=".8"/></svg></button><button class="header-icon-button demo-header-toggle ${showDemo?"active":""}" id="demo-toggle" aria-label="Uključi ili isključi probne podatke" aria-pressed="${showDemo}" title="Probni podaci"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6M10 3v5l-5 9a2.5 2.5 0 0 0 2.2 3.7h9.6A2.5 2.5 0 0 0 19 17l-5-9V3M7.5 15h9"/></svg></button><span class="header-action-separator" aria-hidden="true"></span><button class="header-icon-button" id="open-settings" aria-label="Otvori podešavanja" title="Podešavanja"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.55V21h-4v-.08A1.7 1.7 0 0 0 8.97 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.52-1.03H3v-4h.08A1.7 1.7 0 0 0 4.6 8.94a1.7 1.7 0 0 0-.34-1.88L4.2 7l2.83-2.83.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 10 3.05V3h4v.05a1.7 1.7 0 0 0 1.03 1.52 1.7 1.7 0 0 0 1.88-.34l.06-.06L19.8 7l-.06.06a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z"/></svg></button><button class="header-icon-button print-button" id="print-report" aria-label="Preuzmi PDF" title="Preuzmi PDF"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14"/></svg></button><button class="header-icon-button add" id="new-project" aria-label="Dodaj projekat" title="Dodaj projekat"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button></div>
    </header>
    <main class="page-shell">
      <section class="kpi-grid" id="kpis"></section>
      <section class="overview-row"><section class="attention-strip" id="attention-strip"></section><button type="button" class="display-button" id="open-display" aria-expanded="false">Prikaz</button></section>
      <section class="view-panel" id="view-panel" hidden><div><span class="control-label">Pregled tabele</span><div class="segmented view-segments">${Object.entries(viewOptions).map(([value,option])=>`<button type="button" data-view-mode="${value}" class="${viewMode===value?"active":""}">${option.label}</button>`).join("")}</div></div><div><span class="control-label">Grupisanje</span><div class="segmented"><button type="button" data-group-mode="category" class="${groupMode==="category"?"active":""}">Kategorije</button><button type="button" data-group-mode="department" class="${groupMode==="department"?"active":""}">Sektori</button><button type="button" data-group-mode="all" class="${groupMode==="all"?"active":""}">Svi zajedno</button></div></div></section>
      <section class="toolbar" aria-label="Pretraga i organizacija projekata">
        <label class="search-field"><span>⌕</span><input id="search" type="search" placeholder="Pretraži projekte, vlasnika, sektor…" /></label>
        <button class="toolbar-button" id="open-filters" aria-expanded="false">Filteri <span id="filter-count">0</span></button>
      </section>
      <section class="filter-panel" id="filter-panel" hidden><div><label>Stanje<select id="health-filter"><option value="">Sva stanja</option>${Object.entries(displayHealthLabels).map(([v,l])=>`<option value="${v}">${l}</option>`).join("")}</select></label><label>Prioritet<select id="priority-filter"><option value="">Svi prioriteti</option>${Object.entries(labels.priority).map(([v,l])=>`<option value="${v}">${l}</option>`).join("")}</select></label><label>Sektor<select id="department-filter"><option value="">Svi sektori</option></select></label><label>Sortiranje<div class="sort-controls"><select id="sort-key" aria-label="Sortiraj po">${Object.entries(sortLabels).map(([value,label])=>`<option value="${value}">${label}</option>`).join("")}</select><button class="icon-button" id="sort-direction" title="Promeni smer" aria-label="Promeni smer sortiranja">A→Z</button></div></label></div><button class="text-button" id="clear-filters" type="button">Poništi filtere</button></section>
      <section id="portfolio"></section>
    </main>
    <div class="drawer-scrim" id="drawer-scrim"></div><aside class="drawer" id="drawer" aria-label="Detalj projekta"></aside>
    <dialog id="create-dialog" class="modal"><form method="dialog" id="create-form"><div class="modal-head"><div><p class="eyebrow">Novi zapis</p><h2>Kreiraj projekat</h2></div><button type="button" class="close-button" data-close-dialog="create-dialog" aria-label="Zatvori">×</button></div><div class="form-grid"><label class="field span-2"><span>Naziv projekta *</span><input name="name" required minlength="2" autofocus /></label><label class="field"><span>Kategorija *</span><select name="category" required>${categoryOrder.map(c=>`<option value="${c}">${labels.category[c]}</option>`).join("")}</select></label><label class="field"><span>Vlasnik *</span><input name="owner" required /></label><label class="field span-2"><span>Vodeći sektor</span><select name="leadDepartment" id="create-department">${departmentOptions()}</select></label><label class="check-field span-3"><input type="checkbox" name="isDemo" /><span><b>Probni podatak</b><small>Projekat se može potpuno izuzeti iz prikaza i statistike.</small></span></label></div><div class="modal-actions"><button type="button" class="button ghost" data-close-dialog="create-dialog">Otkaži</button><button type="submit" value="default" class="button primary">Kreiraj projekat</button></div></form></dialog>
    <dialog id="settings-dialog" class="modal settings-modal"><form method="dialog" id="settings-form"><div class="modal-head"><div><p class="eyebrow">Administracija portfolija</p><h2>Podešavanja</h2></div><button type="button" class="close-button" data-close-settings aria-label="Zatvori">×</button></div>
      <nav class="settings-tabs" aria-label="Grupe podešavanja"><button type="button" class="active" data-settings-tab="general">Opšte</button><button type="button" data-settings-tab="views">Editor pregleda</button><button type="button" data-settings-tab="departments">Sektori</button><button type="button" data-settings-tab="reporting">Izveštavanje</button></nav>
      <section class="settings-pane" data-settings-pane="general"><div class="settings-intro"><strong>Opšte postavke</strong><p>Naslov, podnaslov i grafika u plavom zaglavlju, plus početni prikaz za nove korisnike.</p></div><div class="form-grid"><label class="field span-2"><span>Naslov *</span><input name="title" required minlength="2" maxlength="160" /></label><label class="field"><span>Podnaslov</span><input name="tagline" maxlength="160" /></label><div class="graphic-setting span-3"><div id="graphic-preview" class="graphic-preview"></div><div><label class="button ghost upload-button">Izaberi grafiku<input type="file" id="header-graphic-input" accept="image/png,image/jpeg,image/webp" /></label><button type="button" class="button ghost" id="remove-header-graphic">Ukloni</button><small>PNG, JPG ili WebP, do 500 KB. Prikazuje se levo od naslova.</small></div></div><label class="field"><span>Početni pregled</span><select name="defaultView">${Object.entries(viewOptions).map(([value,option])=>`<option value="${value}">${option.label}</option>`).join("")}</select></label><label class="field"><span>Početno grupisanje</span><select name="defaultGroup"><option value="category">Po kategorijama</option><option value="department">Po sektorima</option><option value="all">Svi projekti zajedno</option></select></label><label class="field"><span>Početno sortiranje</span><select name="defaultSortKey">${Object.entries(sortLabels).map(([value,label])=>`<option value="${value}">${label}</option>`).join("")}</select></label><label class="field"><span>Smer sortiranja</span><select name="defaultSortDirection"><option value="asc">Rastuće</option><option value="desc">Opadajuće</option></select></label></div></section>
      <section class="settings-pane" data-settings-pane="views" hidden><div class="settings-intro"><strong>Editor pregleda</strong><p>Odaberi pregled, uključi kolone i prevuci ih u željeni redosled. Osnovni pregledi se ne mogu obrisati.</p></div><div class="view-editor-head"><label class="field"><span>Pregled</span><select id="edited-view">${Object.entries(viewOptions).map(([value,option])=>`<option value="${value}">${option.label}</option>`).join("")}</select></label><button type="button" class="button primary small" data-add-view>+ Dodaj pregled</button><button type="button" class="button danger small" data-delete-view>Obriši pregled</button><p id="edited-view-description"></p></div><div class="column-editor" id="column-editor"></div></section>
      <section class="settings-pane" data-settings-pane="departments" hidden><div class="settings-intro"><strong>Dostupni sektori</strong><p>Svaki sektor ima jedinstvenu šifru. Brisanjem sektora povezani projekti ostaju bez vodećeg sektora.</p></div><div class="department-add"><input id="new-department-code" maxlength="16" placeholder="Šifra, npr. FIN" /><input id="new-department-name" maxlength="120" placeholder="Naziv novog sektora" /><button class="button primary" id="add-department" type="button">+ Dodaj sektor</button></div><div class="department-settings-list" id="department-settings-list"></div></section>
      <section class="settings-pane" data-settings-pane="reporting" hidden><div class="settings-intro"><strong>Izveštavanje</strong><p>Podrazumevani PDF može pratiti trenutni ekran ili koristiti unapred definisan nivo detalja. Status stariji od sedam dana automatski se označava kao zastareo.</p></div><div class="form-grid"><label class="field"><span>PDF pregled</span><select name="pdfView"><option value="current">Kao trenutni prikaz</option>${Object.entries(viewOptions).map(([value,option])=>`<option value="${value}">${option.label}</option>`).join("")}</select></label><label class="field"><span>PDF grupisanje</span><select name="pdfGroup"><option value="current">Kao trenutni prikaz</option><option value="category">Po kategorijama</option><option value="department">Po sektorima</option><option value="all">Svi projekti zajedno</option></select></label><label class="check-field span-3"><input type="checkbox" name="pdfIncludeInactive" /><span><b>Uključi završene i otkazane projekte u PDF</b><small>Ako nije označeno, PDF sadrži samo aktivne projekte.</small></span></label></div></section>
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
const completeAllFieldsOrder=(columns?:ColumnKey[]):ColumnKey[]=>{
  const available=viewOptions.detailed!.columns;
  const configured=(columns??[]).filter((column,index,list)=>available.includes(column)&&list.indexOf(column)===index);
  return [...configured,...available.filter(column=>!configured.includes(column))];
};
const activeColumns=():ColumnKey[]=>viewMode==="detailed"?completeAllFieldsOrder(portfolioSettings.viewColumns.detailed):portfolioSettings.viewColumns[viewMode]??allViewOptions()[viewMode]?.columns??["name"];

function renderKpis() {
  const active = portfolioProjects().filter(p=>!["completed","cancelled"].includes(p.lifecycleStatus));
  const kpis = [
    ["Aktivni projekti",active.length,"neutral"],
    ["Po planu",active.filter(p=>displayHealth(p)==="green").length,"green"],
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
  const panel=document.querySelector<HTMLElement>("#view-panel"),button=document.querySelector<HTMLButtonElement>("#open-display");
  if(panel)panel.hidden=!viewPanelOpen;
  if(button){button.setAttribute("aria-expanded",String(viewPanelOpen));button.textContent=`Prikaz · ${options[viewMode]?.label??viewMode}`;}
}

function activeFilterCount(){return [filters.health,filters.priority,filters.department].filter(Boolean).length;}
function renderFilterState(){
  const panel=document.querySelector<HTMLElement>("#filter-panel"),button=document.querySelector<HTMLButtonElement>("#open-filters"),count=document.querySelector<HTMLElement>("#filter-count"),demo=document.querySelector<HTMLButtonElement>("#demo-toggle");
  if(panel)panel.hidden=!filterPanelOpen;if(button)button.setAttribute("aria-expanded",String(filterPanelOpen));if(count)count.textContent=String(activeFilterCount());
  if(demo){demo.classList.toggle("active",showDemo);demo.setAttribute("aria-pressed",String(showDemo));demo.title=showDemo?"Probni projekti su uključeni":"Probni projekti su potpuno izuzeti";}
}

function filteredProjects() {
  const query = filters.search.toLocaleLowerCase("sr");
  const filtered = portfolioProjects().filter(p => {
    const haystack = `${p.id} ${p.projectCode} ${p.projectNumber} ${p.name} ${p.roles.map(role=>role.name).join(" ")} ${p.leadDepartment??""} ${p.description??""} ${p.objective??""} ${p.outcome??""}`.toLocaleLowerCase("sr");
    return (!query||haystack.includes(query)) && (!filters.health||displayHealth(p)===filters.health) && (!filters.priority||p.finalPriority===filters.priority) && (!filters.department||p.leadDepartment===filters.department) && (!filters.attention||needsAttention(p));
  });
  const factor = sortDirection==="asc"?1:-1;
  return filtered.sort((a,b)=>{
    if(sortKey==="id") return a.projectCode.localeCompare(b.projectCode,"sr",{numeric:true})*factor;
    if(sortKey==="finalPriority") return (priorityRank[a.finalPriority]-priorityRank[b.finalPriority])*factor;
    if(sortKey==="health") return (healthRank[displayHealth(a)]-healthRank[displayHealth(b)])*factor;
    if(sortKey==="trend") return (trendRank[a.trend]-trendRank[b.trend])*factor;
    if(["projectNumber","progress","valueScore","urgencyScore","consequenceScore"].includes(sortKey)) return (Number((a as unknown as Record<string,unknown>)[sortKey]??-1)-Number((b as unknown as Record<string,unknown>)[sortKey]??-1))*factor;
    if(sortKey==="blockerState") return ((a.blockerState==="blocked"?1:0)-(b.blockerState==="blocked"?1:0))*factor;
    if(sortKey==="lastUpdatedAt")return a.lastUpdatedAt.localeCompare(b.lastUpdatedAt,"sr")*factor;
    if(sortKey==="owner"||sortKey==="sponsor"||sortKey==="coordinator"||sortKey==="deliveryLead"){
      const role=sortKey==="deliveryLead"?"executor":sortKey;
      return roleText(a,role,"").localeCompare(roleText(b,role,""),"sr",{numeric:true})*factor;
    }
    const av=String((a as unknown as Record<string,unknown>)[sortKey]??""),bv=String((b as unknown as Record<string,unknown>)[sortKey]??""); return av.localeCompare(bv,"sr",{numeric:true})*factor;
  });
}

function sortHeader(key:SortKey,label:string,column:string=key) {
  const active=sortKey===key;
  const indicator=active?(sortDirection==="asc"?"↑":"↓"):"↕";
  const ariaSort=active?(sortDirection==="asc"?"ascending":"descending"):"none";
  return `<th data-column="${column}" aria-sort="${ariaSort}"><button class="sort-header ${active?"active":""}" data-sort-column="${key}"><span class="sort-label">${label}</span><span class="sort-indicator" aria-hidden="true">${indicator}</span></button></th>`;
}

const columnSortKey:Record<ColumnKey,SortKey>={name:"name",id:"id",projectNumber:"projectNumber",category:"category",lifecycleStatus:"lifecycleStatus",health:"health",trend:"trend",owner:"owner",sponsor:"sponsor",coordinator:"coordinator",deliveryLead:"deliveryLead",department:"leadDepartment",description:"description",objective:"objective",outcome:"outcome",valueScore:"valueScore",urgencyScore:"urgencyScore",consequenceScore:"consequenceScore",finalPriority:"finalPriority",progress:"progress",plannedStart:"plannedStart",actualStart:"actualStart",baselineFinish:"baselineFinish",forecastFinish:"forecastFinish",mandatoryDeadline:"mandatoryDeadline",nextMilestone:"nextMilestone",nextMilestoneDate:"nextMilestoneDate",blockerState:"blockerState",blocker:"topBlocker",decisionRequired:"decisionRequired",decisionText:"decisionText",decisionDueDate:"decisionDueDate",managementAttention:"managementAttention",isDemo:"isDemo",lastUpdatedAt:"lastUpdatedAt"};

const yesNo=(value:boolean)=>value?"Da":"Ne";
const scoreText=(value:number,urgency=false)=>urgency&&value===5?"Rok probijen":["Nema","Nisko","Srednje","Visoko","Veoma visoko"][value]??String(value);
const longTextCell=(column:ColumnKey,value:string|null,fallback="Nije definisano")=>`<td data-column="${column}"><span class="long-text-cell" title="${esc(value??fallback)}">${esc(value??fallback)}</span></td>`;

function projectCell(column:ColumnKey,p:ProjectSummary) {
  if(column==="name")return `<td data-column="name"><div class="project-name"><span class="project-number">${String(p.projectNumber).padStart(3,"0")}</span><div><strong>${esc(p.name)}</strong><small>${labels.lifecycle[p.lifecycleStatus]} · ${esc(statusUpdateLabel(p.lastStatusAt))}${p.isDemo?" · probni podatak":""}</small></div></div></td>`;
  if(column==="id")return `<td data-column="id"><code class="full-id">${esc(p.projectCode)}</code></td>`;
  if(column==="projectNumber")return `<td data-column="projectNumber"><strong class="cell-primary">${String(p.projectNumber).padStart(3,"0")}</strong></td>`;
  if(column==="category")return `<td data-column="category"><span class="category-label table-category ${p.category}">${labels.category[p.category]}</span></td>`;
  if(column==="lifecycleStatus")return `<td data-column="lifecycleStatus"><span class="lifecycle-pill ${p.lifecycleStatus}">${labels.lifecycle[p.lifecycleStatus]}</span></td>`;
  if(column==="health"){const health=displayHealth(p);return `<td data-column="health"><span class="health-badge ${health}"><i></i>${displayHealthLabels[health]}</span></td>`;}
  if(column==="trend")return `<td data-column="trend"><span class="trend ${p.trend}">${p.trend==="improving"?"↗":p.trend==="declining"?"↘":"→"} ${labels.trend[p.trend]}</span></td>`;
  if(column==="owner")return `<td data-column="owner"><strong class="cell-primary">${esc(roleText(p,"owner"))}</strong></td>`;
  if(column==="sponsor")return `<td data-column="sponsor"><strong class="cell-primary">${esc(roleText(p,"sponsor"))}</strong></td>`;
  if(column==="coordinator")return `<td data-column="coordinator"><strong class="cell-primary">${esc(roleText(p,"coordinator"))}</strong></td>`;
  if(column==="deliveryLead")return `<td data-column="deliveryLead"><strong class="cell-primary">${esc(roleText(p,"executor"))}</strong></td>`;
  if(column==="department")return `<td data-column="department"><strong class="cell-primary">${esc(p.leadDepartment??"Bez sektora")}</strong></td>`;
  if(column==="description")return longTextCell(column,p.description);
  if(column==="objective")return longTextCell(column,p.objective);
  if(column==="outcome")return longTextCell(column,p.outcome);
  if(column==="valueScore")return `<td data-column="valueScore"><strong class="cell-primary">${scoreText(p.valueScore)}</strong></td>`;
  if(column==="urgencyScore")return `<td data-column="urgencyScore"><strong class="cell-primary">${scoreText(p.urgencyScore,true)}</strong></td>`;
  if(column==="consequenceScore")return `<td data-column="consequenceScore"><strong class="cell-primary">${scoreText(p.consequenceScore)}</strong></td>`;
  if(column==="finalPriority")return `<td data-column="finalPriority"><span class="priority-badge ${p.finalPriority}">${labels.priority[p.finalPriority]}</span></td>`;
  if(column==="progress")return `<td data-column="progress"><div class="progress-cell"><div><span style="width:${p.progress??0}%"></span></div><b>${p.progress===null?"—":`${Math.round(p.progress)}%`}</b></div></td>`;
  if(column==="plannedStart")return `<td data-column="plannedStart"><strong class="cell-primary">${formatDate(p.plannedStart)}</strong></td>`;
  if(column==="actualStart")return `<td data-column="actualStart"><strong class="cell-primary">${formatDate(p.actualStart)}</strong></td>`;
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
  return `<td data-column="lastUpdatedAt"><button type="button" class="status-history-trigger table-update-trigger" data-status-history="${p.id}" data-tooltip="Istorija statusnih preseka"><strong class="cell-primary">${statusUpdateLabel(p.lastUpdatedAt)}</strong><small class="cell-secondary">${new Intl.DateTimeFormat("sr-Latn-RS",{dateStyle:"medium",timeStyle:"short"}).format(new Date(p.lastUpdatedAt))}</small></button></td>`;
}

function projectRow(p: ProjectSummary,columns:ColumnKey[],expanded:boolean) {
  const inactive = ["completed","cancelled"].includes(p.lifecycleStatus);
  const decisionOverdue = p.decisionRequired && (daysFromNow(p.decisionDueDate)??1)<0;
  return `<tr class="project-row ${expanded?"expanded":""} ${p.managementAttention||p.decisionRequired?"attention-row":""} ${decisionOverdue?"decision-overdue":""} ${inactive?"inactive":""}" data-project-id="${p.id}" tabindex="0" aria-expanded="${expanded}" aria-controls="project-detail-${p.id}">
    <td class="project-row-action"><button type="button" class="project-detail-toggle" data-toggle-project-detail="${p.id}" data-tooltip="${expanded?"Zatvori detalje":"Prikaži detalje"}" aria-expanded="${expanded}" aria-controls="project-detail-${p.id}" aria-label="${expanded?"Zatvori":"Prikaži"} detalje projekta ${esc(p.name)}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 6 6-6 6"/></svg></button></td>
    ${columns.map(column=>projectCell(column,p)).join("")}
  </tr>`;
}

function projectCardField(column:ColumnKey,p:ProjectSummary){
  const inner=column==="nextMilestoneDate"
    ? `<strong class="cell-primary">${formatDate(p.nextMilestoneDate)}</strong>`
    : projectCell(column,p).replace(/^<td[^>]*>/,"").replace(/<\/td>$/,"");
  const role=roleForColumn[column],label=role?roleLabel(role,projectRoles(p,role).length):columnLabels[column];
  return `<div class="project-card-field" data-card-column="${column}"><span>${label}</span><div>${inner}</div></div>`;
}

const cardSections:{id:string;title:string;columns:ColumnKey[]}[]=[
  {id:"deadlines",title:"Rokovi",columns:["plannedStart","actualStart","baselineFinish","forecastFinish","mandatoryDeadline"]},
  {id:"health",title:"Status i zdravlje projekta",columns:["lifecycleStatus","health","trend","progress"]},
  {id:"description",title:"Opis projekta",columns:["category","description","objective","outcome"]},
  {id:"priority",title:"Vrednost i hitnost",columns:["finalPriority","valueScore","urgencyScore","consequenceScore"]},
  {id:"responsibility",title:"Lanac odgovornosti",columns:["department","owner","coordinator","deliveryLead","sponsor"]},
  {id:"milestones",title:"Faze i ključne tačke",columns:["nextMilestone","nextMilestoneDate"]},
  {id:"blockers",title:"Blokade i odluke",columns:["blockerState","blocker","decisionRequired","managementAttention","decisionText","decisionDueDate"]}
];

function projectCard(p:ProjectSummary,columns:ColumnKey[],relativeNumber:number){
  const inactive=["completed","cancelled"].includes(p.lifecycleStatus),decisionOverdue=p.decisionRequired&&(daysFromNow(p.decisionDueDate)??1)<0;
  const health=displayHealth(p);
  const availableColumns=columns.filter(column=>{
    const role=roleForColumn[column];
    return !role||role==="owner"||projectRoles(p,role).length>0;
  });
  const available=new Set(availableColumns);
  const updatedAt=new Intl.DateTimeFormat("sr-Latn-RS",{dateStyle:"medium",timeStyle:"short"}).format(new Date(p.lastUpdatedAt));
  const signals=[p.blockerState==="blocked"||p.topBlocker?`<div class="card-signal blocker"><b>Prepreka</b><span>${esc(p.topBlocker??"Projekat je blokiran; razlog nije upisan.")}</span></div>`:"",p.decisionRequired?`<div class="card-signal decision ${decisionOverdue?"overdue":""}"><b>Potrebna odluka${p.decisionDueDate?` · ${formatDate(p.decisionDueDate)}`:""}</b><span>${esc(p.decisionText??"Tekst odluke nije upisan.")}</span></div>`:""] .filter(Boolean).join("");
  const sections=cardSections.map(section=>{
    const sectionColumns=section.columns.filter(column=>available.has(column));
    return sectionColumns.length?`<section class="project-card-section" data-card-section="${section.id}"><h3>${section.title}</h3><div class="project-card-grid">${sectionColumns.map(column=>projectCardField(column,p)).join("")}</div></section>`:"";
  }).filter(Boolean).join("");
  return `<article class="project-card expanded-project-card ${p.managementAttention||p.decisionRequired?"attention-card":""} ${decisionOverdue?"decision-overdue":""} ${inactive?"inactive":""}">
    <header class="project-card-head">
      <div class="project-card-reference"><span class="card-relative-number" aria-label="Redni broj u pregledu">${String(relativeNumber).padStart(2,"0")}</span><button type="button" class="card-project-id status-history-trigger" data-status-history="${p.id}" data-tooltip="Istorija statusnih izmena">${esc(p.projectCode)}</button></div>
      <div class="project-card-title"><strong>${esc(p.name)}</strong><small>${labels.lifecycle[p.lifecycleStatus]} · ${labels.category[p.category]}${p.isDemo?" · probni podatak":""}</small></div>
      <div class="project-card-state"><span class="health-badge ${health}"><i></i>${displayHealthLabels[health]}</span><time datetime="${p.lastUpdatedAt}" title="${esc(updatedAt)}"><span>Poslednje ažuriranje</span><b>${esc(updatedAt)}</b></time><button type="button" class="button small ghost" data-open-project-editor="${p.id}">Izmeni projekat</button></div>
    </header>
    ${signals?`<div class="card-signals">${signals}</div>`:""}
    <div class="project-card-sections">${sections}</div>
  </article>`;
}

function renderPortfolio() {
  const list = filteredProjects();
  const source=portfolioProjects(),configuredColumns=activeColumns();
  const columns=configuredColumns.filter(column=>{
    const role=roleForColumn[column];
    return !role||role==="owner"||list.some(project=>projectRoles(project,role).length>0);
  });
  const detailColumns=completeAllFieldsOrder(portfolioSettings.viewColumns.detailed);
  const departmentNames=[...new Set(source.map(project=>project.leadDepartment).filter((name):name is string=>Boolean(name)))].sort((a,b)=>a.localeCompare(b,"sr"));
  const departmentGroups=[
    ...departmentNames.map((department,index)=>({key:`department-${index}`,label:department,group:list.filter(p=>p.leadDepartment===department),all:source.filter(p=>p.leadDepartment===department)})),
    ...(source.some(project=>!project.leadDepartment)?[{key:"department-none",label:"Bez sektora",group:list.filter(p=>!p.leadDepartment),all:source.filter(p=>!p.leadDepartment)}]:[])
  ];
  const groups = groupMode==="all"
    ? [{key:"all",label:"Svi projekti",group:list,all:source}]
    : groupMode==="department"
      ? departmentGroups
      : categoryOrder.map(category=>({key:category,label:labels.category[category],group:list.filter(p=>p.category===category),all:source.filter(p=>p.category===category)}));
  let continuousProjectNumber=0;
  document.querySelector("#portfolio")!.innerHTML = groups.map(({key,label,group,all})=>{
    const renderHeaders=columns.map(column=>{
      const role=roleForColumn[column],count=role?Math.max(0,...group.map(project=>projectRoles(project,role).length)):0;
      return sortHeader(columnSortKey[column],role?roleLabel(role,count):columnLabels[column],column);
    }).join("");
    const rows=group.map((project,index)=>{
      const relativeNumber=groupMode==="department"?index+1:++continuousProjectNumber;
      const expanded=expandedProjectId===project.id;
      return `${projectRow(project,columns,expanded)}${expanded?`<tr class="project-detail-row" id="project-detail-${project.id}"><td colspan="${Math.max(1,columns.length+1)}"><div class="project-detail-shell">${projectCard(project,detailColumns,relativeNumber)}</div></td></tr>`:""}`;
    }).join("");
    const content=`<div class="table-wrap"><table class="project-table" style="--column-count:${columns.length}"><thead><tr><th class="project-row-action-head" aria-label="Detalji projekta"></th>${renderHeaders}</tr></thead><tbody>${group.length?rows:`<tr><td colspan="${Math.max(1,columns.length+1)}" class="empty-state">Nema projekata koji odgovaraju filterima.</td></tr>`}</tbody></table></div>`;
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
  drawer.innerHTML=`<header class="drawer-head"><div><span class="category-label ${p.category}">${labels.category[p.category]}</span><h2><span>${esc(p.projectCode)}</span>${esc(p.name)}</h2><p>${esc(roleText(p,"owner"))} · ${esc(p.leadDepartment??"Bez vodećeg sektora")}</p></div><button class="close-button" id="close-drawer" aria-label="Zatvori">×</button></header>
    <nav class="drawer-tabs"><button data-drawer-view="overview" class="${view==="overview"?"active":""}">Osnovno</button><button data-drawer-view="status" class="${view==="status"?"active":""}">Novi status</button><button data-drawer-view="audit" class="${view==="audit"?"active":""}">Istorija izmena</button></nav>
    <div class="drawer-body">${view==="overview"?overviewForm(p):view==="status"?statusForm(p):`<section class="editor-section" id="audit-view"><p>Učitavam istoriju…</p></section>`}</div>`;
  drawer.querySelector<HTMLFormElement>("#project-form")?.addEventListener("submit",saveProject);
  drawer.querySelector<HTMLFormElement>("#status-form")?.addEventListener("submit",saveStatus);
  if(view==="audit")void loadAuditView(p.id);
}

async function loadAuditView(id:string){const container=document.querySelector<HTMLElement>("#audit-view");if(!container)return;try{const events=await api.auditHistory(id);container.innerHTML=events.length?`<div class="status-timeline">${events.map(event=>auditEventCard(event)).join("")}</div>`:"<p>Još nema evidentiranih izmena.</p>";}catch(error){container.innerHTML=`<p>${esc(error instanceof Error?error.message:"Istorija nije dostupna")}</p>`;}}
function auditEventCard(event:AuditEvent){const changes=Object.entries(event.changedFields??{});return `<article class="status-timeline-item"><time>${esc(historyDate(event.occurredAt))}<br>${esc(event.actorName)}</time><div><strong>${esc(event.summary??event.action)}</strong>${changes.length?`<div class="status-change-list">${changes.map(([field,change])=>`<div><b>${esc(field==="roles"?"Projektne uloge":columnLabels[field as ColumnKey]??field)}</b><span class="change-before">${esc(historyValue(field as keyof StatusReportHistoryItem,change.before))}</span><span aria-hidden="true">→</span><span class="change-after">${esc(historyValue(field as keyof StatusReportHistoryItem,change.after))}</span></div>`).join("")}</div>`:""}</div></article>`;}

function roleChip(assignment:Pick<ProjectRoleAssignment,"name"|"role"|"isPrimary">){
  return `<span class="person-chip ${assignment.isPrimary?"primary":""}" data-role-chip data-role="${assignment.role}" data-name="${esc(assignment.name)}" data-primary="${assignment.isPrimary}">
    <span>${esc(assignment.name)}</span><button type="button" data-primary-person title="Postavi kao glavnu osobu" aria-label="Postavi ${esc(assignment.name)} kao glavnu osobu">★</button><button type="button" data-remove-person aria-label="Ukloni ${esc(assignment.name)}">×</button>
  </span>`;
}
function roleEditor(role:ProjectRole,assignments:ProjectRoleAssignment[]){
  const hint=role==="owner"?"Najmanje jedan vlasnik je obavezan.":role==="coordinator"||role==="executor"?"Ako nije navedeno, podrazumevaju se vlasnici i uloga se ne ponavlja u pregledu.":"Opciono.";
  return `<div class="role-field span-3" data-role-editor="${role}"><div class="role-field-head"><span>${roleMeta[role].plural}${role==="owner"?" *":""}</span><small>${hint}</small></div><div class="person-chip-list">${assignments.map(roleChip).join("")}<input data-person-entry="${role}" maxlength="120" placeholder="Dodaj osobu; Enter ili zarez" /></div></div>`;
}
function collectProjectRoles(form:HTMLFormElement):ProjectRoleInput[]{
  return Array.from(form.querySelectorAll<HTMLElement>("[data-role-chip]")).map(chip=>({
    name:chip.dataset.name!,
    role:chip.dataset.role as ProjectRole,
    isPrimary:chip.dataset.primary==="true"
  }));
}

function overviewForm(p:ProjectDetail) { return `<form id="project-form"><section class="editor-section"><div class="section-title"><div><p class="eyebrow">Zapis projekta</p><h3>Osnovni podaci</h3></div><span class="lifecycle-pill ${p.lifecycleStatus}">${labels.lifecycle[p.lifecycleStatus]}</span></div><div class="form-grid">
  <label class="field span-2"><span>Naziv</span><input name="name" value="${esc(p.name)}" required /></label><label class="field"><span>Kategorija</span><select name="category">${categoryOrder.map(v=>`<option value="${v}" ${p.category===v?"selected":""}>${labels.category[v]}</option>`).join("")}</select></label>
  <label class="field"><span>Životni ciklus</span>${p.lifecycleStatus==="blocked"?`<input type="hidden" name="lifecycleStatus" value="blocked" /><select disabled><option>Blokiran · automatski</option></select>`:`<select name="lifecycleStatus">${Object.entries(labels.lifecycle).filter(([v])=>v!=="blocked").map(([v,l])=>`<option value="${v}" ${p.lifecycleStatus===v?"selected":""}>${l}</option>`).join("")}</select>`}</label><label class="field span-2"><span>Vodeći sektor</span><select name="leadDepartmentId">${departmentOptions(p.leadDepartmentId)}</select></label>
  ${roleEditor("sponsor",projectRoles(p,"sponsor"))}${roleEditor("owner",projectRoles(p,"owner"))}${roleEditor("coordinator",projectRoles(p,"coordinator"))}${roleEditor("executor",projectRoles(p,"executor"))}
  <label class="check-field span-3"><input type="checkbox" name="isDemo" ${p.isDemo?"checked":""}/><span><b>Probni podatak</b><small>1 = probni projekat; 0 = stvarni projekat. Probni projekti mogu biti potpuno isključeni iz prikaza i statistike.</small></span></label>
  <label class="field span-3"><span>Opis</span><textarea name="description">${esc(p.description)}</textarea></label><label class="field span-3"><span>Cilj</span><textarea name="objective">${esc(p.objective)}</textarea></label><label class="field span-3"><span>Krajnji ishod</span><textarea name="outcome">${esc(p.outcome)}</textarea></label></div></section>
  <section class="editor-section"><div class="section-title"><div><p class="eyebrow">Planiranje</p><h3>Datumi i prioritet</h3></div></div><div class="form-grid">
  <label class="field"><span>Planirani početak</span>${localDateInput("plannedStart",p.plannedStart)}<small class="field-hint">Prvobitno planirani datum ostaje sačuvan i kada projekat počne.</small></label><label class="field"><span>Stvarni početak</span>${localDateInput("actualStart",p.actualStart)}<small class="field-hint">Unosi se kada rad stvarno počne; može biti naknadno korigovan.</small></label>
  <label class="field"><span>Prvobitni rok</span>${localDateInput("baselineFinish",p.baselineFinish)}</label><label class="field"><span>Obavezni krajnji rok</span>${localDateInput("mandatoryDeadline",p.mandatoryDeadline)}</label>
  ${scoreField("valueScore","Vrednost",p.valueScore,false)}${scoreField("urgencyScore","Hitnost",p.urgencyScore,true)}${scoreField("consequenceScore","Posledica neizvršenja",p.consequenceScore,false)}
  <label class="field span-2"><span>Prioritet</span><select name="finalPriority">${Object.entries(labels.priority).map(([v,l])=>`<option value="${v}" ${p.finalPriority===v?"selected":""}>${l}</option>`).join("")}</select><small class="field-hint">Na osnovu vrednosti, hitnosti i posledice sistem predlaže: ${labels.priority[p.suggestedPriority]}.</small></label></div></section><div class="sticky-actions"><button class="button danger" type="button" data-delete-project>Obriši projekat</button><button class="button primary" type="submit">Sačuvaj izmene</button></div></form>`; }

function scoreField(name:string,label:string,value:number,dynamic:boolean) { return `<label class="field"><span>${label}${dynamic?" · automatski":""}</span><select name="${name}" ${dynamic?"disabled":""}>${["Nema","Nisko","Srednje","Visoko","Veoma visoko",...(dynamic?["Rok probijen"]:[])].map((l,i)=>`<option value="${i}" ${value===i?"selected":""}>${l}</option>`).join("")}</select></label>`; }

function statusForm(p:ProjectDetail) { return `<form id="status-form"><section class="editor-section"><div class="section-title"><div><p class="eyebrow">Novi presek</p><h3>Upravljački status</h3></div><span class="updated-label">${statusUpdateLabel(p.lastStatusAt)}</span></div><div class="form-grid">
  <label class="field"><span>Stanje</span><select name="health">${Object.entries(labels.health).map(([v,l])=>`<option value="${v}" ${p.health===v?"selected":""}>${l}</option>`).join("")}</select></label><label class="field"><span>Kretanje</span><select name="trend">${Object.entries(labels.trend).map(([v,l])=>`<option value="${v}" ${p.trend===v?"selected":""}>${l}</option>`).join("")}</select></label><label class="field"><span>Napredak (%)</span><input type="number" name="progress" min="0" max="100" value="${p.progress??""}" /></label>
  <label class="field"><span>Procenjeni završetak</span>${localDateInput("forecastFinish",p.forecastFinish)}</label><label class="field"><span>Sledeća ključna tačka</span><input name="nextMilestone" value="${esc(p.nextMilestone)}" /></label><label class="field"><span>Datum ključne tačke</span>${localDateInput("nextMilestoneDate",p.nextMilestoneDate)}</label>
  <label class="field"><span>Stanje blokade</span><select name="blockerState"><option value="none" ${p.blockerState==="none"?"selected":""}>Nije blokiran</option><option value="blocked" ${p.blockerState==="blocked"?"selected":""}>Blokiran</option></select></label><label class="field span-2"><span>Glavna prepreka · opciono</span><input name="topBlocker" value="${esc(p.topBlocker)}" placeholder="Navedi samo ako je korisno i primereno" /></label>
  <label class="check-field span-3"><input type="checkbox" name="decisionRequired" ${p.decisionRequired?"checked":""}/><span><b>Potrebna odluka</b><small>Označi ako se očekuje odluka rukovodstva</small></span></label><label class="field span-2"><span>Potrebna odluka</span><textarea name="decisionText">${esc(p.decisionText)}</textarea></label><label class="field"><span>Rok odluke</span>${localDateInput("decisionDueDate",p.decisionDueDate)}</label>
  <label class="check-field span-3 rose"><input type="checkbox" name="managementAttention" ${p.managementAttention?"checked":""}/><span><b>Reakcija menadžmenta</b><small>Naglasi projekat u upravljačkom pregledu</small></span></label><label class="field span-3"><span>Kratak komentar</span><textarea name="summary" placeholder="Najvažnija poruka za ovaj period"></textarea></label>
  </div><p class="field-hint">Svako čuvanje pravi novi statusni presek i ostaje u istoriji.</p></section><div class="sticky-actions"><button class="button primary" type="submit">Sačuvaj novi status</button></div></form>`; }

function addPeopleFromEntry(input:HTMLInputElement){
  const editor=input.closest<HTMLElement>("[data-role-editor]"),role=editor?.dataset.roleEditor as ProjectRole|undefined;
  if(!editor||!role)return;
  const names=input.value.split(/[,;\n]+/).map(name=>name.trim()).filter(name=>name.length>=2);
  const existing=new Set(Array.from(editor.querySelectorAll<HTMLElement>("[data-role-chip]")).map(chip=>chip.dataset.name!.toLocaleLowerCase("sr")));
  for(const name of names){
    if(existing.has(name.toLocaleLowerCase("sr")))continue;
    const isPrimary=editor.querySelectorAll("[data-role-chip]").length===0;
    input.insertAdjacentHTML("beforebegin",roleChip({name,role,isPrimary}));
    existing.add(name.toLocaleLowerCase("sr"));
  }
  input.value="";
}
function setPrimaryPerson(chip:HTMLElement){
  const editor=chip.closest<HTMLElement>("[data-role-editor]");if(!editor)return;
  editor.querySelectorAll<HTMLElement>("[data-role-chip]").forEach(item=>{const active=item===chip;item.dataset.primary=String(active);item.classList.toggle("primary",active);});
}
function removePersonChip(chip:HTMLElement){
  const editor=chip.closest<HTMLElement>("[data-role-editor]"),role=editor?.dataset.roleEditor;
  if(!editor)return;
  const chips=Array.from(editor.querySelectorAll<HTMLElement>("[data-role-chip]"));
  if(role==="owner"&&chips.length===1){toast("Projekat mora imati najmanje jednog vlasnika.","error");return;}
  const wasPrimary=chip.dataset.primary==="true";chip.remove();
  if(wasPrimary){const next=editor.querySelector<HTMLElement>("[data-role-chip]");if(next)setPrimaryPerson(next);}
}
function handleAppKeydown(e:KeyboardEvent){
  const entry=(e.target as HTMLElement).closest<HTMLInputElement>("[data-person-entry]");
  if(entry&&(e.key==="Enter"||e.key===",")){e.preventDefault();addPeopleFromEntry(entry);return;}
  const target=e.target as HTMLElement,row=target.closest<HTMLElement>("[data-project-id]");
  if(row&&!target.closest("summary,button,a,input,select,textarea,label")&&(e.key==="Enter"||e.key===" ")){e.preventDefault();void openProject(row.dataset.projectId!);}
}

function bindEvents() {
  document.querySelector("#theme-toggle")!.addEventListener("click",toggleVisualTheme);
  document.querySelector("#logout")!.addEventListener("click",logoutCurrentUser);
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
  document.querySelector("#open-display")!.addEventListener("click",()=>{viewPanelOpen=!viewPanelOpen;renderViewControls();});
  document.querySelector("#clear-filters")!.addEventListener("click",clearFilters);
  document.querySelector("#demo-toggle")!.addEventListener("click",()=>{showDemo=!showDemo;localStorage.setItem("reportingShowDemo",String(showDemo));filters.department="";render();});
  document.querySelector("#sort-key")!.addEventListener("change",e=>{sortKey=(e.target as HTMLSelectElement).value as SortKey;renderPortfolio();});
  document.querySelector("#sort-direction")!.addEventListener("click",e=>{sortDirection=sortDirection==="asc"?"desc":"asc";(e.currentTarget as HTMLElement).textContent=sortDirection==="asc"?"A→Z":"Z→A";renderPortfolio();});
  app.addEventListener("input",e=>{const dateInput=(e.target as HTMLElement).closest<HTMLInputElement>("[data-local-date]");if(!dateInput)return;dateInput.setCustomValidity("");if(/^\d{2}\.\d{2}\.\d{4}$/.test(dateInput.value))syncPickerFromDateText(dateInput);});
  app.addEventListener("click",handleDelegatedClick);app.addEventListener("keydown",handleAppKeydown);app.addEventListener("change",e=>{const picker=(e.target as HTMLElement).closest<HTMLInputElement>("[data-date-picker]");if(picker)syncDateTextFromPicker(picker);});app.addEventListener("pointerdown",e=>{const picker=(e.target as HTMLElement).closest<HTMLInputElement>("[data-date-picker]");const input=picker?.closest<HTMLElement>(".local-date-control")?.querySelector<HTMLInputElement>("[data-local-date]");if(input)syncPickerFromDateText(input);});app.addEventListener("focusout",e=>{const target=e.target as HTMLElement,entry=target.closest<HTMLInputElement>("[data-person-entry]");if(entry&&entry.value.trim())addPeopleFromEntry(entry);const dateInput=target.closest<HTMLInputElement>("[data-local-date]");if(dateInput)syncPickerFromDateText(dateInput);});
  document.querySelector("#edited-view")!.addEventListener("change",e=>{editedView=(e.target as HTMLSelectElement).value as ViewMode;renderColumnEditor();});
  document.querySelector("#header-graphic-input")!.addEventListener("change",handleHeaderGraphic);
  document.querySelector("#remove-header-graphic")!.addEventListener("click",()=>{pendingHeaderGraphic=null;renderGraphicPreview();});
  const columnEditor=document.querySelector<HTMLElement>("#column-editor")!;
  columnEditor.addEventListener("dragstart",handleColumnDragStart);columnEditor.addEventListener("dragover",handleColumnDragOver);columnEditor.addEventListener("drop",handleColumnDrop);
  app.addEventListener("pointerover",showHoverTooltip);app.addEventListener("pointermove",moveHoverTooltip);app.addEventListener("pointerout",hideHoverTooltip);
}

function toggleVisualTheme(){
  visualTheme=nextTheme(visualTheme);
  document.body.dataset.theme=visualTheme;
  localStorage.setItem("reportingTheme",visualTheme);
  const button=document.querySelector<HTMLButtonElement>("#theme-toggle"),label=themeToggleLabel(visualTheme);
  if(button){button.setAttribute("aria-label",label);button.title=label;button.dataset.tooltip=label;}
  toast(`Tema: ${themeLabels[visualTheme]}`);
}

function handleDelegatedClick(e:MouseEvent) {
  const target=e.target as HTMLElement;
  const detailButton=target.closest<HTMLElement>("[data-toggle-project-detail]");if(detailButton){toggleProjectExpansion(detailButton.dataset.toggleProjectDetail!);return;}
  const editorButton=target.closest<HTMLElement>("[data-open-project-editor]");if(editorButton){void openProject(editorButton.dataset.openProjectEditor!);return;}
  const primaryPerson=target.closest<HTMLElement>("[data-primary-person]")?.closest<HTMLElement>("[data-role-chip]");if(primaryPerson){setPrimaryPerson(primaryPerson);return;}
  const removePerson=target.closest<HTMLElement>("[data-remove-person]")?.closest<HTMLElement>("[data-role-chip]");if(removePerson){removePersonChip(removePerson);return;}
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
  const columnToggle=target.closest<HTMLInputElement>("[data-column-toggle]");if(columnToggle){toggleViewColumn(columnToggle.dataset.columnToggle as ColumnKey,columnToggle.checked);return;}
  const moveColumn=target.closest<HTMLElement>("[data-move-column]");if(moveColumn){moveViewColumn(moveColumn.dataset.moveColumn as ColumnKey,moveColumn.dataset.direction as "up"|"down");return;}
  const sortButton=target.closest<HTMLElement>("[data-sort-column]");if(sortButton){const nextKey=sortButton.dataset.sortColumn as SortKey;if(sortKey===nextKey)sortDirection=sortDirection==="asc"?"desc":"asc";else{sortKey=nextKey;sortDirection="asc";}syncSortControls();renderPortfolio();return;} const row=target.closest<HTMLElement>("[data-project-id]"); if(row&&!target.closest("summary,button,a,input,select,textarea,label")){void openProject(row.dataset.projectId!);return;}
  if(target.closest("#close-drawer")){closeDrawer();return;} if(target.closest("[data-delete-project]")){void deleteSelectedProject();return;} const view=target.closest<HTMLElement>("[data-drawer-view]");if(view){renderDrawer(view.dataset.drawerView as "overview"|"status"|"audit");return;}
  if(target.closest("[data-show-attention]")){toggleAttention();renderAttention();return;} if(target.closest(".collapse-button")){target.closest(".portfolio-group")?.classList.toggle("collapsed");return;}
}

function closeDrawer(){document.body.classList.remove("drawer-open");selected=null;}
function toggleProjectExpansion(id:string){expandedProjectId=expandedProjectId===id?null:id;renderPortfolio();}
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
function filterSummary(){const parts:string[]=[];if(filters.search)parts.push(`Pretraga: ${filters.search}`);if(filters.health)parts.push(`Stanje: ${displayHealthLabels[filters.health as DisplayHealth]??filters.health}`);if(filters.priority)parts.push(`Prioritet: ${labels.priority[filters.priority as keyof typeof labels.priority]??filters.priority}`);if(filters.department)parts.push(`Sektor: ${filters.department}`);if(filters.attention)parts.push("Samo projekti koji zahtevaju reakciju menadžmenta");return parts.length?parts.join(" · "):"Bez dodatnih filtera";}
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
  const allFieldsView=editedView==="detailed";
  const selectedColumns=allFieldsView?completeAllFieldsOrder(workingViewColumns.detailed):workingViewColumns[editedView]??["name"];
  if(allFieldsView)workingViewColumns.detailed=[...selectedColumns];
  const ordered=[...selectedColumns,...(Object.keys(columnLabels) as ColumnKey[]).filter(column=>!selectedColumns.includes(column))];
  const options={...viewOptions,...Object.fromEntries(workingCustomViews.map(view=>[view.id,{...view,columns:workingViewColumns[view.id]??["name"]}]))},select=document.querySelector<HTMLSelectElement>("#edited-view")!;select.innerHTML=Object.entries(options).map(([id,option])=>`<option value="${id}">${esc(option.label)}</option>`).join("");select.value=editedView;
  document.querySelector<HTMLElement>("#edited-view-description")!.textContent=options[editedView]?.description??"";
  const deleteButton=document.querySelector<HTMLButtonElement>("[data-delete-view]");if(deleteButton)deleteButton.disabled=!workingCustomViews.some(view=>view.id===editedView);
  container.innerHTML=ordered.map((column,index)=>{const checked=selectedColumns.includes(column),required=allFieldsView||column==="name",positionLocked=column==="name";return `<div class="column-editor-row ${checked?"selected":""}" draggable="${checked&&!positionLocked}" data-column-item="${column}"><span class="drag-handle" aria-hidden="true">⋮⋮</span><label><input type="checkbox" data-column-toggle="${column}" ${checked?"checked":""} ${required?"disabled":""}/><strong>${columnLabels[column]}</strong></label><span class="column-state">${allFieldsView?String(index+1):positionLocked?"Obavezno":checked?String(index+1):"Isključeno"}</span><button type="button" data-move-column="${column}" data-direction="up" aria-label="Pomeri nagore" ${!checked||positionLocked||index<=1?"disabled":""}>↑</button><button type="button" data-move-column="${column}" data-direction="down" aria-label="Pomeri nadole" ${!checked||positionLocked||index===selectedColumns.length-1?"disabled":""}>↓</button></div>`;}).join("");
}
function toggleViewColumn(column:ColumnKey,checked:boolean){if(editedView==="detailed")return;const list=workingViewColumns[editedView]??(workingViewColumns[editedView]=["name"]);if(column==="name")return;if(checked&&!list.includes(column))list.push(column);if(!checked)workingViewColumns[editedView]=list.filter(item=>item!==column);renderColumnEditor();}
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
  pendingHeaderGraphic=portfolioSettings.headerGraphic;workingViewColumns=structuredClone(portfolioSettings.viewColumns);workingViewColumns.detailed=completeAllFieldsOrder(workingViewColumns.detailed);workingCustomViews=structuredClone(portfolioSettings.customViews);renderSettingsViewSelects(form);renderUserSettings();renderGraphicPreview();renderColumnEditor();renderDepartmentSettings();setSettingsTab(tab);
  dialog.showModal();
}

function renderSettingsViewSelects(form:HTMLFormElement){const options=allViewOptions(),defaultSelect=form.elements.namedItem("defaultView") as HTMLSelectElement,pdfSelect=form.elements.namedItem("pdfView") as HTMLSelectElement;defaultSelect.innerHTML=Object.entries(options).map(([id,view])=>`<option value="${id}">${esc(view.label)}</option>`).join("");pdfSelect.innerHTML=`<option value="current">Kao trenutni prikaz</option>${Object.entries(options).map(([id,view])=>`<option value="${id}">${esc(view.label)}</option>`).join("")}`;defaultSelect.value=portfolioSettings.defaultView;pdfSelect.value=portfolioSettings.pdfView;}
function renderUserSettings(){
  document.querySelector("#user-profile-setting")?.remove();
  if(!currentAuthUser?.isAdmin)return;
  const grid=document.querySelector<HTMLElement>('[data-settings-pane="general"] .form-grid')!;
  grid.insertAdjacentHTML("beforeend",`<section class="span-3 user-management" id="user-profile-setting">
    <div class="settings-intro"><strong>Korisnički nalozi</strong><p>Administrator pravi naloge. Lozinke se čuvaju isključivo kao bezbedni hash.</p></div>
    <div class="department-add"><input id="new-user-name" maxlength="40" autocomplete="off" placeholder="Korisničko ime" /><input id="new-user-password" type="password" minlength="8" maxlength="128" autocomplete="new-password" placeholder="Lozinka, najmanje 8 znakova" /><button type="button" class="button primary" data-add-user>+ Dodaj korisnika</button></div>
    <div class="user-settings-list">${users.map(user=>`<div class="user-setting-row"><strong>${esc(user.username)}</strong><span>${user.isAdmin?"Administrator":"Korisnik"}</span><small>${user.lastLoginAt?`Poslednja prijava: ${esc(historyDate(user.lastLoginAt))}`:"Još se nije prijavio"}</small></div>`).join("")}</div>
  </section>`);
}
async function addUser(){
  const usernameInput=document.querySelector<HTMLInputElement>("#new-user-name")!,passwordInput=document.querySelector<HTMLInputElement>("#new-user-password")!;
  const username=usernameInput.value.trim(),password=passwordInput.value;
  if(username.length<3||password.length<8){toast("Unesi korisničko ime i lozinku od najmanje 8 znakova","error");return;}
  try{await api.createUser(username,password);users=await api.listUsers();renderUserSettings();toast("Korisnik je dodat");}
  catch(error){toast(error instanceof Error?error.message:"Korisnik nije dodat","error");}
}

async function savePortfolioSettings(e:Event) {
  e.preventDefault();
  const form=e.currentTarget as HTMLFormElement,f=new FormData(form),button=form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  button.disabled=true;button.textContent="Čuvam…";
  try{
    portfolioSettings=await api.updateSettings({title:String(f.get("title")),tagline:String(f.get("tagline")),defaultView:String(f.get("defaultView")) as PortfolioSettings["defaultView"],defaultGroup:String(f.get("defaultGroup")) as PortfolioSettings["defaultGroup"],defaultSortKey:String(f.get("defaultSortKey")) as PortfolioSettings["defaultSortKey"],defaultSortDirection:String(f.get("defaultSortDirection")) as PortfolioSettings["defaultSortDirection"],pdfView:String(f.get("pdfView")) as PortfolioSettings["pdfView"],pdfGroup:String(f.get("pdfGroup")) as PortfolioSettings["pdfGroup"],pdfIncludeInactive:f.get("pdfIncludeInactive")==="on",headerGraphic:pendingHeaderGraphic,viewColumns:{...workingViewColumns,detailed:completeAllFieldsOrder(workingViewColumns.detailed)},customViews:workingCustomViews});
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

async function createProject(e:Event) { e.preventDefault();const form=e.currentTarget as HTMLFormElement;const data=new FormData(form);try{const project=await api.createProject({name:String(data.get("name")),category:String(data.get("category")) as ProjectCategory,roles:[{name:String(data.get("owner")),role:"owner",isPrimary:true}],leadDepartmentId:nullable(data,"leadDepartment"),isDemo:data.get("isDemo")==="on"});projects=await api.listProjects();render();document.querySelector<HTMLDialogElement>("#create-dialog")!.close();form.reset();toast("Projekat je kreiran");await openProject(project.id);}catch(error){toast(error instanceof Error?error.message:"Kreiranje nije uspelo","error");}}

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
    form.querySelectorAll<HTMLInputElement>("[data-person-entry]").forEach(entry=>{if(entry.value.trim())addPeopleFromEntry(entry);});
    const roles=collectProjectRoles(form);
    if(!roles.some(role=>role.role==="owner"))throw new Error("Projekat mora imati najmanje jednog vlasnika.");
    selected=await api.updateProject(selected.id,{name:String(f.get("name")),category:String(f.get("category")) as ProjectCategory,leadDepartmentId:nullable(f,"leadDepartmentId"),roles,lifecycleStatus:String(f.get("lifecycleStatus")) as ProjectDetail["lifecycleStatus"],description:nullable(f,"description"),objective:nullable(f,"objective"),outcome:nullable(f,"outcome"),plannedStart:dateFromForm(f,"plannedStart","Planirani početak"),actualStart:dateFromForm(f,"actualStart","Stvarni početak"),baselineFinish:dateFromForm(f,"baselineFinish","Prvobitni rok"),mandatoryDeadline:dateFromForm(f,"mandatoryDeadline","Obavezni krajnji rok"),valueScore:Number(f.get("valueScore")) as Score,urgencyScore:Number(f.get("urgencyScore")) as UrgencyScore,consequenceScore:Number(f.get("consequenceScore")) as Score,finalPriority:String(f.get("finalPriority")) as Priority,isDemo:f.get("isDemo")==="on"},selected.lastUpdatedAt);
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
    selected=await api.addStatus(selected.id,{health:String(f.get("health")) as ProjectDetail["health"],trend:String(f.get("trend")) as ProjectDetail["trend"],progress:numberOrNull(f,"progress"),forecastFinish:dateFromForm(f,"forecastFinish","Procenjeni završetak"),nextMilestone:nullable(f,"nextMilestone"),nextMilestoneDate:dateFromForm(f,"nextMilestoneDate","Datum ključne tačke"),blockerState:String(f.get("blockerState")) as ProjectDetail["blockerState"],topBlocker:nullable(f,"topBlocker"),decisionRequired,decisionText:decisionRequired?nullable(f,"decisionText"):null,decisionDueDate:decisionRequired?dateFromForm(f,"decisionDueDate","Rok odluke"):null,managementAttention:f.get("managementAttention")==="on",summary:nullable(f,"summary")});statusHistoryCache.delete(selected.id);
    projects=await api.listProjects();render();renderDrawer("status");toast("Status je sačuvan");
  }catch(error){toast(error instanceof Error?error.message:"Status nije sačuvan","error");}
  finally{button.disabled=false;button.textContent="Sačuvaj novi status";}
}

function renderAuthScreen(setupRequired:boolean,message=""){
  app.innerHTML=`<main class="auth-shell"><section class="auth-card">
    <div class="auth-mark" aria-hidden="true"></div>
    <p class="eyebrow">${setupRequired?"Početno podešavanje":"Zaštićen pristup"}</p>
    <h1>${setupRequired?"Kreiraj administratora":"Prijava"}</h1>
    <p>${setupRequired?"Ovo je jedini nalog koji se pravi bez prijave. Nakon toga administrator otvara sve ostale naloge.":"Prijavi se korisničkim imenom i lozinkom koje ti je dodelio administrator."}</p>
    ${message?`<div class="auth-error">${esc(message)}</div>`:""}
    <form id="auth-form" data-setup="${setupRequired}">
      <label class="field"><span>Korisničko ime</span><input name="username" required minlength="3" maxlength="40" autocomplete="username" autofocus /></label>
      <label class="field"><span>Lozinka</span><input name="password" type="password" required minlength="8" maxlength="128" autocomplete="${setupRequired?"new-password":"current-password"}" /></label>
      <button class="button primary" type="submit">${setupRequired?"Kreiraj administratora":"Prijavi se"}</button>
    </form>
  </section></main>`;
  document.querySelector<HTMLFormElement>("#auth-form")!.addEventListener("submit",submitAuth);
}

async function submitAuth(event:SubmitEvent){
  event.preventDefault();
  const form=event.currentTarget as HTMLFormElement,data=new FormData(form),button=form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const setup=form.dataset.setup==="true",input={username:String(data.get("username")).trim(),password:String(data.get("password"))};
  button.disabled=true;button.textContent=setup?"Kreiram…":"Prijavljujem…";
  try{currentAuthUser=setup?await api.setupAdmin(input):await api.login(input);await initApplication();}
  catch(error){renderAuthScreen(setup,error instanceof Error?error.message:"Prijava nije uspela.");}
}

async function logoutCurrentUser(){
  try{await api.logout();}finally{currentAuthUser=null;projects=[];departments=[];users=[];selected=null;renderAuthScreen(false);}
}

async function initApplication(){
  shell();bindEvents();
  try{
    const [,data,settings,departmentData,userData]=await Promise.all([
      api.health(),api.listProjects(),api.getSettings(),api.listDepartments(),currentAuthUser?.isAdmin?api.listUsers():Promise.resolve([])
    ]);
    projects=data;departments=departmentData;users=userData;
    const viewColumns=settings.viewColumns??structuredClone(defaultViewColumns);
    portfolioSettings={...settings,viewColumns:{...viewColumns,detailed:completeAllFieldsOrder(viewColumns.detailed)},headerGraphic:settings.headerGraphic??null};
    if(!savedView)viewMode=settings.defaultView as ViewMode;if(!savedGroup)groupMode=settings.defaultGroup as GroupMode;
    sortKey=settings.defaultSortKey as SortKey;sortDirection=settings.defaultSortDirection;workingViewColumns=structuredClone(portfolioSettings.viewColumns);syncSortControls();render();
  }catch(error){
    document.querySelector("#portfolio")!.innerHTML=`<div class="fatal"><strong>Aplikacija ne može da učita podatke.</strong><p>${esc(error instanceof Error?error.message:"Nepoznata greška")}</p></div>`;
  }
}

async function init(){
  try{
    const state=await api.authStatus();
    if(!state.authenticated||!state.user){renderAuthScreen(state.setupRequired);return;}
    currentAuthUser=state.user;await initApplication();
  }catch(error){renderAuthScreen(false,error instanceof Error?error.message:"Lokalni servis nije dostupan.");}
}

window.addEventListener("auth-required",()=>{currentAuthUser=null;renderAuthScreen(false,"Prijava je istekla. Prijavi se ponovo.");});
void init();
