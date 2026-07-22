export type AgentState =
  | "available"
  | "ringing"
  | "on_call"
  | "wrap_up"
  | "scheduled"
  | "out_for_lunch"
  | "on_break"
  | "in_training"
  | "back_office"
  | "other"
  | "unavailable";

export type CallDirection = "inbound" | "outbound";
export type CallStatus = "answered" | "missed" | "in_progress";

export interface Department {
  id: string;
  name: string;
}

export interface Agent {
  id: string;
  name: string;
  departmentId: string;
  departmentName: string;
  state: AgentState;
  stateSince: string;
  currentCallStartedAt?: string;
  avatarUrl?: string;
}

export interface CallRecord {
  id: string;
  direction: CallDirection;
  status: CallStatus;
  agentId: string | null;
  agentName: string | null;
  transferredByAgentId: string | null;
  transferredByAgentName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  customerNumber: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
  talkTimeSeconds: number;
  waitTimeSeconds: number;
}

export interface CallRecording {
  id: string;
  callId: string;
  ticketId: string;
  recordingType: "call" | "voicemail" | string;
  durationSeconds: number;
  createdAt: string;
  agentName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  customerNumber: string;
}

export interface Kpis {
  total: number;
  inbound: number;
  outbound: number;
  answered: number;
  missed: number;
  /** Missed inbound calls where the customer waited under the configured short-no-answer threshold. */
  missedShort: number;
  answerRate: number;
  totalTalkSeconds: number;
  averageTalkSeconds: number;
  /** Average speed of answer — wait until pickup on answered inbound calls. */
  averageAsaSeconds: number;
  /** Average wait until answer or abandon on completed inbound calls. */
  averageWaitSeconds: number;
}

export interface DashboardData {
  calls: CallRecord[];
  agents: Agent[];
  departments: Department[];
  generatedAt: string;
  source: "demo" | "supabase";
  stale?: boolean;
  /** When set, the current user may only view this department. */
  scopedDepartmentId?: string | null;
}

export interface DashboardFilters {
  preset: "today" | "week" | "month" | "custom";
  from: string;
  to: string;
  departmentId: string;
  agentId: string;
}
