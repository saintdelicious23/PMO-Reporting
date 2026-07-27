import "dotenv/config";
import express from "express";
import { ZodError } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AppUser } from "../../../packages/contracts/src/index.ts";
import { closeDatabase } from "./database.ts";
import * as auth from "./auth.ts";
import * as repository from "./repository.ts";
import { authCredentialsSchema, departmentInputSchema, departmentMoveSchema, portfolioSettingsSchema, projectInputSchema, projectUpdateSchema, statusInputSchema, userInputSchema } from "./validation.ts";

const app = express();
const port = Number(process.env.PORT ?? 4317);
const host = process.env.HOST ?? "127.0.0.1";
const sessionCookie="reporting_session";
const sessionMaxAge=12*60*60;
type AuthRequest=express.Request&{authUser?:AppUser;authToken?:string};
app.set("trust proxy",1);
app.use(express.json({ limit: "1mb" }));

const asyncRoute = (handler: express.RequestHandler): express.RequestHandler => (req,res,next) => Promise.resolve(handler(req,res,next)).catch(next);
const projectId = (req: express.Request) => String(req.params.id);
const cookieValue=(req:express.Request,name:string)=>req.headers.cookie?.split(";").map(value=>value.trim()).find(value=>value.startsWith(`${name}=`))?.slice(name.length+1);
const setSessionCookie=(req:express.Request,res:express.Response,token:string)=>res.setHeader("Set-Cookie",`${sessionCookie}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionMaxAge}${req.secure?"; Secure":""}`);
const clearSessionCookie=(req:express.Request,res:express.Response)=>res.setHeader("Set-Cookie",`${sessionCookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${req.secure?"; Secure":""}`);
const currentUser=(req:express.Request)=>(req as AuthRequest).authUser!;
const requireAdmin:express.RequestHandler=(req,res,next)=>currentUser(req).isAdmin?next():res.status(403).json({error:"Samo administrator može da upravlja korisničkim nalozima."});

