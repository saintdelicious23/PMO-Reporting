import "dotenv/config";
import express from "express";
import { ZodError } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeDatabase } from "./database.ts";
import * as repository from "./repository.ts";
import { departmentInputSchema, departmentMoveSchema, portfolioSettingsSchema, projectInputSchema, projectPatchSchema, statusInputSchema, userInputSchema } from "./validation.ts";

const app = express();
const port = Number(process.env.PORT ?? 4317);
const host = process.env.HOST ?? "127.0.0.1";
app.use(express.json({ limit: "1mb" }));

const asyncRoute = (handler: express.RequestHandler): express.RequestHandler => (req,res,next) => Promise.resolve(handler(req,res,next)).catch(next);
const projectId = (req: express.Request) => String(req.params.id);

app.get("/api/health", (_req,res) => res.json({ ok: true, mode: "postgresql", timestamp: new Date().toISOString() }));
app.get("/api/settings", asyncRoute(async (_req,res) => res.json(await repository.getPortfolioSettings())));
app.get("/api/users", asyncRoute(async (_req,res)=>res.json(await repository.listUsers())));
app.post("/api/users",asyncRoute(async(req,res)=>{const {displayName}=userInputSchema.parse(req.body);res.status(201).json(await repository.createUser(displayName));}));
app.patch("/api/settings", asyncRoute(async (req,res) => {
  const input=portfolioSettingsSchema.parse(req.body);
  res.json(await repository.updatePortfolioSettings(input));
}));
app.get("/api/departments", asyncRoute(async (_req,res) => res.json(await repository.listDepartments())));
app.post("/api/departments", asyncRoute(async (req,res) => {
  const {code,name}=departmentInputSchema.parse(req.body);
  const generatedCode=code??name.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^A-Za-z0-9]+/g,"").slice(0,8).toUpperCase();
  res.status(201).json(await repository.createDepartment(generatedCode,name));
}));
app.patch("/api/departments/:id", asyncRoute(async (req,res) => {
  const {code,name}=departmentInputSchema.parse(req.body);
  const department=await repository.renameDepartment(projectId(req),code,name);
  if(!department)return void res.status(404).json({error:"Sektor nije pronađen."});
  res.json(department);
}));
app.post("/api/departments/:id/move", asyncRoute(async (req,res) => {
  const {direction}=departmentMoveSchema.parse(req.body);
  const department=await repository.moveDepartment(projectId(req),direction);
  if(!department)return void res.status(404).json({error:"Sektor nije pronađen."});
  res.json(department);
}));
app.delete("/api/departments/:id", asyncRoute(async (req,res) => {
  const result=await repository.deleteDepartment(projectId(req));
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
  const project = await repository.createProject(input);
  res.status(201).json(project);
}));
app.patch("/api/projects/:id", asyncRoute(async (req,res) => {
  const input = projectPatchSchema.parse(req.body);
  const project = await repository.updateProject(projectId(req),input);
  if (!project) return void res.status(404).json({ error: "Projekat nije pronađen." });
  res.json(project);
}));
app.delete("/api/projects/:id", asyncRoute(async (req,res) => {
  if(!await repository.deleteProject(projectId(req)))return void res.status(404).json({error:"Projekat nije pronađen."});
  res.json({deleted:true});
}));
app.post("/api/projects/:id/status-reports", asyncRoute(async (req,res) => {
  const input = statusInputSchema.parse(req.body);
  const project = await repository.addStatusReport(projectId(req),input);
  if (!project) return void res.status(404).json({ error: "Projekat nije pronađen." });
  res.status(201).json(project);
}));
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
app.use(express.static(webRoot));
app.get("/{*path}", (_req,res,next) => res.sendFile(path.join(webRoot,"index.html"), (error) => error ? next() : undefined));

app.use((error: unknown,_req: express.Request,res: express.Response,_next: express.NextFunction) => {
  if(error instanceof ZodError)return void res.status(400).json({error:"Uneti podaci nisu ispravni.",details:error.issues.map(issue=>({field:issue.path.join("."),message:issue.message}))});
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
