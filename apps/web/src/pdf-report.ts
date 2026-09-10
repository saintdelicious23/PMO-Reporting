import type { PortfolioSettings, ProjectRole, ProjectSummary, StatusReportHistoryItem } from "../../../packages/contracts/src/index.ts";
import type { GroupMode } from "./view-config.ts";

export type PortfolioPdfKind = "executive"|"detail";
export type StatusHistoryByProject = Record<string,StatusReportHistoryItem[]>;

let pdfMakePromise:Promise<Awaited<ReturnType<typeof loadPdfMake>>>|null=null;
async function loadPdfMake() {
  const [pdfModule,fontModule]=await Promise.all([import("pdfmake/build/pdfmake"),import("pdfmake/build/vfs_fonts")]);
  const pdfMake=pdfModule.default;
  pdfMake.addVirtualFileSystem(fontModule.default);
  return pdfMake;
}

const categoryLabels = { strategic:"Strateški projekat",mandatory:"Regulatorna obaveza",operational_improvement:"Operativno unapređenje" } as const;
const healthLabels = { gray:"Sivo",green:"Zeleno",amber:"Žuto",red:"Crveno",critical:"Kritično" } as const;
const priorityLabels = { low:"Nizak",medium:"Srednji",high:"Visok",very_high:"Veoma visok",critical:"Kritičan" } as const;
const trendLabels = { improving:"Poboljšava se",stable:"Stabilno",declining:"Pogoršava se" } as const;
const lifecycleLabels = { planning:"Planiranje",active:"Aktivan",on_hold:"Privremeno obustavljen",blocked:"Blokiran",completed:"Završen",cancelled:"Otkazan" } as const;
const colors = { navy:"#102f40",blue:"#315d78",cream:"#f6f2ea",paper:"#fffdf9",gray:"#66757a",green:"#277650",amber:"#ae6f16",red:"#b23a43",critical:"#7d2233",rose:"#a34862",slate:"#66757a",line:"#d8d2c8",soft:"#eeebe4" };
const categoryOrder:ProjectSummary["category"][]=["strategic","mandatory","operational_improvement"];

const roleText=(project:ProjectSummary,role:ProjectRole,fallback="Nije definisano")=>{
  const assignments=project.roles.filter(assignment=>assignment.role===role).sort((a,b)=>Number(b.isPrimary)-Number(a.isPrimary)||a.position-b.position);
  return assignments.map(assignment=>`${assignment.name}${assignments.length>1&&assignment.isPrimary?" *":""}`).join(", ")||fallback;
};
const formatDate = (value:string|null) => value ? new Intl.DateTimeFormat("sr-Latn-RS",{day:"2-digit",month:"short",year:"numeric"}).format(new Date(`${value.slice(0,10)}T12:00:00`)) : "Nije određeno";
const formatTimestamp=(value:string|null)=>value?new Intl.DateTimeFormat("sr-Latn-RS",{dateStyle:"medium",timeStyle:"short"}).format(new Date(value)):"Status nije unet";
const scoreText=(value:number,urgency=false)=>urgency&&value===5?"Rok probijen":["Nema","Nisko","Srednje","Visoko","Veoma visoko"][value]??String(value);
const displayHealth=(project:ProjectSummary)=>project.lifecycleStatus==="planning"?"gray":project.health;
const healthColor=(project:ProjectSummary)=>colors[displayHealth(project)];
const statusSummary=(project:ProjectSummary)=>project.lastStatusSummary?.trim()||"Komentar poslednjeg preseka nije unet.";
const isInactive=(project:ProjectSummary)=>project.lifecycleStatus==="completed"||project.lifecycleStatus==="cancelled";
const isStale=(project:ProjectSummary)=>!project.lastStatusAt||(Date.now()-new Date(project.lastStatusAt).getTime())/86400000>7;
const needsAttention=(project:ProjectSummary)=>project.managementAttention||project.decisionRequired||project.health==="critical"||project.lifecycleStatus==="blocked";

const timestampName = (kind:PortfolioPdfKind,date:Date) => {
  const pad=(value:number)=>String(value).padStart(2,"0");
  return `portfolio-${kind==="executive"?"direktorski-pregled":"detaljni-pregled"}_${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}.pdf`;
};

