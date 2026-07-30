// WhatsApp Communication Platform — TypeScript types
// Phase 1: Connection Manager + Templates + Queue

export type WaAccountStatus = 'connected' | 'disconnected' | 'error' | 'pending';

export interface WaAccount {
  id: number;
  phone_number_id: string;   // Meta phone number ID
  waba_id: string;           // WhatsApp Business Account ID
  display_name: string | null;
  phone_number: string | null;
  webhook_verify_token: string;
  status: WaAccountStatus;
  last_health_check: string | null;
  created_at: string;
  updated_at: string;
}

export type WaTemplateCategory = 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';
export type WaTemplateStatus = 'APPROVED' | 'PENDING' | 'REJECTED';

export interface WaTemplateComponent {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS';
  format?: 'TEXT' | 'IMAGE' | 'DOCUMENT';
  text?: string;
  buttons?: Array<{ type: string; text: string; url?: string; phone_number?: string }>;
}

export interface WaTemplate {
  id: number;
  account_id: number;
  name: string;
  category: WaTemplateCategory;
  language: string;
  status: WaTemplateStatus;
  components: WaTemplateComponent[];
  meta_id: string | null;
  use_case: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type WaAutomationTrigger =
  | 'appointment_created'
  | 'appointment_reminder_24h'
  | 'appointment_reminder_1h'
  | 'appointment_completed'
  | 'prescription_generated'
  | 'lab_report_ready'
  | 'bill_generated'
  | 'followup_reminder_3d'
  | 'birthday_wish';

export interface WaAutomationRule {
  id: number;
  account_id: number;
  trigger: WaAutomationTrigger;
  template_name: string;
  is_enabled: boolean;
  delay_minutes: number;
  extra_config: Record<string, unknown> | null;
  created_at: string;
}

export type WaQueueStatus = 'pending' | 'sent' | 'failed' | 'cancelled';

export interface WaQueueItem {
  id: number;
  account_id: number;
  to_phone: string;
  patient_id: number | null;
  appointment_id: number | null;
  template_name: string;
  template_vars: Record<string, string> | null;
  status: WaQueueStatus;
  attempts: number;
  last_error: string | null;
  scheduled_at: string;
  sent_at: string | null;
  created_at: string;
}

export type WaMessageDirection = 'outbound' | 'inbound';
export type WaMessageStatus = 'sent' | 'delivered' | 'read' | 'failed';
export type WaMessageType = 'template' | 'text' | 'image' | 'document';

export interface WaMessage {
  id: number;
  account_id: number;
  wam_id: string | null;
  conversation_id: number | null;
  patient_id: number | null;
  direction: WaMessageDirection;
  message_type: WaMessageType;
  content: Record<string, unknown>;
  status: WaMessageStatus;
  timestamp: string;
  created_at: string;
}

export type WaConversationStatus = 'open' | 'resolved' | 'pending';

export interface WaConversation {
  id: number;
  account_id: number;
  patient_id: number | null;
  phone: string;
  status: WaConversationStatus;
  last_message_at: string | null;
  assigned_to: number | null;
  created_at: string;
}

// ── Campaigns ─────────────────────────────────────────────────────────────────
export type WaCampaignStatus = 'draft' | 'running' | 'completed' | 'failed';

export type WaCampaignSegment =
  | 'all'
  | 'visited_last_30d'
  | 'visited_last_90d'
  | 'followup_due_7d'
  | 'birthday_this_month'
  | 'no_visit_90d';

export interface WaCampaign {
  id: number;
  account_id: number;
  name: string;
  template_name: string;
  template_vars: Record<string, string> | null;
  segment: WaCampaignSegment;
  segment_config: Record<string, unknown> | null;
  status: WaCampaignStatus;
  total_count: number;
  sent_count: number;
  failed_count: number;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WaCampaignRecipient {
  id: number;
  campaign_id: number;
  patient_id: number | null;
  phone: string;
  patient_name: string | null;
  status: 'pending' | 'sent' | 'failed';
  wam_id: string | null;
  error: string | null;
  sent_at: string | null;
  created_at: string;
}

// IPC payloads
export interface WaConnectInput {
  phone_number_id: string;
  waba_id: string;
  access_token: string;
  display_name: string;
  phone_number: string;
}

export interface WaSendResult {
  ok: boolean;
  wam_id?: string;
  error?: string;
}

export interface WaQueueStats {
  pending: number;
  sent_today: number;
  failed_today: number;
  total_today: number;
}

export interface WaHealthResult {
  ok: boolean;
  display_name?: string;
  phone_number?: string;
  quality_rating?: string;
  error?: string;
}
