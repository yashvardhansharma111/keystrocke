// src/components/Collector.tsx
"use client";
import React, { useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";

/**
 * Collector component
 * - 5 questions x 20s
 * - record keydown/keyup events inside textarea
 * - compute features client-side
 * - POST raw session + CSV row to /api/yashvardhan
 * - persist in localStorage
 */

// Replace or use these exact prompts
const QUESTIONS = [
  "Tell a short example of a recent class or college day that went well.",
  "Describe a small, real annoyance you face at college (examples: gossip, faculty attitude, daily routine fatigue).",
  "How are you feeling about upcoming exams or assignments this semester?",
  "Mention one non-academic issue bothering you lately (sleep, money, relationships, commute).",
  "What do you usually do to relax after a busy day?"
];

const CSV_HEADER = [
  "session_id","user_id","age","gender","year_of_study","device_type","keyboard_type","question_id","question_text","prompt_context","window_start_ts","window_end_ts","duration_ms","n_keydowns","n_keyups","chars_per_sec","dwell_mean_ms","dwell_std_ms","dwell_median_ms","dwell_p10_ms","dwell_p90_ms","dd_mean_ms","dd_std_ms","dd_median_ms","pauses_gt_200","pauses_gt_500","pauses_gt_1000","longest_pause_ms","backspace_count","cv_dwell","cv_dd","hist_bin_0","hist_bin_1","hist_bin_2","hist_bin_3","hist_bin_4","hist_bin_5","inter_entropy","label_raw","raw_events_path"
].join(",");

function nowMs() {
  return Date.now();
}

// Helper: robust feature extraction (same rules as earlier)
function extractFeaturesFromEvents(events: any[], windowStart: number, windowEnd: number) {
  if (!events || events.length === 0) return null;
  const evs = [...events].sort((a,b) => a.timestamp_ms - b.timestamp_ms);
  const duration_ms = windowEnd - windowStart;
  const keydowns = evs.filter(e => e.event_type === "keydown");
  const keyups = evs.filter(e => e.event_type === "keyup");
  const n_keydowns = keydowns.length;
  const n_keyups = keyups.length;
  const chars_per_sec = +(n_keydowns / ((duration_ms / 1000) || 1)).toFixed(4);

  // pair dwell times using stack per key
  const downStacks: Record<string, number[]> = {};
  const dwell: number[] = [];
  for (const e of evs) {
    const k = String(e.key);
    if (e.event_type === "keydown") {
      downStacks[k] = downStacks[k] || [];
      downStacks[k].push(e.timestamp_ms);
    } else {
      if (downStacks[k] && downStacks[k].length > 0) {
        const downTs = downStacks[k].pop()!;
        dwell.push(e.timestamp_ms - downTs);
      }
    }
  }

  // inter-event diffs
  const inter: number[] = [];
  for (let i = 1; i < evs.length; i++) {
    inter.push(evs[i].timestamp_ms - evs[i-1].timestamp_ms);
  }

  // down->down intervals
  const downTimes = keydowns.map(k => k.timestamp_ms);
  const dd: number[] = [];
  for (let i = 1; i < downTimes.length; i++) dd.push(downTimes[i] - downTimes[i-1]);

  const stats = (a: number[]) => {
    const arr = a.slice().sort((x,y)=>x-y);
    if (!arr.length) return { count:0, mean:0, std:0, median:0, min:0, max:0, p10:0, p90:0 };
    const mean = arr.reduce((s,v)=>s+v,0)/arr.length;
    const std = Math.sqrt(arr.reduce((s,v)=>s+(v-mean)**2,0)/arr.length);
    const median = arr[Math.floor(arr.length/2)];
    const p = (p: number) => arr[Math.floor((p/100)*arr.length)];
    return { count: arr.length, mean, std, median, min: arr[0], max: arr[arr.length-1], p10: p(10), p90: p(90) };
  };

  const dwellStats = stats(dwell);
  const ddStats = stats(dd);
  const interStats = stats(inter);

  const pauses_gt_200 = inter.filter(x=>x>200).length;
  const pauses_gt_500 = inter.filter(x=>x>500).length;
  const pauses_gt_1000 = inter.filter(x=>x>1000).length;
  const longest_pause = inter.length ? Math.max(...inter) : 0;
  const backspace_count = evs.filter(e => e.event_type==='keydown' && String(e.key).toLowerCase()==='backspace').length;

  // histogram bins for inter-event
  const bins = [0,50,100,200,500,1000,Number.POSITIVE_INFINITY];
  const hist = new Array(bins.length-1).fill(0);
  for (const v of inter) {
    for (let i=0;i<bins.length-1;i++){
      if (v>=bins[i] && v<bins[i+1]) { hist[i]++; break; }
    }
  }
  const totalHist = hist.reduce((s,n)=>s+n,0);
  const probs = hist.map(h => totalHist ? h/totalHist : 0);
  const entropy = -probs.reduce((s,p) => p>0 ? s + p*Math.log(p) : s, 0);

  const cv = (mean:number, std:number) => mean ? std/mean : 0;

  return {
    duration_ms,
    n_keydowns,
    n_keyups,
    chars_per_sec,
    dwell_mean_ms: +dwellStats.mean.toFixed(3),
    dwell_std_ms: +dwellStats.std.toFixed(3),
    dwell_median_ms: +dwellStats.median.toFixed(3),
    dwell_p10_ms: +dwellStats.p10.toFixed(3),
    dwell_p90_ms: +dwellStats.p90.toFixed(3),
    dd_mean_ms: +ddStats.mean.toFixed(3),
    dd_std_ms: +ddStats.std.toFixed(3),
    dd_median_ms: +ddStats.median.toFixed(3),
    pauses_gt_200,
    pauses_gt_500,
    pauses_gt_1000,
    longest_pause_ms: longest_pause,
    backspace_count,
    cv_dwell: +cv(dwellStats.mean, dwellStats.std).toFixed(4),
    cv_dd: +cv(ddStats.mean, ddStats.std).toFixed(4),
    hist_bin_0: hist[0]||0,
    hist_bin_1: hist[1]||0,
    hist_bin_2: hist[2]||0,
    hist_bin_3: hist[3]||0,
    hist_bin_4: hist[4]||0,
    hist_bin_5: hist[5]||0,
    inter_entropy: +entropy.toFixed(6)
  };
}

export default function Collector() {
  // user info
  const [user, setUser] = useState<{ user_id: string, age?: string, gender?: string, year?: string }>(() => {
    const stored = typeof window !== "undefined" && localStorage.getItem("kc_user");
    if (stored) return JSON.parse(stored);
    return { user_id: uuidv4(), age: "", gender: "", year: "" };
  });

  const [step, setStep] = useState<"intro"|"collect"|"done">("intro");
  const [qIndex, setQIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(20);
  const [recording, setRecording] = useState(false);
  const [awaitingRating, setAwaitingRating] = useState(false);
  const [csvRows, setCsvRows] = useState<string[]>(() => {
    try {
      const s = localStorage.getItem("kc_csvRows");
      return s ? JSON.parse(s) : [];
    } catch { return []; }
  });
  const [rawSessions, setRawSessions] = useState<any[]>(() => {
    try {
      const s = localStorage.getItem("kc_rawSessions");
      return s ? JSON.parse(s) : [];
    } catch { return []; }
  });

  const eventsRef = useRef<any[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement|null>(null);
  const windowStartRef = useRef<number>(0);

  useEffect(() => {
    localStorage.setItem("kc_user", JSON.stringify(user));
  }, [user]);

  useEffect(() => {
    localStorage.setItem("kc_csvRows", JSON.stringify(csvRows));
  }, [csvRows]);

  useEffect(() => {
    localStorage.setItem("kc_rawSessions", JSON.stringify(rawSessions));
  }, [rawSessions]);

  // manage countdown
  useEffect(() => {
    let t: any = null;
    if (recording) {
      t = setInterval(() => {
        setSecondsLeft(s => {
          if (s <= 1) {
            clearInterval(t);
            setRecording(false);
            setAwaitingRating(true);
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    }
    return () => { if (t) clearInterval(t); };
  }, [recording]);

  // attach key listeners to textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const handler = (e: KeyboardEvent) => {
      eventsRef.current.push({ timestamp_ms: nowMs(), event_type: e.type, key: (e as any).key });
    };
    el.addEventListener("keydown", handler as any);
    el.addEventListener("keyup", handler as any);
    const pasteHandler = (e: ClipboardEvent) => {
      e.preventDefault();
      // subtle user feedback optional
    };
    el.addEventListener("paste", pasteHandler as any);
    return () => {
      el.removeEventListener("keydown", handler as any);
      el.removeEventListener("keyup", handler as any);
      el.removeEventListener("paste", pasteHandler as any);
    };
  }, [qIndex, step]);

  function startTest() {
    setStep("collect");
    setQIndex(0);
    startQuestion(0);
  }

  function startQuestion(index: number) {
    eventsRef.current = [];
    windowStartRef.current = nowMs();
    setSecondsLeft(20);
    setRecording(true);
    setAwaitingRating(false);
    // reset textarea and focus
    setTimeout(() => { textareaRef.current && (textareaRef.current.value = ""); textareaRef.current && textareaRef.current.focus(); }, 50);
  }

  async function submitRatingAndProceed(rating: number) {
    const windowEnd = nowMs();
    const sessId = uuidv4();
    const sessionPayload = {
      session_id: sessId,
      user_id: user.user_id,
      age: user.age || "",
      gender: user.gender || "",
      year_of_study: user.year || "",
      question_id: qIndex + 1,
      question_text: QUESTIONS[qIndex],
      prompt_context: `Q${qIndex+1}`,
      window_start_ts: windowStartRef.current,
      window_end_ts: windowEnd,
      events: eventsRef.current,
      self_reported_stress: rating
    };

    // extract features
    const feats = extractFeaturesFromEvents(eventsRef.current, windowStartRef.current, windowEnd);
    // If too few keydowns, discard
    if (!feats || feats.n_keydowns < 5) {
      // discard but still proceed
      // optional: show user-friendly notice
      console.warn("Too few keystrokes; session not saved.");
    } else {
      // build CSV row aligned with header
      const meta = {
        session_id: sessId,
        user_id: user.user_id,
        age: user.age || "",
        gender: user.gender || "",
        year_of_study: user.year || "",
        device_type: navigator.userAgent,
        keyboard_type: "",
        question_id: qIndex + 1,
        question_text: QUESTIONS[qIndex],
        prompt_context: `Q${qIndex+1}`,
        window_start_ts: windowStartRef.current,
        window_end_ts: windowEnd,
        label_raw: rating,
        raw_events_path: ""
      };
      const rowVals = [
        meta.session_id, meta.user_id, meta.age, meta.gender, meta.year_of_study,
        meta.device_type, meta.keyboard_type, meta.question_id, `"${meta.question_text.replace(/"/g,'""')}"`,
        meta.prompt_context, meta.window_start_ts, meta.window_end_ts,
        feats.duration_ms, feats.n_keydowns, feats.n_keyups, feats.chars_per_sec,
        feats.dwell_mean_ms, feats.dwell_std_ms, feats.dwell_median_ms, feats.dwell_p10_ms, feats.dwell_p90_ms,
        feats.dd_mean_ms, feats.dd_std_ms, feats.dd_median_ms,
        feats.pauses_gt_200, feats.pauses_gt_500, feats.pauses_gt_1000,
        feats.longest_pause_ms, feats.backspace_count, feats.cv_dwell, feats.cv_dd,
        feats.hist_bin_0, feats.hist_bin_1, feats.hist_bin_2, feats.hist_bin_3, feats.hist_bin_4, feats.hist_bin_5,
        feats.inter_entropy, meta.label_raw, meta.raw_events_path
      ];
      const csvRow = rowVals.join(",");
      // append to local arrays
      setCsvRows(prev => {
        const next = [...prev, csvRow];
        return next;
      });
      setRawSessions(prev => [...prev, sessionPayload]);

      // POST to server to append to public files
      try {
        await fetch("/api/yashvardhan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csv_row: csvRow, raw_session: sessionPayload })
        });
      } catch (err) {
        console.error("Server append failed:", err);
      }
    }

    // move to next question or finish
    if (qIndex + 1 < QUESTIONS.length) {
      setQIndex(qIndex + 1);
      // small delay for UX
      setTimeout(() => startQuestion(qIndex + 1), 600);
    } else {
      setStep("done");
    }
  }

  // UI
  if (step === "intro") {
    return (
      <div>
        <h1 className="text-2xl font-semibold text-primary mb-2">Keystroke Study</h1>
        <p className="text-sm text-gray-600 mb-4">Answer 5 short prompts. Each prompt records typing for 20 seconds. After each, rate your stress (1–5).</p>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <input className="p-2 border rounded-md" placeholder="Age" value={user.age} onChange={e=>setUser({...user, age: e.target.value})} />
          <input className="p-2 border rounded-md" placeholder="Gender (optional)" value={user.gender} onChange={e=>setUser({...user, gender: e.target.value})} />
          <input className="p-2 border rounded-md col-span-2" placeholder="Year of study (e.g., 2)" value={user.year} onChange={e=>setUser({...user, year: e.target.value})} />
        </div>
        <div className="flex gap-3">
          <button className="px-4 py-2 rounded-md border border-purple-600 text-purple-600 bg-white hover:bg-purple-50 active:bg-purple-100 transition-colors focus:outline-none focus:ring-2 focus:ring-purple-300" onClick={startTest}>Start Test</button>
        </div>
      </div>
    );
  }

  if (step === "collect") {
    return (
      <div>
        <div className="text-sm text-muted text-center mb-2">Question {qIndex+1} of {QUESTIONS.length}</div>
        <div className="p-4 rounded-md border border-gray-100 mb-4">
          <p className="text-lg font-medium mb-3">{QUESTIONS[qIndex]}</p>
          <div className="flex items-center justify-between mb-2">
            <div className="text-4xl font-semibold text-purple-600">{secondsLeft}</div>
            <div className="text-sm text-gray-500">Type in the box — do not paste</div>
          </div>
          <textarea ref={textareaRef} className="w-full min-h-[140px] p-3 border border-gray-200 rounded-md focus:ring-2 focus:ring-purple-300 focus:border-purple-400 resize-none" />
          {awaitingRating ? (
            <div className="mt-4">
              <div className="text-sm text-gray-700 mb-2">How stressed were you while answering? (1 = not at all, 5 = extremely)</div>
              <div className="flex gap-2">
                {[1,2,3,4,5].map(r => (
                  <button
                    key={r}
                    onClick={() => submitRatingAndProceed(r)}
                    className="px-3 py-1.5 rounded-md border border-purple-600 text-purple-600 bg-white hover:bg-purple-50 active:bg-purple-100 transition-colors focus:outline-none focus:ring-2 focus:ring-purple-300"
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <div className="text-sm text-gray-500">Collected sessions (local): {csvRows.length}</div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-semibold">Thank you — data collected.</h2>
      <p className="mt-2 text-gray-600">Thanks for helping with the data. The researcher will collect the dataset separately.</p>
    </div>
  );
}