function reportHeader(title:string,subtitle:string,filterSummary:string,generatedAt:Date,graphic?:string|null) {
  const titleBlock={stack:[{text:title.toUpperCase(),fontSize:8,bold:true,color:colors.blue,characterSpacing:1.2},{text:subtitle,fontSize:22,bold:true,color:colors.navy,margin:[0,3,0,0]}]};
  return {columns:[...(graphic?[{image:graphic,fit:[58,34],width:68,margin:[0,0,10,0]}]:[]),titleBlock,{stack:[{text:"GENERISANO",fontSize:7,bold:true,color:colors.slate,alignment:"right"},{text:formatTimestamp(generatedAt.toISOString()),fontSize:9,bold:true,color:colors.navy,alignment:"right",margin:[0,3,0,0]},{text:filterSummary,fontSize:7,color:colors.slate,alignment:"right",margin:[0,3,0,0]}],width:220}],margin:[0,0,0,12]};
}

function projectGroups(projects:ProjectSummary[],groupMode:GroupMode) {
  if(groupMode==="all")return [{label:"Svi projekti",projects}];
  if(groupMode==="department") {
    const names=[...new Set(projects.map(project=>project.leadDepartment).filter((name):name is string=>Boolean(name)))].sort((a,b)=>a.localeCompare(b,"sr"));
    return [...names.map(name=>({label:name,projects:projects.filter(project=>project.leadDepartment===name)})),...(projects.some(project=>!project.leadDepartment)?[{label:"Bez sektora",projects:projects.filter(project=>!project.leadDepartment)}]:[])];
  }
  return categoryOrder.map(category=>({label:categoryLabels[category],projects:projects.filter(project=>project.category===category)}));
}

function executiveProjectCell(project:ProjectSummary) {
  return {columns:[{canvas:[{type:"ellipse",x:4,y:5,r1:4,r2:4,color:healthColor(project)}],width:13},{stack:[{text:`${String(project.projectNumber).padStart(3,"0")}  ${project.name}`,bold:true,color:colors.navy},{text:`${project.projectCode}  |  ${project.leadDepartment??"Bez sektora"}`,fontSize:7,color:colors.slate,margin:[0,2,0,0]},{text:`V: ${roleText(project,"owner")}  |  I: ${roleText(project,"executor")}`,fontSize:7.2,color:colors.slate,margin:[0,3,0,0]}],width:"*"}]};
}

