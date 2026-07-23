import type { PortfolioSettings, ProjectSummary } from "../../../packages/contracts/src/index.ts";
import { columnLabels, viewOptions, type ColumnKey, type GroupMode, type ViewMode } from "./view-config.ts";

let pdfMakePromise:Promise<Awaited<ReturnType<typeof loadPdfMake>>>|null=null;
async function loadPdfMake() {
  const [pdfModule,fontModule]=await Promise.all([import("pdfmake/build/pdfmake"),import("pdfmake/build/vfs_fonts")]);
  const pdfMake=pdfModule.default;
  pdfMake.addVirtualFileSystem(fontModule.default);
  return pdfMake;
}

const categoryLabels = { strategic:"Strateški projekat",mandatory:"Regulatorne obaveze",operational_improvement:"Operativno unapređenje" } as const;
const healthLabels = { green:"Zeleno",amber:"Žuto",red:"Crveno",critical:"Kritično" } as const;
const priorityLabels = { low:"Nizak",medium:"Srednji",high:"Visok",very_high:"Veoma visok",critical:"Kritičan" } as const;
const trendLabels = { improving:"Poboljšava se",stable:"Stabilno",declining:"Pogoršava se" } as const;
const lifecycleLabels = { planning:"Planiranje",active:"Aktivan",on_hold:"Privremeno obustavljen",blocked:"Blokiran",completed:"Završen",cancelled:"Otkazan" } as const;
const colors = { navy:"#15233f",blue:"#315fd6",rose:"#b94770",green:"#13945f",amber:"#bd7608",red:"#bd3442",critical:"#801e32",slate:"#64748b",line:"#d9e1ea",soft:"#f3f6f9" };
const categoryOrder:ProjectSummary["category"][]=["strategic","mandatory","operational_improvement"];

const formatDate = (value:string|null) => value ? new Intl.DateTimeFormat("sr-Latn-RS",{day:"2-digit",month:"short",year:"numeric"}).format(new Date(`${value.slice(0,10)}T12:00:00`)) : "Nije određeno";
const scoreText=(value:number,urgency=false)=>urgency&&value===5?"Rok probijen":["Nema","Nisko","Srednje","Visoko","Veoma visoko"][value]??String(value);
const timestampName = (date:Date) => {
  const pad=(value:number)=>String(value).padStart(2,"0");
  return `project-portfolio_${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}.pdf`;
};

function healthCell(project:ProjectSummary) {
  const color=colors[project.health];
  return { text:healthLabels[project.health],color,bold:true };
}

function projectCell(project:ProjectSummary) {
  return { stack:[{text:`${String(project.projectNumber).padStart(3,"0")}  ${project.name}`,bold:true,color:colors.navy},{text:lifecycleLabels[project.lifecycleStatus],fontSize:7,color:colors.slate,margin:[0,2,0,0]}] };
}

