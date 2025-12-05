"use client";

import Link from "next/link";
import { useState } from "react";

export function Navigation() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="border-b border-slate-200 bg-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <nav className="flex items-center justify-between h-16">
          <Link href="/clearsettle" className="flex items-center gap-2">
            <span className="text-2xl">🔐</span>
            <span className="font-bold text-lg text-slate-900">ClearSettle</span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-8">
            <Link
              href="/clearsettle"
              className="text-sm font-medium text-slate-700 hover:text-emerald-600 transition-colors"
            >
              Dashboard
            </Link>
            <Link
              href="/security-demo"
              className="text-sm font-medium text-slate-700 hover:text-emerald-600 transition-colors"
            >
              Security Demo
            </Link>
            <Link
              href="/oracle-dashboard"
              className="text-sm font-medium text-slate-700 hover:text-emerald-600 transition-colors"
            >
              Oracle Health
            </Link>
            <Link
              href="/finality-tracker"
              className="text-sm font-medium text-slate-700 hover:text-emerald-600 transition-colors"
            >
              Finality Tracker
            </Link>
          </div>

          {/* Mobile Navigation Button */}
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="md:hidden p-2 text-slate-700 hover:text-emerald-600"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </nav>

        {/* Mobile Navigation Menu */}
        {isOpen && (
          <div className="md:hidden pb-4 space-y-2">
            <Link
              href="/clearsettle"
              className="block px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded"
              onClick={() => setIsOpen(false)}
            >
              Dashboard
            </Link>
            <Link
              href="/security-demo"
              className="block px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded"
              onClick={() => setIsOpen(false)}
            >
              Security Demo
            </Link>
            <Link
              href="/oracle-dashboard"
              className="block px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded"
              onClick={() => setIsOpen(false)}
            >
              Oracle Health
            </Link>
            <Link
              href="/finality-tracker"
              className="block px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded"
              onClick={() => setIsOpen(false)}
            >
              Finality Tracker
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
