// src/app/layout.tsx
import "./globals.css";
import React from "react";

export const metadata = {
  title: "Keystroke Collector",
  description: "Student keystroke data collector",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-white text-slate-900 font-sans antialiased">
        <div className="min-h-screen flex items-center justify-center px-4 py-10">
          <main className="w-full max-w-2xl">
            <div className="bg-white shadow-subtle rounded-lg p-6 border border-gray-100">
              {children}
            </div>
            <footer className="text-center text-sm text-gray-500 mt-6">Built for keystroke research</footer>
          </main>
        </div>
      </body>
    </html>
  );
}
