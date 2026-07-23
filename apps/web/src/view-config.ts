import type { PortfolioColumnKey, PortfolioGroupMode, PortfolioViewMode, PortfolioViewColumns } from "../../../packages/contracts/src/index.ts";

export type ColumnKey = PortfolioColumnKey;
export type ViewMode = string;
export type GroupMode = PortfolioGroupMode;

export const viewOptions:Record<string,{label:string;description:string;columns:ColumnKey[]}> = {
  detailed:{
    label:"Ultradetaljno",
    description:"Skoro sva raspoloživa polja, uključujući kretanje, sektor, ključnu tačku i prepreku.",
    columns:["name","health","trend","owner","deliveryLead","department","finalPriority","progress","forecastFinish","nextMilestoneDate","blocker"]
  },
  engaged:{
    label:"Standardno",
    description:"Dovoljno konteksta za razgovor o stanju, odgovornosti, roku i sledećoj kontrolnoj tački.",
    columns:["name","health","trend","owner","deliveryLead","finalPriority","progress","forecastFinish","nextMilestoneDate","blocker"]
  },
  executive:{
    label:"Svedeno",
    description:"Stanje, odgovornost, prioritet, napredak, rok i signal za intervenciju.",
    columns:["name","health","owner","deliveryLead","finalPriority","progress","forecastFinish","blocker"]
  },
  goldfish:{
    label:"Najosnovnije",
    description:"Najkraći pregled: projekat, stanje, odgovornost i glavna prepreka.",
    columns:["name","health","owner","deliveryLead","blocker"]
  }
};

export const columnLabels:Record<ColumnKey,string> = {
  name:"Projekat",id:"Puni ID",projectNumber:"Redni broj",category:"Kategorija",lifecycleStatus:"Životni ciklus",health:"Stanje",trend:"Kretanje",
  owner:"Vlasnik",sponsor:"Sponzor",coordinator:"Rukovodilac / koordinator",deliveryLead:"Glavni izvršilac",department:"Sektor",
  description:"Opis",objective:"Cilj",outcome:"Krajnji ishod",valueScore:"Vrednost",urgencyScore:"Hitnost",consequenceScore:"Posledica neizvršenja",
  finalPriority:"Prioritet",suggestedPriority:"Predloženi prioritet",progress:"Napredak",baselineFinish:"Prvobitni rok",forecastFinish:"Procena završetka",
  mandatoryDeadline:"Obavezni krajnji rok",nextMilestone:"Sledeća ključna tačka",nextMilestoneDate:"Datum ključne tačke",blockerState:"Stanje blokade",
  blocker:"Prepreka",decisionRequired:"Potrebna odluka",decisionText:"Tekst odluke",decisionDueDate:"Rok odluke",managementAttention:"Reakcija menadžmenta",
  isDemo:"Probni podatak",lastUpdatedAt:"Poslednje ažuriranje"
};

export const defaultViewColumns:PortfolioViewColumns = Object.fromEntries(
  Object.entries(viewOptions).map(([mode,option])=>[mode,[...option.columns]])
) as PortfolioViewColumns;
