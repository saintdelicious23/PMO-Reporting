import assert from "node:assert/strict";
import test from "node:test";
import { formatLocalDate, parseLocalDate } from "../apps/web/src/date-input.ts";

test("datumska polja prikazuju dd.mm.gggg, a API dobija ISO datum",()=>{
  assert.equal(formatLocalDate("2026-07-26"),"26.07.2026");
  assert.equal(parseLocalDate("26.07.2026"),"2026-07-26");
  assert.equal(parseLocalDate(""),null);
});

test("datumska polja odbijaju pogrešan format i nepostojeći datum",()=>{
  assert.throws(()=>parseLocalDate("07/26/2026"),/dd\.mm\.gggg/);
  assert.throws(()=>parseLocalDate("31.02.2026"),/nije ispravan/);
});
