// src/app/api/yashvardhan/route.ts
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const PUBLIC_DIR = path.join(process.cwd(), "public");
const RAW_JSONL = path.join(PUBLIC_DIR, "keystroke_raw_sessions.jsonl");
const CSV_FILE = path.join(PUBLIC_DIR, "keystroke_features.csv");
const CSV_HEADER = "session_id,user_id,age,gender,year_of_study,device_type,keyboard_type,question_id,question_text,prompt_context,window_start_ts,window_end_ts,duration_ms,n_keydowns,n_keyups,chars_per_sec,dwell_mean_ms,dwell_std_ms,dwell_median_ms,dwell_p10_ms,dwell_p90_ms,dd_mean_ms,dd_std_ms,dd_median_ms,pauses_gt_200,pauses_gt_500,pauses_gt_1000,longest_pause_ms,backspace_count,cv_dwell,cv_dd,hist_bin_0,hist_bin_1,hist_bin_2,hist_bin_3,hist_bin_4,hist_bin_5,inter_entropy,label_raw,raw_events_path";

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
    const body = await req.json();
    const { csv_row, raw_session } = body;
    ensurePublicFiles();

    // append raw jsonl
    if (raw_session) {
      const line = JSON.stringify(raw_session) + "\n";
      fs.appendFileSync(RAW_JSONL, line, { encoding: "utf8" });
    }

    // append csv row
    if (csv_row) {
      // sanitize newline
      const safeRow = String(csv_row).replace(/\r?\n/g, " ");
      fs.appendFileSync(CSV_FILE, safeRow + "\n", { encoding: "utf8" });
    }

    return NextResponse.json({ status: "ok" });
  } catch (err) {
    console.error("POST /api/yashvardhan error:", err);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
