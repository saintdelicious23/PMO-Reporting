export function formatLocalDate(value:string|null|undefined){
  if(!value)return "";
  const match=value.slice(0,10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match?`${match[3]}.${match[2]}.${match[1]}`:value;
}

export function parseLocalDate(value:unknown,label="Datum"){
  const text=String(value??"").trim();
  if(!text)return null;
  const match=text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if(!match)throw new Error(`${label}: koristi format dd.mm.gggg.`);
  const day=Number(match[1]),month=Number(match[2]),year=Number(match[3]);
  const candidate=new Date(Date.UTC(year,month-1,day));
  if(candidate.getUTCFullYear()!==year||candidate.getUTCMonth()!==month-1||candidate.getUTCDate()!==day)throw new Error(`${label}: datum nije ispravan.`);
  return `${match[3]}-${match[2]}-${match[1]}`;
}
