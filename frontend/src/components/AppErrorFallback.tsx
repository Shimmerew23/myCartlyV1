// Fallback shown when a render error bubbles to the app-level Sentry ErrorBoundary.
// Branded to the design system (navy #1A237E, Manrope, sharp radii).
export default function AppErrorFallback() {
  return (
    <div role="alert" className="min-h-screen flex flex-col items-center justify-center bg-white px-6 text-center">
      <h1 className="font-headline text-3xl font-bold text-primary-900">
        Something went wrong
      </h1>
      <p className="mt-3 max-w-md font-body text-gray-600">
        An unexpected error occurred. Please reload the page — if the problem
        persists, try again in a few minutes.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-6 rounded-md bg-primary-900 px-6 py-3 font-body text-sm font-semibold text-white transition-colors hover:bg-primary-800"
      >
        Reload page
      </button>
    </div>
  );
}