function cellFor(column:ColumnKey,project:ProjectSummary):unknown {
  if(column==="name") return projectCell(project);
  if(column==="id") return {text:project.projectCode,fontSize:7.5,bold:true,color:colors.slate};
  if(column==="projectNumber") return {text:String(project.projectNumber).padStart(3,"0"),bold:true};
  if(column==="category") return {text:categoryLabels[project.category],bold:true};
  if(column==="lifecycleStatus") return {text:lifecycleLabels[project.lifecycleStatus],bold:true};
  if(column==="health") return healthCell(project);
  if(column==="trend") return {text:trendLabels[project.trend],color:project.trend==="improving"?colors.green:project.trend==="declining"?colors.red:colors.slate};
  if(column==="owner") return {text:project.owner,bold:true};
  if(column==="sponsor") return {text:project.sponsor??"Nije definisano",color:project.sponsor?colors.navy:colors.slate};
  if(column==="coordinator") return {text:project.coordinator??"Nije definisano",color:project.coordinator?colors.navy:colors.slate};
  if(column==="deliveryLead") return {text:project.deliveryLead??"Nije definisano",bold:Boolean(project.deliveryLead),color:project.deliveryLead?colors.navy:colors.slate};
  if(column==="department") return {text:project.leadDepartment??"Bez sektora",color:project.leadDepartment?colors.navy:colors.slate};
  if(column==="description") return {text:project.description??"Nije definisano",color:project.description?colors.navy:colors.slate};
  if(column==="objective") return {text:project.objective??"Nije definisano",color:project.objective?colors.navy:colors.slate};
  if(column==="outcome") return {text:project.outcome??"Nije definisano",color:project.outcome?colors.navy:colors.slate};
  if(column==="valueScore") return {text:scoreText(project.valueScore),bold:true};
  if(column==="urgencyScore") return {text:scoreText(project.urgencyScore,true),bold:true};
  if(column==="consequenceScore") return {text:scoreText(project.consequenceScore),bold:true};
  if(column==="finalPriority") return {text:priorityLabels[project.finalPriority],bold:true,color:project.finalPriority==="critical"?colors.critical:project.finalPriority==="very_high"?colors.red:project.finalPriority==="high"?colors.amber:colors.slate};
  if(column==="suggestedPriority") return {text:priorityLabels[project.suggestedPriority],bold:true,color:colors.slate};
  if(column==="progress") return {text:project.progress===null?"—":`${Math.round(project.progress)}%`,alignment:"right"};
  if(column==="baselineFinish") return {text:formatDate(project.baselineFinish),bold:true};
  if(column==="forecastFinish") return {stack:[{text:formatDate(project.forecastFinish),bold:true},...(project.baselineFinish&&project.baselineFinish!==project.forecastFinish?[{text:`Prvobitni rok ${formatDate(project.baselineFinish)}`,fontSize:7,color:colors.slate,margin:[0,2,0,0]}]:[])]};
  if(column==="mandatoryDeadline") return {text:formatDate(project.mandatoryDeadline),bold:true};
  if(column==="nextMilestone") return {text:project.nextMilestone??"Nije definisano",bold:Boolean(project.nextMilestone),color:project.nextMilestone?colors.navy:colors.slate};
  if(column==="nextMilestoneDate") return {stack:[{text:project.nextMilestone??"Nije definisano",bold:true},{text:project.nextMilestoneDate?formatDate(project.nextMilestoneDate):"Bez datuma",fontSize:7,color:colors.slate,margin:[0,2,0,0]}]};
  if(column==="blockerState") return {text:project.blockerState==="blocked"?"Blokiran":project.blockerState==="none"?"Nema blokade":"Nije definisano",bold:project.blockerState==="blocked",color:project.blockerState==="blocked"?colors.red:colors.slate};
  if(column==="blocker") return {text:project.topBlocker??(project.blockerState==="blocked"?"Blokiran — razlog nije upisan":"Nema potvrđene prepreke"),bold:project.blockerState==="blocked",color:project.blockerState==="blocked"?colors.red:colors.slate};
  if(column==="decisionRequired") return {text:project.decisionRequired?"Da":"Ne",bold:project.decisionRequired,color:project.decisionRequired?colors.rose:colors.slate};
  if(column==="decisionText") return {text:project.decisionText??"Nije potrebna odluka",color:project.decisionText?colors.navy:colors.slate};
  if(column==="decisionDueDate") return {text:formatDate(project.decisionDueDate),bold:Boolean(project.decisionDueDate)};
  if(column==="managementAttention") return {text:project.managementAttention?"Da":"Ne",bold:project.managementAttention,color:project.managementAttention?colors.rose:colors.slate};
  if(column==="isDemo") return {text:project.isDemo?"1 · Da":"0 · Ne",bold:project.isDemo,color:project.isDemo?colors.blue:colors.slate};
  return {text:project.lastStatusAt?new Intl.DateTimeFormat("sr-Latn-RS",{dateStyle:"medium",timeStyle:"short"}).format(new Date(project.lastStatusAt)):"Nema statusa",color:colors.slate};
}

function columnWidths(columns:ColumnKey[]) {
  const weight:Record<ColumnKey,number>={name:2.4,id:2,projectNumber:.8,category:1.4,lifecycleStatus:1.2,health:1,trend:1,owner:1.5,sponsor:1.5,coordinator:1.6,deliveryLead:1.5,department:1.3,description:2.6,objective:2.6,outcome:2.6,valueScore:1,urgencyScore:1,consequenceScore:1.2,finalPriority:1.1,suggestedPriority:1.2,progress:.9,baselineFinish:1.2,forecastFinish:1.4,mandatoryDeadline:1.2,nextMilestone:2,nextMilestoneDate:2.1,blockerState:1.1,blocker:2.4,decisionRequired:1,decisionText:2.4,decisionDueDate:1.2,managementAttention:1.2,isDemo:.9,lastUpdatedAt:1.4};
  const landscapeA4Width=841.89;
  const horizontalPageMargins=44;
  const horizontalCellPadding=8;
  const verticalBorderWidth=.5;
  const tableOffsets=(columns.length*horizontalCellPadding)+((columns.length+1)*verticalBorderWidth);
  const usablePageWidth=landscapeA4Width-horizontalPageMargins-tableOffsets;
  const totalWeight=columns.reduce((sum,column)=>sum+weight[column],0);
  return columns.map(column=>Number((usablePageWidth*weight[column]/totalWeight).toFixed(2)));
}

