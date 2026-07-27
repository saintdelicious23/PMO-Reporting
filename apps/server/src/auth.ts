import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
import type { AppUser } from "../../../packages/contracts/src/index.ts";
import { pool } from "./database.ts";
import { hashPassword, verifyPassword } from "./password.ts";

type Row = QueryResultRow & Record<string, unknown>;
const SESSION_HOURS = 12;

const mapUser = (row:Row):AppUser => ({
  id:String(row.id),
  username:String(row.username),
  displayName:String(row.display_name),
  isAdmin:Boolean(row.is_admin),
  isActive:Boolean(row.is_active),
  lastLoginAt:row.last_login_at ? new Date(String(row.last_login_at)).toISOString() : null,
  createdAt:new Date(String(row.created_at)).toISOString(),
  updatedAt:new Date(String(row.updated_at)).toISOString()
});

const tokenHash=(token:string)=>createHash("sha256").update(token).digest("hex");

export async function setupRequired():Promise<boolean> {
  const result=await pool.query("SELECT 1 FROM app_users WHERE username IS NOT NULL AND password_hash IS NOT NULL LIMIT 1");
  return result.rowCount===0;
}

export async function setupInitialAdmin(username:string,password:string):Promise<AppUser> {
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    await client.query("LOCK TABLE app_users IN SHARE ROW EXCLUSIVE MODE");
    const existing=await client.query("SELECT 1 FROM app_users WHERE username IS NOT NULL AND password_hash IS NOT NULL LIMIT 1");
    if(existing.rowCount)throw new Error("Početni administrator je već podešen.");
    const passwordHash=await hashPassword(password);
    const legacy=await client.query("SELECT id FROM app_users WHERE username IS NULL ORDER BY created_at LIMIT 1 FOR UPDATE");
    const result=legacy.rowCount
      ? await client.query(`UPDATE app_users SET display_name=$1,username=$1,password_hash=$2,is_admin=true,is_active=true,updated_at=now()
          WHERE id=$3 RETURNING *`,[username,passwordHash,legacy.rows[0].id])
      : await client.query(`INSERT INTO app_users(id,display_name,username,password_hash,is_admin)
          VALUES($1,$2,$2,$3,true) RETURNING *`,[randomUUID(),username,passwordHash]);
    await client.query("COMMIT");
    return mapUser(result.rows[0]);
  }catch(error){
    await client.query("ROLLBACK");
    throw error;
  }finally{client.release();}
}

export async function listAccounts():Promise<AppUser[]> {
  const result=await pool.query("SELECT * FROM app_users WHERE username IS NOT NULL ORDER BY lower(username)");
  return result.rows.map(mapUser);
}

export async function createAccount(username:string,password:string):Promise<AppUser> {
  const passwordHash=await hashPassword(password);
  const result=await pool.query(`INSERT INTO app_users(id,display_name,username,password_hash,is_admin)
    VALUES($1,$2,$2,$3,false) RETURNING *`,[randomUUID(),username,passwordHash]);
  return mapUser(result.rows[0]);
}

export async function login(username:string,password:string):Promise<{user:AppUser;token:string}|null> {
  const result=await pool.query("SELECT * FROM app_users WHERE lower(username)=lower($1) AND is_active=true",[username]);
  const row=result.rows[0];
  if(!row?.password_hash||!await verifyPassword(password,String(row.password_hash)))return null;
  const token=randomBytes(32).toString("hex");
  await pool.query("DELETE FROM user_sessions WHERE expires_at<=now()");
  await pool.query(`INSERT INTO user_sessions(id,user_id,token_hash,expires_at)
    VALUES($1,$2,$3,now()+($4::text||' hours')::interval)`,[randomUUID(),row.id,tokenHash(token),SESSION_HOURS]);
  const updated=await pool.query("UPDATE app_users SET last_login_at=now(),updated_at=now() WHERE id=$1 RETURNING *",[row.id]);
  return {user:mapUser(updated.rows[0]),token};
}

export async function sessionUser(token:string|undefined):Promise<AppUser|null> {
  if(!token)return null;
  const result=await pool.query(`SELECT u.*,s.id AS session_id,s.last_seen_at
    FROM user_sessions s JOIN app_users u ON u.id=s.user_id
    WHERE s.token_hash=$1 AND s.expires_at>now() AND u.is_active=true`,[tokenHash(token)]);
  const row=result.rows[0];
  if(!row)return null;
  if(Date.now()-new Date(row.last_seen_at).getTime()>5*60_000){
    await pool.query("UPDATE user_sessions SET last_seen_at=now() WHERE id=$1",[row.session_id]);
  }
  return mapUser(row);
}

export async function logout(token:string|undefined):Promise<void> {
  if(token)await pool.query("DELETE FROM user_sessions WHERE token_hash=$1",[tokenHash(token)]);
}