app.get("/api/health", (_req,res) => res.json({ ok: true, mode: "postgresql", timestamp: new Date().toISOString() }));
app.get("/api/auth/status",asyncRoute(async(req,res)=>{
  const token=cookieValue(req,sessionCookie);
  const user=await auth.sessionUser(token);
  res.json({authenticated:Boolean(user),setupRequired:await auth.setupRequired(),user});
}));
app.post("/api/auth/setup",asyncRoute(async(req,res)=>{
  const input=authCredentialsSchema.parse(req.body);
  await auth.setupInitialAdmin(input.username,input.password);
  const session=await auth.login(input.username,input.password);
  if(!session)throw new Error("Početna prijava nije uspela.");
  setSessionCookie(req,res,session.token);
  res.status(201).json(session.user);
}));
app.post("/api/auth/login",asyncRoute(async(req,res)=>{
  const input=authCredentialsSchema.parse(req.body);
  const session=await auth.login(input.username,input.password);
  if(!session)return void res.status(401).json({error:"Korisničko ime ili lozinka nisu ispravni."});
  setSessionCookie(req,res,session.token);
  res.json(session.user);
}));
app.post("/api/auth/logout",asyncRoute(async(req,res)=>{
  await auth.logout(cookieValue(req,sessionCookie));
  clearSessionCookie(req,res);
  res.status(204).end();
}));
app.use("/api",asyncRoute(async(req,res,next)=>{
  const token=cookieValue(req,sessionCookie);
  const user=await auth.sessionUser(token);
  if(!user)return void res.status(401).json({error:"Prijava je istekla. Prijavi se ponovo."});
  (req as AuthRequest).authUser=user;(req as AuthRequest).authToken=token;
  next();
}));
app.get("/api/auth/me",(req,res)=>res.json(currentUser(req)));
app.get("/api/settings", asyncRoute(async (_req,res) => res.json(await repository.getPortfolioSettings())));
app.get("/api/users",requireAdmin,asyncRoute(async (_req,res)=>res.json(await auth.listAccounts())));
app.post("/api/users",requireAdmin,asyncRoute(async(req,res)=>{const {username,password}=userInputSchema.parse(req.body);res.status(201).json(await auth.createAccount(username,password));}));
app.patch("/api/settings", asyncRoute(async (req,res) => {
  const input=portfolioSettingsSchema.parse(req.body);
  res.json(await repository.updatePortfolioSettings(input));
}));
app.get("/api/departments", asyncRoute(async (_req,res) => res.json(await repository.listDepartments())));
app.post("/api/departments", asyncRoute(async (req,res) => {
  const {code,name}=departmentInputSchema.parse(req.body);
  const generatedCode=code??name.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^A-Za-z0-9]+/g,"").slice(0,8).toUpperCase();
  res.status(201).json(await repository.createDepartment(generatedCode,name,currentUser(req).username));
}));
app.patch("/api/departments/:id", asyncRoute(async (req,res) => {
  const {code,name}=departmentInputSchema.parse(req.body);
  const department=await repository.renameDepartment(projectId(req),code,name,currentUser(req).username);
  if(!department)return void res.status(404).json({error:"Sektor nije pronađen."});
  res.json(department);
}));
app.post("/api/departments/:id/move", asyncRoute(async (req,res) => {
  const {direction}=departmentMoveSchema.parse(req.body);
  const department=await repository.moveDepartment(projectId(req),direction,currentUser(req).username);
  if(!department)return void res.status(404).json({error:"Sektor nije pronađen."});
  res.json(department);
}));
app.delete("/api/departments/:id", asyncRoute(async (req,res) => {
  const result=await repository.deleteDepartment(projectId(req),currentUser(req).username);
  if(!result.deleted)return void res.status(404).json({error:"Sektor nije pronađen."});
  res.json(result);
}));
app.get("/api/projects", asyncRoute(async (_req,res) => res.json(await repository.listProjects())));
app.get("/api/projects/:id", asyncRoute(async (req,res) => {
  const project = await repository.getProject(projectId(req));
  if (!project) return void res.status(404).json({ error: "Projekat nije pronađen." });
  res.json(project);
}));
app.get("/api/projects/:id/status-reports", asyncRoute(async (req,res) => {
  res.json(await repository.listStatusReports(projectId(req)));
}));
app.get("/api/projects/:id/audit-events", asyncRoute(async (req,res) => {
  res.json(await repository.listAuditEvents(projectId(req)));
}));
app.post("/api/projects", asyncRoute(async (req,res) => {
  const input = projectInputSchema.parse(req.body);
  const project = await repository.createProject(input,currentUser(req).username);
  res.status(201).json(project);
}));
app.patch("/api/projects/:id", asyncRoute(async (req,res) => {
  const {expectedUpdatedAt,...input} = projectUpdateSchema.parse(req.body);
  const project = await repository.updateProject(projectId(req),input,expectedUpdatedAt,currentUser(req).username);
  if (!project) return void res.status(404).json({ error: "Projekat nije pronađen." });
  res.json(project);
}));
app.delete("/api/projects/:id", asyncRoute(async (req,res) => {
  if(!await repository.deleteProject(projectId(req),currentUser(req).username))return void res.status(404).json({error:"Projekat nije pronađen."});
  res.json({deleted:true});
}));
app.post("/api/projects/:id/status-reports", asyncRoute(async (req,res) => {
  const input = statusInputSchema.parse(req.body);
  const project = await repository.addStatusReport(projectId(req),input,currentUser(req).username);
  if (!project) return void res.status(404).json({ error: "Projekat nije pronađen." });
  res.status(201).json(project);
}));
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
app.use(express.static(webRoot));
app.get("/{*path}", (_req,res,next) => res.sendFile(path.join(webRoot,"index.html"), (error) => error ? next() : undefined));

app.use((error: unknown,_req: express.Request,res: express.Response,_next: express.NextFunction) => {
  if(error instanceof ZodError)return void res.status(400).json({error:"Uneti podaci nisu ispravni.",details:error.issues.map(issue=>({field:issue.path.join("."),message:issue.message}))});
  if(error instanceof repository.ProjectConflictError)return void res.status(409).json({error:error.message});
  const code=typeof error==="object"&&error&&"code" in error?String(error.code):"";
  if(code==="23505")return void res.status(409).json({error:"Već postoji zapis sa istom jedinstvenom vrednošću."});
  if(code==="23503")return void res.status(409).json({error:"Izabrana povezana stavka ne postoji ili se još koristi."});
  if(code==="23514"||code==="22P02")return void res.status(400).json({error:"Uneti podaci nisu prihvatljivi."});
  const message=error instanceof Error?error.message:"Nepoznata greška";
  if(/postoji/i.test(message))return void res.status(409).json({error:message});
  process.stderr.write(`${message}\n`);res.status(500).json({error:"Došlo je do greške pri radu sa lokalnim servisom."});
});

const server = app.listen(port,host,() => process.stdout.write(`Reporting API: http://${host}:${port} (postgresql)\n`));
const shutdown = async () => { server.close(); await closeDatabase(); process.exit(0); };
process.on("SIGINT",shutdown); process.on("SIGTERM",shutdown);
