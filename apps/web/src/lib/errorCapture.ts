/**
 * Global error capture — stores recent errors in localStorage
 * so they can be included in bug reports, even after page refresh.
 */

const STORAGE_KEY = 'syncsit_recent_errors';
const MAX_ERRORS = 20;
const MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

interface CapturedError {
  message: string;
  source?: string;
  timestamp: string;
}

function getStoredErrors(): CapturedError[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const errors: CapturedError[] = JSON.parse(raw);
    // Filter out old errors
    const cutoff = Date.now() - MAX_AGE_MS;
    return errors.filter((e) => new Date(e.timestamp).getTime() > cutoff);
  } catch {
    return [];
  }
}

function storeError(error: CapturedError) {
  try {
    const errors = getStoredErrors();
    errors.push(error);
    // Keep only the most recent
    const trimmed = errors.slice(-MAX_ERRORS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // localStorage full or unavailable
  }
}

/**
 * Get recent errors for display in the report page.
 */
export function getRecentErrors(): CapturedError[] {
  return getStoredErrors();
}

/**
 * Format errors for inclusion in an email body.
 */
export function formatErrorsForEmail(): string {
  const errors = getStoredErrors();
  if (errors.length === 0) return 'None';
  return errors
    .map((e) => `[${e.timestamp}] ${e.message}${e.source ? ` (${e.source})` : ''}`)
    .join('\n');
}

/**
 * Initialize global error capture. Call once at app startup.
 */
export function initErrorCapture() {
  // Capture unhandled JS errors
  window.addEventListener('error', (event) => {
    storeError({
      message: event.message || 'Unknown error',
      source: event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined,
      timestamp: new Date().toISOString(),
    });
  });

  // Capture unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    const message = event.reason?.message || event.reason?.toString() || 'Unhandled promise rejection';
    storeError({
      message,
      source: 'promise',
      timestamp: new Date().toISOString(),
    });
  });

  // Capture console.error calls
  const originalConsoleError = console.error;
  console.error = (...args: any[]) => {
    originalConsoleError.apply(console, args);
    const message = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ').slice(0, 500);
    if (!message.includes('syncsit_recent_errors')) {
      storeError({
        message,
        source: 'console.error',
        timestamp: new Date().toISOString(),
      });
    }
  };
}