function executiveDefinition(projects:ProjectSummary[],groupMode:GroupMode,filterSummary:string,settings?:Pick<PortfolioSettings,"title"|"tagline"|"headerGraphic">) {
  const generatedAt=new Date();
  const active=projects.filter(project=>!isInactive(project));
  const kpis=[
    ["Aktivni",active.length,colors.navy],["Po planu",active.filter(project=>displayHealth(project)==="green").length,colors.green],
    ["U riziku",active.filter(project=>project.health==="amber").length,colors.amber],["Crveno / kritično",active.filter(project=>project.health==="red"||project.health==="critical").length,colors.red],
    ["Za reakciju",active.filter(needsAttention).length,colors.rose],["Status > 7 dana",active.filter(isStale).length,colors.slate]
  ];
  const content:unknown[]=[
    reportHeader(settings?.title??"Portfolio projekata","Direktorski pregled",filterSummary,generatedAt,settings?.headerGraphic),
    {table:{widths:kpis.map(()=>"*"),body:[kpis.map(([label])=>({text:label,fontSize:7,bold:true,color:colors.slate,fillColor:colors.cream,margin:[3,3,3,0]})),kpis.map(([,value,tone])=>({text:String(value),fontSize:18,bold:true,color:tone,fillColor:colors.paper,margin:[3,0,3,4]}))]},layout:{hLineColor:()=>colors.line,vLineColor:()=>colors.line,hLineWidth:()=>.5,vLineWidth:()=>.5},margin:[0,0,0,12]}
  ];
  const tableLayout={hLineColor:()=>colors.line,vLineColor:()=>colors.line,hLineWidth:()=>.5,vLineWidth:()=>.5,paddingLeft:()=>5,paddingRight:()=>5,paddingTop:()=>6,paddingBottom:()=>6};
  const header=["PROJEKAT / ODGOVORNOST","PRIORITET","NAPREDAK","KOMENTAR","ROK / SLEDEĆA TAČKA","PREPREKA","AŽURIRANO"].map(text=>({text,fontSize:6.7,bold:true,color:"#52636a",fillColor:colors.soft,margin:[0,2,0,2]}));
  for(const group of projectGroups(active,groupMode)) {
    if(!group.projects.length)continue;
    content.push({columns:[{text:group.label,fontSize:12,bold:true,color:colors.navy},{text:`${group.projects.length} aktivnih  |  ${group.projects.filter(needsAttention).length} za reakciju`,fontSize:7,color:colors.slate,alignment:"right"}],margin:[0,6,0,4]});
    const rows=group.projects.map(project=>[
      executiveProjectCell(project),
      {text:priorityLabels[project.finalPriority],fontSize:7.5,bold:true,color:project.finalPriority==="critical"?colors.critical:project.finalPriority==="very_high"?colors.red:colors.navy},
      {text:project.progress===null?"-":`${Math.round(project.progress)}%`,bold:true,alignment:"right"},
      {text:statusSummary(project),color:project.lastStatusSummary?colors.navy:colors.slate,italics:!project.lastStatusSummary},
      {stack:[{text:formatDate(project.forecastFinish),bold:true},{text:project.nextMilestone??"Ključna tačka nije definisana",fontSize:7.2,color:colors.slate,margin:[0,3,0,0]},{text:project.nextMilestoneDate?formatDate(project.nextMilestoneDate):"",fontSize:7,color:colors.slate}]},
      {stack:[{text:project.blockerState==="blocked"?(project.topBlocker??"Blokiran - razlog nije upisan"):"Nema potvrđene prepreke",fontSize:7.5,bold:project.blockerState==="blocked",color:project.blockerState==="blocked"?colors.red:colors.slate},{text:project.decisionRequired?`ODLUKA: ${project.decisionText??"Tekst nije unet"}`:"",fontSize:7,bold:true,color:colors.rose,margin:[0,3,0,0]}]},
      {stack:[{text:formatTimestamp(project.lastStatusAt),fontSize:7.2,bold:isStale(project),color:isStale(project)?colors.amber:colors.slate},{text:isStale(project)?"ZASTARELO":"",fontSize:6.3,bold:true,color:colors.amber,margin:[0,2,0,0]}]}
    ]);
    content.push({table:{headerRows:1,dontBreakRows:true,widths:[132,52,38,"*",100,120,60],body:[header,...rows]},layout:tableLayout,margin:[0,0,0,8]});
  }
  return {pageSize:"A4",pageOrientation:"landscape",pageMargins:[24,34,24,25],defaultStyle:{font:"Roboto",fontSize:8,color:colors.navy,lineHeight:1.16},info:{title:"Direktorski pregled portfolija",subject:"Aktivni projekti i poslednji statusni preseci",creator:"Portfolio projekata"},content,footer:(currentPage:number,pageCount:number)=>({columns:[{text:"DIREKTORSKI PREGLED",fontSize:6.5,bold:true,color:colors.slate},{text:`${currentPage} / ${pageCount}`,fontSize:7,color:colors.slate,alignment:"right"}],margin:[24,0,24,0]})};
}

const fact=(label:string,value:string,tone:string=colors.navy)=>({stack:[{text:label.toUpperCase(),fontSize:6.3,bold:true,color:colors.slate,characterSpacing:.6},{text:value,fontSize:8.5,bold:true,color:tone,margin:[0,2,0,0]}],fillColor:colors.cream,margin:[4,4,4,4]});
const textBlock=(label:string,value:string|null)=>({stack:[{text:label.toUpperCase(),fontSize:6.7,bold:true,color:colors.blue,characterSpacing:.7},{text:value?.trim()||"Nije definisano",fontSize:8.3,color:value?colors.navy:colors.slate,italics:!value,margin:[0,3,0,0],lineHeight:1.17}],margin:[0,0,0,7]});
const sectionTitle=(title:string)=>({text:title,fontSize:11.5,bold:true,color:colors.navy,margin:[0,6,0,5],decoration:"underline",decorationColor:colors.line});

