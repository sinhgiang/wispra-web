import { after } from 'next/server'

/**
 * Runs `task` once the response has been sent, so the caller does not wait for
 * it (Vercel keeps the function alive until it ends). Outside a request (tests,
 * scripts) Next.js has nowhere to schedule it, so it runs now and is awaited.
 */
export async function afterResponse(task: () => Promise<unknown>): Promise<void> {
  try {
    after(task)
    return
  } catch {
    // No request scope: run it here.
  }
  await task()
}
