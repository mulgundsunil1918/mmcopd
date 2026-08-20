import React from 'react';

/**
 * Per-page error boundary used ONLY in the public demo (the caller guards on
 * window.__CUREDESK_DEMO__). If a single screen throws — almost always because
 * the small mocked demo dataset doesn't cover some field a real DB would — this
 * keeps the sidebar, top bar and the rest of the app alive and shows a compact
 * inline message in the content area instead of blanking the whole showcase.
 *
 * It's mounted with key={pathname} in Layout, so React remounts it (clearing the
 * error) whenever the route changes — navigating to any other module recovers
 * automatically, with no full reload needed.
 */
export class RouteErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6 text-center">
        <div className="max-w-md">
          <div className="text-base font-bold text-gray-900 dark:text-slate-100 mb-2">
            This screen needs live clinic data
          </div>
          <div className="text-sm text-gray-500 dark:text-slate-400 mb-4">
            The demo runs on a small sample dataset, so a few detail screens can’t fully render here. Everything else in the sidebar works — pick another module to keep exploring.
          </div>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Reload the demo
          </button>
        </div>
      </div>
    );
  }
}