function detailedProject(project:ProjectSummary,index:number,history:StatusReportHistoryItem[]=[]) {
  const statusTone=healthColor(project);
  const statusDetails:[string,string][]=[
    ["Sledeća ključna tačka",`${project.nextMilestone??"Nije definisana"}${project.nextMilestoneDate?`  |  ${formatDate(project.nextMilestoneDate)}`:""}`],
    ["Prepreka",project.blockerState==="blocked"?(project.topBlocker??"Projekat je blokiran; razlog nije upisan."):"Nema potvrđene prepreke"]
  ];
  if(project.decisionRequired)statusDetails.push(["Potrebna odluka",`${project.decisionText??"Tekst odluke nije unet"}${project.decisionDueDate?`  |  rok ${formatDate(project.decisionDueDate)}`:""}`]);
  const items:unknown[]=[
    {columns:[{stack:[{text:"DETALJNI PREGLED",fontSize:6.3,bold:true,color:colors.slate,characterSpacing:1},{text:`${String(project.projectNumber).padStart(3,"0")}  |  ${project.projectCode}`,fontSize:7.5,bold:true,color:colors.blue,characterSpacing:.7,margin:[0,4,0,0]},{text:project.name,fontSize:20,bold:true,color:colors.navy,margin:[0,3,0,0]},{text:`${categoryLabels[project.category]}  |  ${project.leadDepartment??"Bez vodećeg sektora"}  |  izmenjeno ${formatTimestamp(project.lastUpdatedAt)}${project.isDemo?"  |  PROBNI PODATAK":""}`,fontSize:7.5,color:colors.slate,margin:[0,3,0,0]}]},{stack:[{text:lifecycleLabels[project.lifecycleStatus].toUpperCase(),fontSize:6.7,bold:true,color:colors.slate,alignment:"right"},{text:healthLabels[displayHealth(project)],fontSize:14,bold:true,color:statusTone,alignment:"right",margin:[0,3,0,0]},{text:trendLabels[project.trend],fontSize:7,color:colors.slate,alignment:"right",margin:[0,2,0,0]}],width:120}],margin:[0,0,0,8],pageBreak:index?"before":undefined},
    {table:{widths:[145,110,90,"*"],body:[[fact("Vlasnik",roleText(project,"owner")),fact("Prioritet",priorityLabels[project.finalPriority],project.finalPriority==="critical"?colors.critical:project.finalPriority==="very_high"?colors.red:colors.navy),fact("Napredak",project.progress===null?"Nije unet":`${Math.round(project.progress)}%`),fact("Procena završetka",formatDate(project.forecastFinish))]]},layout:{hLineColor:()=>colors.line,vLineColor:()=>colors.line,hLineWidth:()=>.5,vLineWidth:()=>.5},margin:[0,0,0,7]},
    sectionTitle("Svrha i očekivani rezultat"),textBlock("Opis projekta",project.description),textBlock("Cilj",project.objective),textBlock("Krajnji ishod",project.outcome),
    sectionTitle("Odgovornost i organizacija"),
    {table:{widths:[95,"*"],body:[["Vlasnici",roleText(project,"owner")],["Sponzori",roleText(project,"sponsor")],["Koordinatori",roleText(project,"coordinator")],["Izvršioci",roleText(project,"executor")]].map(([label,value])=>[{text:label,fontSize:7.2,bold:true,color:colors.slate,fillColor:colors.cream,margin:[4,3,4,3]},{text:value,fontSize:8.2,margin:[4,3,4,3]}])},layout:{hLineColor:()=>colors.line,vLineColor:()=>colors.line,hLineWidth:()=>.5,vLineWidth:()=>.5},margin:[0,0,0,4]},
    sectionTitle("Rokovi, vrednost i prioritet"),
    {table:{widths:["*","*","*","*"],body:[
      [fact("Planirani početak",formatDate(project.plannedStart)),fact("Stvarni početak",formatDate(project.actualStart)),fact("Prvobitni rok",formatDate(project.baselineFinish)),fact("Procena završetka",formatDate(project.forecastFinish))],
      [fact("Obavezni rok",formatDate(project.mandatoryDeadline)),fact("Vrednost",scoreText(project.valueScore)),fact("Hitnost",scoreText(project.urgencyScore,true)),fact("Posledica neizvršenja",scoreText(project.consequenceScore))]
    ]},layout:{hLineColor:()=>colors.line,vLineColor:()=>colors.line,hLineWidth:()=>.5,vLineWidth:()=>.5},margin:[0,0,0,7]},
    sectionTitle("Poslednji statusni presek"),
    {columns:[{stack:[{text:formatTimestamp(project.lastStatusAt),fontSize:7.2,bold:true,color:isStale(project)?colors.amber:colors.slate},{text:statusSummary(project),fontSize:9.7,bold:Boolean(project.lastStatusSummary),italics:!project.lastStatusSummary,color:project.lastStatusSummary?colors.navy:colors.slate,margin:[0,4,0,0],lineHeight:1.18}],width:"*"},{stack:[{text:"STANJE",fontSize:6.3,bold:true,color:colors.slate,alignment:"right"},{text:healthLabels[displayHealth(project)],fontSize:12,bold:true,color:statusTone,alignment:"right",margin:[0,2,0,0]},{text:project.managementAttention?"ZA REAKCIJU MENADŽMENTA":"",fontSize:6.1,bold:true,color:colors.rose,alignment:"right",margin:[0,2,0,0]}],width:145}],fillColor:colors.paper,margin:[7,6,7,6]},
    {table:{widths:[105,"*"],body:statusDetails.map(([label,value])=>[{text:label,fontSize:7.2,bold:true,color:colors.slate,fillColor:colors.cream,margin:[4,3,4,3]},{text:value,fontSize:8.2,bold:(label==="Prepreka"&&project.blockerState==="blocked")||label==="Potrebna odluka",color:label==="Prepreka"&&project.blockerState==="blocked"?colors.red:label==="Potrebna odluka"?colors.rose:colors.navy,margin:[4,3,4,3]}])},layout:{hLineColor:()=>colors.line,vLineColor:()=>colors.line,hLineWidth:()=>.5,vLineWidth:()=>.5},margin:[0,0,0,5]}
  ];
  const previous=history.slice(1,4);
  items.push(sectionTitle("Prethodni statusni preseci"));
  if(previous.length) {
    const historyHeader=["DATUM","STATUS","NAPREDAK","KOMENTAR"].map(text=>({text,fontSize:6.5,bold:true,color:colors.slate,fillColor:colors.soft,margin:[3,3,3,3]}));
    const historyRows=previous.map(report=>[
      {text:formatTimestamp(report.createdAt),fontSize:7,color:colors.slate,margin:[3,4,3,4]},
      {stack:[{text:healthLabels[report.health],fontSize:7.5,bold:true,color:colors[report.health]},{text:trendLabels[report.trend],fontSize:6.5,color:colors.slate,margin:[0,2,0,0]}],margin:[3,4,3,4]},
      {text:report.progress===null||report.progress===undefined?"-":`${Math.round(report.progress)}%`,fontSize:7.5,bold:true,alignment:"right",margin:[3,4,3,4]},
      {text:report.summary?.trim()||"Komentar nije unet.",fontSize:7.6,color:report.summary?colors.navy:colors.slate,italics:!report.summary,margin:[3,4,3,4],lineHeight:1.15}
    ]);
    items.push({table:{headerRows:1,dontBreakRows:true,widths:[72,70,48,"*"],body:[historyHeader,...historyRows]},layout:{hLineColor:()=>colors.line,vLineColor:()=>colors.line,hLineWidth:()=>.5,vLineWidth:()=>.5},margin:[0,0,0,5]});
  } else {
    items.push({text:"Nema prethodnih statusnih preseka.",fontSize:7.6,color:colors.slate,italics:true,margin:[0,0,0,5]});
  }
  return items;
}

