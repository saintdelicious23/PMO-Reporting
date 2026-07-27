import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyPassword } from "../apps/server/src/password.ts";
import { authCredentialsSchema } from "../apps/server/src/validation.ts";

test("lozinke se čuvaju kao scrypt hash i proveravaju bez poređenja teksta", async () => {
  const hash=await hashPassword("sigurna-lozinka");
  assert.match(hash,/^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
  assert.equal(hash.includes("sigurna-lozinka"),false);
  assert.equal(await verifyPassword("sigurna-lozinka",hash),true);
  assert.equal(await verifyPassword("pogrešna-lozinka",hash),false);
});

test("korisničko ime i lozinka imaju minimalna pravila", () => {
  assert.equal(authCredentialsSchema.safeParse({username:"admin.test",password:"12345678"}).success,true);
  assert.equal(authCredentialsSchema.safeParse({username:"ne važi",password:"12345678"}).success,false);
  assert.equal(authCredentialsSchema.safeParse({username:"ok_user",password:"kratko"}).success,false);
});
