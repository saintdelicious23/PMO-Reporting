import type { AppUser, AuditEvent, Department, PortfolioSettings, PortfolioSettingsInput, ProjectDetail, ProjectInput, ProjectSummary, StatusReportHistoryItem, StatusReportInput } from "../../../packages/contracts/src/index.ts";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) }, ...options });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = Array.isArray(payload?.details) ? payload.details[0] : null;
    const suffix = detail?.message ? ` ${detail.field ? `${detail.field}: ` : ""}${detail.message}` : "";
    throw new Error(`${payload?.error ?? `HTTP ${response.status}`}${suffix}`);
  }
  return payload as T;
}

export const api = {
  health: () => request<{ok:boolean;mode:"postgresql";timestamp:string}>("/api/health"),
  getSettings: () => request<PortfolioSettings>("/api/settings"),
  updateSettings: (input:PortfolioSettingsInput) => request<PortfolioSettings>("/api/settings", { method:"PATCH",body:JSON.stringify(input) }),
  listUsers:()=>request<AppUser[]>("/api/users"),
  createUser:(displayName:string)=>request<AppUser>("/api/users",{method:"POST",body:JSON.stringify({displayName})}),
  listDepartments: () => request<Department[]>("/api/departments"),
  createDepartment: (name:string,code?:string) => request<Department>("/api/departments",{method:"POST",body:JSON.stringify({code,name})}),
  renameDepartment: (id:string,name:string,code?:string) => request<Department>(`/api/departments/${id}`,{method:"PATCH",body:JSON.stringify({code,name})}),
  moveDepartment: (id:string,direction:"up"|"down") => request<Department>(`/api/departments/${id}/move`,{method:"POST",body:JSON.stringify({direction})}),
  deleteDepartment: (id:string) => request<{deleted:boolean;affectedProjects:number}>(`/api/departments/${id}`,{method:"DELETE"}),
  listProjects: () => request<ProjectSummary[]>("/api/projects"),
  getProject: (id: string) => request<ProjectDetail>(`/api/projects/${id}`),
  statusHistory:(id:string)=>request<StatusReportHistoryItem[]>(`/api/projects/${id}/status-reports`),
  auditHistory:(id:string)=>request<AuditEvent[]>(`/api/projects/${id}/audit-events`),
  createProject: (input: ProjectInput) => request<ProjectDetail>("/api/projects", { method:"POST", body:JSON.stringify(input) }),
  updateProject: (id: string,input: Partial<ProjectInput>) => request<ProjectDetail>(`/api/projects/${id}`, { method:"PATCH", body:JSON.stringify(input) }),
  deleteProject: (id:string) => request<{deleted:boolean}>(`/api/projects/${id}`, { method:"DELETE" }),
  addStatus: (id: string,input: StatusReportInput) => request<ProjectDetail>(`/api/projects/${id}/status-reports`, { method:"POST", body:JSON.stringify(input) }),
};