export function buildPortfolioPdfDefinition(projects:ProjectSummary[],viewMode:ViewMode,groupMode:GroupMode,filterSummary:string,settings?:Pick<PortfolioSettings,"title"|"tagline"|"viewColumns">) {
  const generatedAt=new Date();
  const viewOption=viewOptions[viewMode]??viewOptions.detailed!;
  const reportTitle=settings?.title??"Upravljački pregled";
  const reportTagline=settings?.tagline??viewOption.label;
  const active=projects.filter(project=>!["completed","cancelled"].includes(project.lifecycleStatus));
  const kpis=[
    ["U prikazu",projects.length],["Aktivni",active.length],["Zeleno",active.filter(project=>project.health==="green").length],
    ["Žuto",active.filter(project=>project.health==="amber").length],["Crveno / kritično",active.filter(project=>project.health==="red"||project.health==="critical").length],
    ["Za reakciju",active.filter(project=>project.managementAttention||project.decisionRequired).length]
  ];
  const columns=settings?.viewColumns?.[viewMode]??viewOption.columns;
  const makeTableHeader=()=>columns.map(column=>({text:columnLabels[column].toUpperCase(),fontSize:6.5,bold:true,color:"#42536a",fillColor:"#eaf0f5",margin:[2,3,2,3]}));
  const tableLayout={hLineColor:()=>colors.line,vLineColor:()=>colors.line,hLineWidth:()=>.5,vLineWidth:()=>.5};
  const content:unknown[]=[
    {columns:[{stack:[{text:`PORTFOLIO PROJEKATA · ${viewOption.label.toUpperCase()}`,fontSize:8,bold:true,color:colors.blue,characterSpacing:1.1},{text:reportTitle,fontSize:20,bold:true,color:colors.navy,margin:[0,3,0,0]},{text:reportTagline,fontSize:8.5,color:colors.slate,margin:[0,4,0,0]}]},{stack:[{text:"GENERISANO",fontSize:7,bold:true,color:colors.slate,alignment:"right"},{text:new Intl.DateTimeFormat("sr-Latn-RS",{dateStyle:"medium",timeStyle:"medium"}).format(generatedAt),fontSize:9,bold:true,color:colors.navy,alignment:"right",margin:[0,3,0,0]},{text:filterSummary,fontSize:7,color:colors.slate,alignment:"right",margin:[0,3,0,0]}],width:230}],margin:[0,0,0,10]},
    {table:{widths:kpis.map(()=>"*"),body:[kpis.map(([label])=>({text:label,fontSize:7,bold:true,color:colors.slate,fillColor:colors.soft,margin:[2,2,2,0]})),kpis.map(([,value])=>({text:String(value),fontSize:18,bold:true,color:colors.navy,fillColor:"#ffffff",margin:[2,0,2,3]}))]},layout:{hLineColor:()=>colors.line,vLineColor:()=>colors.line,hLineWidth:()=>.5,vLineWidth:()=>.5},margin:[0,0,0,10]}
  ];
  const groups = groupMode==="all" ? [{label:"Svi projekti",projects}] : categoryOrder.map(category=>({label:categoryLabels[category],projects:projects.filter(project=>project.category===category)}));
  for(const item of groups) {
    const group=item.projects;
    content.push({columns:[{text:item.label,fontSize:12,bold:true,color:colors.navy},{text:`${group.length} projekata  ·  ${group.filter(project=>project.health==="red"||project.health==="critical").length} crveno/kritično  ·  ${group.filter(project=>project.managementAttention||project.decisionRequired).length} za reakciju`,fontSize:7,color:colors.slate,alignment:"right"}],margin:[0,5,0,4]});
    const widths=columnWidths(columns);
    content.push({table:{widths,body:[makeTableHeader()]},layout:tableLayout,margin:[0,0,0,0]});
    if(group.length) {
      for(const project of group) {
        const row=columns.map(column=>({...(cellFor(column,project) as object),fontSize:8,margin:[2,3,2,3],fillColor:project.managementAttention||project.decisionRequired?"#fff4f7":"#ffffff"}));
        content.push({unbreakable:true,table:{widths,body:[row]},layout:tableLayout,margin:[0,0,0,0]});
      }
    } else {
      content.push({unbreakable:true,table:{widths,body:[[{text:"Nema projekata koji odgovaraju filterima.",colSpan:columns.length,color:colors.slate,margin:[2,5,2,5]},...Array.from({length:Math.max(0,columns.length-1)},()=>({text:""}))]]},layout:tableLayout,margin:[0,0,0,0]});
    }
    content.push({text:"",margin:[0,0,0,8]});
  }
  const repeatedHeaderText=columns.map(column=>columnLabels[column].toUpperCase()).join("  ·  ");
  return {pageSize:"A4",pageOrientation:"landscape",pageMargins:[22,34,22,24],defaultStyle:{font:"Roboto",fontSize:8,color:"#17283f"},info:{title:reportTitle,subject:"Upravljački pregled portfolija projekata",creator:"Portfolio projekata"},content,header:(currentPage:number)=>currentPage===1?null:{text:repeatedHeaderText,fontSize:6.5,bold:true,color:"#42536a",margin:[22,12,22,0]},footer:(currentPage:number,pageCount:number)=>({text:`Portfolio projekata  ·  ${currentPage} / ${pageCount}`,fontSize:7,color:colors.slate,alignment:"right",margin:[0,0,22,0]})};
}

export async function downloadPortfolioPdf(projects:ProjectSummary[],viewMode:ViewMode,groupMode:GroupMode,filterSummary:string,settings?:Pick<PortfolioSettings,"title"|"tagline"|"viewColumns">) {
  const pdfMake=await (pdfMakePromise??=loadPdfMake());
  const definition=buildPortfolioPdfDefinition(projects,viewMode,groupMode,filterSummary,settings);
  await pdfMake.createPdf(definition).download(timestampName(new Date()));
}
