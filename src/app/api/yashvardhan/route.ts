// src/app/api/yashvardhan/route.ts
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const PUBLIC_DIR = path.join(process.cwd(), "public");
const RAW_JSONL = path.join(PUBLIC_DIR, "keystroke_raw_sessions.jsonl");
const CSV_FILE = path.join(PUBLIC_DIR, "keystroke_features.csv");
const CSV_HEADER = "session_id,user_id,age,gender,year_of_study,device_type,keyboard_type,question_id,question_text,prompt_context,window_start_ts,window_end_ts,duration_ms,n_keydowns,n_keyups,chars_per_sec,dwell_mean_ms,dwell_std_ms,dwell_median_ms,dwell_p10_ms,dwell_p90_ms,dd_mean_ms,dd_std_ms,dd_median_ms,pauses_gt_200,pauses_gt_500,pauses_gt_1000,longest_pause_ms,backspace_count,cv_dwell,cv_dd,hist_bin_0,hist_bin_1,hist_bin_2,hist_bin_3,hist_bin_4,hist_bin_5,inter_entropy,label_raw,raw_events_path";

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || "";
const AIRTABLE_BASE = process.env.AIRTABLE_BASE || "";
const AIRTABLE_TABLE = process.env.AIRTABLE_TABLE || ""; // can be table id or name
const MAX_RAW_LEN = 45000;

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function airtableRequest(path: string, init: RequestInit, attempts = 3) {
  let lastErr: any = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${path}`, {
        ...init,
        headers: {
          "Authorization": `Bearer ${AIRTABLE_TOKEN}`,
          "Content-Type": "application/json",
          ...(init.headers as any || {})
        }
      });
      if (r.status === 429 || (r.status >= 500 && r.status < 600)) {
        const body = await r.text();
        console.warn("[yash:Airtable] transient status", r.status, body.slice(0, 300));
        lastErr = new Error(`Airtable ${r.status}`);
      } else {
        return r;
      }
    } catch (e) {
      console.warn("[yash:Airtable] fetch error attempt", i + 1, e);
      lastErr = e;
    }
    await sleep(300 * Math.pow(2, i));
  }
  throw lastErr;
}

function ensurePublicFiles() {
  if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  if (!fs.existsSync(RAW_JSONL)) fs.writeFileSync(RAW_JSONL, "", { encoding: "utf8" });
  if (!fs.existsSync(CSV_FILE)) fs.writeFileSync(CSV_FILE, CSV_HEADER + "\n", { encoding: "utf8" });
}

export async function GET() {
  // serve CSV as attachment
  try {
    ensurePublicFiles();
    const data = fs.readFileSync(CSV_FILE);
    return new NextResponse(data, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="keystroke_features.csv"`
      }
    });
  } catch (err) {
    return NextResponse.json({ error: "Could not read CSV" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    console.log("[api/yashvardhan] POST hit (Airtable)");
    if (!AIRTABLE_TOKEN || !AIRTABLE_BASE || !AIRTABLE_TABLE) {
      console.error("[api/yashvardhan] Missing Airtable envs", {
        hasToken: !!AIRTABLE_TOKEN, hasBase: !!AIRTABLE_BASE, hasTable: !!AIRTABLE_TABLE,
      });
      return NextResponse.json({ ok: false, error: "Server misconfigured (Airtable env)" }, { status: 500 });
    }

    const body = await req.json();
    const keys = Object.keys(body || {});
    console.log("[api/yashvardhan] Incoming body keys:", keys);

    // Basic validation
    const required = ["session_id", "user_id", "question_id", "question_text", "prompt_context", "window_start_ts", "window_end_ts", "features"];
    const missing = required.filter(k => !(k in body));
    if (missing.length) {
      console.warn("[api/yashvardhan] Missing fields:", missing);
      return NextResponse.json({ ok: false, error: `Missing fields: ${missing.join(',')}` }, { status: 400 });
    }

    const session_id = String(body.session_id);
    const question_id = Number(body.question_id);

    // Idempotency: check if record exists
    const formula = encodeURIComponent(`AND({session_id}='${session_id}', {question_id}=${question_id})`);
    const searchPath = `${AIRTABLE_TABLE}?maxRecords=1&filterByFormula=${formula}`;
    console.log("[api/yashvardhan] Idempotency check filter:", decodeURIComponent(formula));
    const checkRes = await airtableRequest(searchPath, { method: "GET" });
    const checkJson: any = await checkRes.json();
    const existing = Array.isArray(checkJson?.records) && checkJson.records.length ? checkJson.records[0] : null;
    if (existing) {
      console.log("[api/yashvardhan] Duplicate detected; returning ok duplicate", existing.id);
      return NextResponse.json({ ok: true, message: "duplicate", recordId: existing.id });
    }

    // Prepare fields
    const nowIso = new Date().toISOString();
    const featuresJson = JSON.stringify(body.features || {});
    let rawEventsStr = body.raw_events;
    if (rawEventsStr && typeof rawEventsStr !== "string") {
      rawEventsStr = JSON.stringify(rawEventsStr);
    }
    if (typeof rawEventsStr !== "string") rawEventsStr = "";
    const rawTruncated = rawEventsStr.length > MAX_RAW_LEN;
    const rawToStore = rawTruncated ? rawEventsStr.slice(0, MAX_RAW_LEN) : rawEventsStr;

    const fields = {
      timestamp_received: nowIso,
      session_id: session_id,
      user_id: String(body.user_id || ""),
      age: Number(body.age || ""),
      gender: String(body.gender || ""),
      year_of_study: String(body.year_of_study || ""),
      question_id: question_id,
      question_text: String(body.question_text || ""),
      prompt_context: String(body.prompt_context || ""),
      window_start_ts: Number(body.window_start_ts || 0),
      window_end_ts: Number(body.window_end_ts || 0),
      features_json: featuresJson,
      label_raw: Number(body.label_raw || 0),
      raw_events_json: rawToStore,
    } as any;

    console.log("[api/yashvardhan] Creating Airtable record with fields:", Object.keys(fields));
    const createRes = await airtableRequest(`${AIRTABLE_TABLE}`, {
      method: "POST",
      body: JSON.stringify({ fields }),
    });
    const createJson: any = await createRes.json();
    if (!createRes.ok) {
      console.error("[api/yashvardhan] Airtable create error", createRes.status, createJson);
      return NextResponse.json({ ok: false, error: createJson?.error?.message || "Airtable create failed" }, { status: createRes.status });
    }

    console.log("[api/yashvardhan] Created Airtable record", createJson?.id);
    return NextResponse.json({ ok: true, airtableId: createJson?.id || null });
  } catch (err: any) {
    console.error("[api/yashvardhan] Server error:", err?.stack || err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