function detailDefinition(projects:ProjectSummary[],filterSummary:string,_settings?:Pick<PortfolioSettings,"title"|"tagline"|"headerGraphic">,histories:StatusHistoryByProject={}) {
  const content:unknown[]=[];
  projects.forEach((project,index)=>content.push(...detailedProject(project,index,histories[project.id])));
  if(!projects.length)content.push({text:"Nema projekata koji odgovaraju izabranim filterima.",fontSize:12,color:colors.slate,margin:[0,30,0,0],alignment:"center"});
  return {pageSize:"A4",pageOrientation:"portrait",pageMargins:[30,27,30,25],defaultStyle:{font:"Roboto",fontSize:8.2,color:colors.navy,lineHeight:1.14},info:{title:"Detaljni pregled projekata",subject:`Kompletni projektni podaci · ${filterSummary}`,creator:"Portfolio projekata"},content,footer:(currentPage:number,pageCount:number)=>({columns:[{text:"DETALJNI PREGLED PROJEKATA",fontSize:6.3,bold:true,color:colors.slate},{text:`${currentPage} / ${pageCount}`,fontSize:6.7,color:colors.slate,alignment:"right"}],margin:[30,0,30,0]})};
}

export function buildPortfolioPdfDefinition(projects:ProjectSummary[],kind:PortfolioPdfKind,groupMode:GroupMode,filterSummary:string,settings?:Pick<PortfolioSettings,"title"|"tagline"|"headerGraphic">,histories:StatusHistoryByProject={}) {
  return kind==="executive"?executiveDefinition(projects,groupMode,filterSummary,settings):detailDefinition(projects,filterSummary,settings,histories);
}

export async function downloadPortfolioPdf(projects:ProjectSummary[],kind:PortfolioPdfKind,groupMode:GroupMode,filterSummary:string,settings?:Pick<PortfolioSettings,"title"|"tagline"|"headerGraphic">,histories:StatusHistoryByProject={}) {
  const pdfMake=await (pdfMakePromise??=loadPdfMake());
  const definition=buildPortfolioPdfDefinition(projects,kind,groupMode,filterSummary,settings,histories);
  await pdfMake.createPdf(definition).download(timestampName(kind,new Date()));
}
