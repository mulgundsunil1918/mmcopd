// Meta WhatsApp Cloud API client — thin HTTP wrapper, no business logic here.
// All calls go to https://graph.facebook.com/v21.0/{phone_number_id}/...

import type { WaConnectInput, WaHealthResult, WaSendResult } from '../../types/whatsapp';

const BASE = 'https://graph.facebook.com/v21.0';

export interface MetaTextPayload {
  to: string;
  templateName: string;
  languageCode: string;
  components?: MetaTemplateComponent[];
}

export interface MetaTemplateComponent {
  type: 'header' | 'body' | 'button';
  sub_type?: string;
  index?: number;
  parameters: Array<{ type: string; text?: string; image?: { link: string }; currency?: unknown; date_time?: unknown }>;
}

async function postJson(url: string, token: string, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
  return json;
}

async function getJson(url: string, token: string) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
  return json;
}

/** Verify the connection and return basic phone info. */
export async function checkHealth(input: Pick<WaConnectInput, 'phone_number_id' | 'access_token'>): Promise<WaHealthResult> {
  try {
    const data = await getJson(
      `${BASE}/${input.phone_number_id}?fields=display_phone_number,verified_name,quality_rating`,
      input.access_token
    );
    return {
      ok: true,
      display_name: data.verified_name ?? undefined,
      phone_number: data.display_phone_number ?? undefined,
      quality_rating: data.quality_rating ?? undefined,
    };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Send a template message. Returns the WhatsApp message ID (wam_id) on success. */
export async function sendTemplate(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  templateName: string,
  languageCode: string,
  components?: MetaTemplateComponent[]
): Promise<WaSendResult> {
  try {
    const payload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        ...(components?.length ? { components } : {}),
      },
    };
    const data = await postJson(`${BASE}/${phoneNumberId}/messages`, accessToken, payload);
    const wam_id: string | undefined = data?.messages?.[0]?.id;
    return { ok: true, wam_id };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Send a plain text message (within 24h service window). */
export async function sendText(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  body: string
): Promise<WaSendResult> {
  try {
    const data = await postJson(`${BASE}/${phoneNumberId}/messages`, accessToken, {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body, preview_url: false },
    });
    const wam_id: string | undefined = data?.messages?.[0]?.id;
    return { ok: true, wam_id };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** List templates registered in the WABA. */
export async function listTemplates(wabaId: string, accessToken: string) {
  const data = await getJson(
    `${BASE}/${wabaId}/message_templates?fields=id,name,category,language,status,components`,
    accessToken
  );
  return (data?.data ?? []) as Array<{
    id: string;
    name: string;
    category: string;
    language: string;
    status: string;
    components: unknown[];
  }>;
}
