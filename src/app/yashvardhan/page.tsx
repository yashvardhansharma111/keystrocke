// src/app/yashvardhan/page.tsx
"use client";
import React, { useEffect, useState } from "react";

export default function YashvardhanPage() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [sizeBytes, setSizeBytes] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // check if CSV exists (HEAD or fetch meta)
  useEffect(() => {
    async function check() {
      try {
        const res = await fetch("/api/yashvardhan", { method: "HEAD" });
        if (res.ok) {
          setAvailable(true);
          const contentLength = res.headers.get("content-length");
          setSizeBytes(contentLength ? parseInt(contentLength, 10) : null);
        } else {
          setAvailable(false);
        }
      } catch (err) {
        setAvailable(false);
      }
    }
    check();
  }, []);

  async function handleDownload() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/yashvardhan", { method: "GET" });
      if (!res.ok) throw new Error("CSV not available");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "keystroke_features.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err?.message || "Download failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold text-primary mb-3">Admin: Download dataset</h1>

      <div className="bg-white border rounded-lg p-6 shadow-subtle">
        <p className="text-sm text-gray-700 mb-4">
          This page is the only place that can download <code>keystroke_features.csv</code>. Students using the
          test page will not see any download options.
        </p>

        <div className="mb-4">
          <div className="text-sm text-gray-600">CSV available:</div>
          <div className="mt-1 font-medium">{available === null ? "Checking..." : available ? "Yes" : "No"}</div>
          {sizeBytes ? <div className="text-xs text-gray-500 mt-1">Size: {(sizeBytes/1024).toFixed(2)} KB</div> : null}
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleDownload}
            disabled={!available || loading}
            className="px-4 py-2 rounded-md border border-purple-600 text-purple-600 bg-white hover:bg-purple-50 active:bg-purple-100 transition-colors focus:outline-none focus:ring-2 focus:ring-purple-300 disabled:opacity-60"
          >
            {loading ? "Downloading..." : "Download via API"}
          </button>

          <a
            href="/keystroke_features.csv"
            download
            className="px-4 py-2 rounded-md border border-purple-600 text-purple-600 bg-white hover:bg-purple-50 active:bg-purple-100 transition-colors focus:outline-none focus:ring-2 focus:ring-purple-300"
          >
            Direct Public CSV
          </a>

          <button
            onClick={() => (window.location.href = "/")}
            className="px-3 py-2 rounded-md border border-purple-600 text-purple-600 bg-white hover:bg-purple-50 active:bg-purple-100 transition-colors focus:outline-none focus:ring-2 focus:ring-purple-300"
          >
            Back to Collect
          </button>
        </div>

        {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
        <div className="mt-4 text-xs text-gray-500">
          Note: If deploying on platforms where filesystem writes are ephemeral (e.g., Vercel), ensure your POST handler
          writes to persistent storage (S3 or a DB). Local dev servers will persist to <code>/public</code>.
        </div>
      </div>
    </div>
  );
}
