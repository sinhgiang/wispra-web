'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { MicIcon, GlobeIcon, SparkleIcon, BoltIcon, ShieldIcon, InjectIcon } from './icons'

const GITHUB_URL = 'https://github.com/sinhgiang/wispra'
const DOWNLOAD_WIN = 'https://github.com/sinhgiang/wispra/releases/download/v0.2.3/Wispra-Setup-0.2.3.exe'
const DOWNLOAD_MAC = 'https://github.com/sinhgiang/wispra/releases/latest/download/Wispra-latest-arm64.dmg'
const VERSION = 'v0.2.3'

const DEMO_PHRASES = [
  'Schedule the team sync for Monday at 10 AM and send the invite.',
  'Dear Sarah, following up on our conversation from yesterday.',
  'Add "review pull request 42" to my task list for this afternoon.',
  'The Q3 revenue is up 18% compared to last quarter — great work.',
]

const FEATURES = [
  {
    Icon: BoltIcon,
    title: 'Works in any app, instantly',
    desc: 'Gmail, Slack, VS Code, Notion, Word — any text field on screen. Text lands exactly where your cursor is. No copy-paste, no window switching.',
  },
  {
    Icon: GlobeIcon,
    title: '95+ languages, auto-detected',
    desc: 'Speak in English, Spanish, French, Japanese, or dozens more — or switch mid-sentence. Wispra detects the language automatically. No toggles.',
  },
  {
    Icon: MicIcon,
    title: 'One hotkey, zero setup',
    desc: 'Press Ctrl+Shift+Space from anywhere. A floating mic appears near your cursor. Speak. Done. No window switching, no configuration.',
  },
  {
    Icon: SparkleIcon,
    title: 'AI cleans it up before you see it',
    desc: 'Filler words removed. Grammar fixed. Punctuation added. What gets typed is already polished — before it reaches your app.',
  },
  {
    Icon: ShieldIcon,
    title: 'Privacy-first by design',
    desc: 'Audio goes mic → Groq → your screen. Wispra never stores your voice or text. No accounts required. Your API key, your data.',
  },
  {
    Icon: InjectIcon,
    title: '3× faster than typing',
    desc: 'You speak at 150 WPM. You type at 40. Wispra closes that gap permanently — for emails, documents, messages, code comments, anything.',
  },
]

const WHO_ITS_FOR = [
  {
    role: 'Professionals & managers',
    pain: 'Emails, meeting notes, and Slack replies eat your day.',
    outcome: 'Dictate in plain speech — Wispra types polished sentences directly into whatever is on screen. What took 10 minutes now takes 90 seconds.',
    accent: 'from-brand/10 to-transparent border-brand/20',
    color: 'text-brand',
  },
  {
    role: 'Writers & content creators',
    pain: 'Your best ideas arrive faster than your fingers can type.',
    outcome: 'Speak your first draft at your natural thinking pace. AI cleans it up on the way out. You see finished sentences, not raw transcription.',
    accent: 'from-purple-500/10 to-transparent border-purple-500/20',
    color: 'text-purple-400',
  },
  {
    role: 'Developers & power users',
    pain: 'Switching windows to dictate kills your flow state.',
    outcome: 'One hotkey from any app — VS Code, terminal, browser. Text lands where your cursor is. Clipboard untouched. Focus preserved.',
    accent: 'from-emerald-500/10 to-transparent border-emerald-500/20',
    color: 'text-emerald-400',
  },
]

const FAQS = [
  {
    q: 'Is Wispra really free?',
    a: 'Yes. Wispra is free to download and use. It runs on Groq\'s transcription API, which has a generous free tier — enough for hundreds of dictation minutes per day. You sign up for a free Groq account at groq.com (takes 30 seconds, no credit card), copy your API key into Wispra\'s Settings, and you\'re done.',
  },
  {
    q: 'What is a Groq API key and why do I need one?',
    a: 'Groq is the AI service that converts your speech to text — it\'s what makes Wispra fast and accurate. Your API key is like a personal password that lets Wispra use Groq on your behalf. It\'s free. Getting one takes 30 seconds at groq.com. This also means your audio never passes through Wispra\'s servers — it goes directly to Groq and back.',
  },
  {
    q: 'Which languages does it support?',
    a: 'Wispra supports 95+ languages through Whisper Large v3 Turbo. English, Spanish, French, German, Japanese, Chinese, Korean, Portuguese, and many more — all auto-detected. Just speak; Wispra figures out the language.',
  },
  {
    q: 'Does it work with any app?',
    a: 'Yes. Wispra works at the OS level — it injects text directly wherever your cursor is. Gmail, Slack, VS Code, Word, Notion, web browsers, terminal — any text field on Windows or macOS.',
  },
  {
    q: 'Is my voice data stored anywhere?',
    a: 'No. Your audio is sent to Groq for transcription and immediately discarded. Wispra never records, stores, or sees your audio or text. Zero data retention — by design.',
  },
]

const COMPARISON = [
  { feature: 'Price', wispra: 'Free (your own API key)', wispr: '$15/month', superwhisper: '$8.49/month' },
  { feature: 'Windows support', wispra: '✓ Native, fast', wispr: '⚠ Slow to start (~8s)', superwhisper: '✗ Mac only' },
  { feature: 'Data privacy', wispra: '✓ Audio never stored', wispr: '⚠ Privacy incident (2025)', superwhisper: '✓ Local option' },
  { feature: '95+ languages', wispra: '✓ Auto-detect', wispr: '✓', superwhisper: '✓' },
  { feature: 'AI cleanup', wispra: '✓ Included free', wispr: '✓', superwhisper: '✓ Paid tier' },
  { feature: 'No account needed', wispra: '✓', wispr: '✗ Account required', superwhisper: '✗ Account required' },
]

function DemoCard() {
  const [phase, setPhase] = useState<'idle' | 'recording' | 'done'>('idle')
  const [typed, setTyped] = useState('')
  const [phraseIdx, setPhraseIdx] = useState(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    function run() {
      const phrase = DEMO_PHRASES[phraseIdx % DEMO_PHRASES.length]!
      setPhase('idle')
      setTyped('')
      timerRef.current = setTimeout(() => {
        setPhase('recording')
        timerRef.current = setTimeout(() => {
          setPhase('done')
          let i = 0
          const step = () => {
            setTyped(phrase.slice(0, i + 1))
            i++
            if (i < phrase.length) timerRef.current = setTimeout(step, 22)
            else timerRef.current = setTimeout(() => setPhraseIdx((p) => p + 1), 2800)
          }
          step()
        }, 2000)
      }, 900)
    }
    run()
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [phraseIdx])

  return (
    <div className="relative w-full max-w-sm mx-auto select-none">
      <div className="absolute inset-0 rounded-2xl bg-brand opacity-10 blur-3xl scale-110 pointer-events-none" />
      <div className="relative rounded-2xl bg-bg-card border border-white/10 p-5 shadow-2xl">
        <div className="flex items-center gap-2 mb-4">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-[#FF5F56]" />
            <div className="w-3 h-3 rounded-full bg-[#FFBD2E]" />
            <div className="w-3 h-3 rounded-full bg-[#27C93F]" />
          </div>
          <span className="ml-2 text-text-muted text-xs">Gmail · Slack · VS Code · Word · anywhere</span>
        </div>
        <div className="bg-[#0A0A1A] rounded-lg p-4 min-h-[80px] font-mono text-sm text-text-primary leading-relaxed mb-4">
          {typed || <span className="text-text-muted">{phase === 'recording' ? 'Listening…' : 'Waiting…'}</span>}
          {phase === 'done' && typed && (
            <span className="inline-block w-0.5 h-4 bg-brand ml-0.5 animate-pulse align-middle" />
          )}
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              {phase === 'recording' && (
                <div className="absolute inset-0 rounded-full bg-[#E5484D] ring-pulse" />
              )}
              <div className={`relative w-10 h-10 rounded-full flex items-center justify-center transition-colors duration-300 ${
                phase === 'recording' ? 'bg-[#E5484D]' :
                phase === 'done' ? 'bg-[#27C93F]' : 'bg-brand'
              }`}>
                {phase === 'done' ? (
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <MicIcon className="w-5 h-5 text-white" />
                )}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-text-primary">
                {phase === 'idle' ? 'Wispra — ready' : phase === 'recording' ? 'Recording…' : 'Text injected ✓'}
              </p>
              <p className="text-xs text-text-muted">
                {phase === 'idle' ? 'Ctrl+Shift+Space' : phase === 'recording' ? 'AI cleanup on' : 'Clipboard preserved'}
              </p>
            </div>
          </div>
          {phase === 'recording' && (
            <div className="flex items-end gap-0.5 h-6">
              {[3, 5, 7, 4, 6, 8, 3].map((h, i) => (
                <div key={i} className="w-1 bg-[#E5484D] rounded-full"
                  style={{ height: `${h * 3}px`, animation: `pulse 0.7s ease-in-out ${i * 0.08}s infinite alternate` }} />
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="absolute -top-3 -right-3 bg-bg-card2 border border-white/10 rounded-lg px-2.5 py-1 text-xs font-mono text-text-muted shadow">
        Ctrl+Shift+Space
      </div>
    </div>
  )
}

function CheckIcon() {
  return (
    <svg className="w-4 h-4 text-[#27C93F] flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
    </svg>
  )
}

function WinIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
    </svg>
  )
}

function AppleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  )
}

// FIX 4: Nav has NO links — only logo + Download button
function Nav() {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 16)
    window.addEventListener('scroll', fn)
    return () => window.removeEventListener('scroll', fn)
  }, [])

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? 'bg-bg-base/90 backdrop-blur-xl border-b border-white/5' : ''}`}>
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-brand flex items-center justify-center">
            <MicIcon className="w-4 h-4 text-white" />
          </div>
          <span className="font-semibold text-text-primary text-lg tracking-tight">Wispra</span>
        </div>
        <a href={DOWNLOAD_WIN}
          className="flex items-center gap-1.5 bg-brand hover:bg-brand-dark text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
          Download Free
        </a>
      </div>
    </nav>
  )
}

export default function Page() {
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  return (
    <>
      <Nav />

      {/* ── HERO ─────────────────────────────────────────── */}
      <section className="relative min-h-screen flex items-center pt-16 overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/3 left-1/4 w-[500px] h-[500px] bg-brand opacity-8 rounded-full blur-[140px]" />
          <div className="absolute top-1/4 right-1/4 w-80 h-80 bg-purple-600 opacity-6 rounded-full blur-[120px]" />
        </div>

        <div className="relative max-w-6xl mx-auto px-6 py-24 grid lg:grid-cols-2 gap-16 items-center">
          <div>
            {/* eyebrow — FIX 2: no mention of "API key" here */}
            <div className="inline-flex items-center gap-2 text-xs font-semibold text-brand bg-brand/10 border border-brand/20 px-3 py-1.5 rounded-full mb-6">
              <span className="w-1.5 h-1.5 bg-brand rounded-full animate-pulse" />
              Free to use · Windows &amp; Mac · 95+ languages
            </div>

            {/* headline */}
            <h1 className="text-5xl lg:text-6xl font-bold leading-[1.1] tracking-tight mb-5">
              <span className="text-text-primary">Stop losing hours</span>
              <br />
              <span className="gradient-text">to slow typing.</span>
            </h1>

            {/* FIX 5: subheadline shortened to 2 sentences */}
            <p className="text-lg text-text-muted leading-relaxed mb-8 max-w-lg">
              Press one hotkey. Speak. Wispra types your words — polished and punctuated —
              into any app on screen. Done in under 5 seconds.
            </p>

            {/* CTAs */}
            <div className="flex flex-wrap gap-3 mb-6">
              <a href={DOWNLOAD_WIN}
                className="inline-flex items-center gap-2.5 bg-brand hover:bg-brand-dark text-white font-semibold px-7 py-3.5 rounded-xl transition-all hover:scale-[1.02] hover:shadow-[0_0_40px_rgba(79,110,247,0.45)] shadow-[0_0_20px_rgba(79,110,247,0.25)]">
                <WinIcon className="w-5 h-5" />
                Download for Windows — Free
              </a>
              <a href={DOWNLOAD_MAC}
                className="inline-flex items-center gap-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-text-primary font-semibold px-6 py-3.5 rounded-xl transition-all">
                <AppleIcon className="w-5 h-5" />
                macOS
              </a>
            </div>

            {/* social proof strip — directly below CTA */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-text-muted">
              <span className="flex items-center gap-1.5"><CheckIcon /> No subscription — ever</span>
              <span className="flex items-center gap-1.5"><CheckIcon /> No account needed</span>
              <span className="flex items-center gap-1.5"><CheckIcon /> {VERSION} · Auto-updates</span>
            </div>
          </div>

          <div className="flex justify-center lg:justify-end">
            <DemoCard />
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ─────────────────────────────────── */}
      <section className="border-t border-white/5 py-20">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-xs font-semibold uppercase tracking-widest text-brand mb-3">How it works</p>
            <h2 className="text-3xl font-bold text-text-primary">Up and running in 60 seconds</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8 relative">
            {[
              {
                n: '1',
                title: 'Download and open Settings',
                /* FIX 2: explain Groq in plain English */
                desc: 'Install Wispra, then get a free API key from groq.com — takes 30 seconds, no credit card. Paste it into Wispra\'s Settings. Done.',
              },
              {
                n: '2',
                title: 'Press the hotkey and speak',
                desc: 'Ctrl+Shift+Space from any app. A floating mic icon appears near your cursor. Speak naturally in any language.',
              },
              {
                n: '3',
                title: 'Text appears, already polished',
                desc: 'AI removes filler words, fixes grammar, adds punctuation — and types the result where your cursor is. In under 5 seconds.',
              },
            ].map((step, i) => (
              <div key={i} className="relative text-center">
                {i < 2 && (
                  <div className="hidden md:block absolute top-6 left-[calc(50%+28px)] right-[calc(-50%+28px)] h-px bg-gradient-to-r from-brand/30 to-brand/5" />
                )}
                <div className="w-12 h-12 rounded-full bg-brand/15 border border-brand/30 flex items-center justify-center mx-auto mb-5">
                  <span className="text-brand font-bold text-lg">{step.n}</span>
                </div>
                <h3 className="text-base font-semibold text-text-primary mb-2">{step.title}</h3>
                <p className="text-text-muted text-sm leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
          {/* FIX 2: clear CTA for Groq key */}
          <div className="text-center mt-10">
            <a href="https://console.groq.com" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-brand hover:underline">
              Get your free Groq key at console.groq.com →
            </a>
            <p className="text-xs text-text-muted mt-1">Free tier · No credit card · 30-second signup</p>
          </div>
        </div>
      </section>

      {/* ── 6 FEATURES ───────────────────────────────────── */}
      <section className="border-t border-white/5 py-20">
        <div className="max-w-6xl mx-auto px-6">
          <div className="mb-12">
            <p className="text-xs font-semibold uppercase tracking-widest text-brand mb-3">Features</p>
            <h2 className="text-3xl font-bold text-text-primary mb-3">Everything you need. Nothing you don't.</h2>
            <p className="text-text-muted max-w-lg">
              Wispra does one thing and does it fast — voice to text, anywhere, in any language.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f) => (
              <div key={f.title} className="glow-card bg-bg-card rounded-xl p-6 group">
                <div className="w-10 h-10 rounded-lg bg-brand/10 border border-brand/20 flex items-center justify-center mb-4 group-hover:bg-brand/20 transition-colors">
                  <f.Icon className="w-5 h-5 text-brand" />
                </div>
                <h3 className="text-sm font-semibold text-text-primary mb-2">{f.title}</h3>
                <p className="text-xs text-text-muted leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHO IT'S FOR — FIX 1: replaces fake testimonials ── */}
      <section className="border-t border-white/5 py-20">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-xs font-semibold uppercase tracking-widest text-brand mb-3">Who it's for</p>
            <h2 className="text-3xl font-bold text-text-primary">Built for people who write every day</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {WHO_ITS_FOR.map((w) => (
              <div key={w.role} className={`rounded-xl border bg-gradient-to-br p-6 ${w.accent}`}>
                <p className={`text-xs font-semibold uppercase tracking-widest mb-3 ${w.color}`}>{w.role}</p>
                <p className="text-base font-semibold text-text-primary mb-3">"{w.pain}"</p>
                <p className="text-sm text-text-muted leading-relaxed">{w.outcome}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── COMPARISON TABLE ─────────────────────────────── */}
      <section className="border-t border-white/5 py-20">
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-xs font-semibold uppercase tracking-widest text-brand mb-3">Comparison</p>
            <h2 className="text-3xl font-bold text-text-primary">How Wispra stacks up</h2>
          </div>
          <div className="rounded-2xl border border-white/8 overflow-hidden">
            <div className="grid grid-cols-4 bg-bg-card2 px-5 py-3 text-xs font-semibold uppercase tracking-widest text-text-muted">
              <span></span>
              <span className="text-brand">Wispra</span>
              <span>Wispr Flow</span>
              <span>Superwhisper</span>
            </div>
            {COMPARISON.map((row, i) => (
              <div key={i} className={`grid grid-cols-4 px-5 py-4 text-sm border-t border-white/5 ${i % 2 === 0 ? 'bg-bg-card' : 'bg-bg-base'}`}>
                <span className="text-text-muted font-medium">{row.feature}</span>
                <span className="text-text-primary font-semibold">{row.wispra}</span>
                <span className="text-text-muted">{row.wispr}</span>
                <span className="text-text-muted">{row.superwhisper}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-text-muted text-center mt-4">
            Wispr Flow: TechCrunch Nov 2025 · Superwhisper: superwhisper.com June 2026
          </p>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────── */}
      <section className="border-t border-white/5 py-20">
        <div className="max-w-3xl mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-xs font-semibold uppercase tracking-widest text-brand mb-3">FAQ</p>
            <h2 className="text-3xl font-bold text-text-primary">Common questions</h2>
          </div>
          <div className="space-y-2">
            {FAQS.map((faq, i) => (
              <div key={i} className="border border-white/8 rounded-xl overflow-hidden">
                <button
                  className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/3 transition-colors"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                >
                  <span className="text-sm font-semibold text-text-primary">{faq.q}</span>
                  <svg className={`w-4 h-4 text-text-muted flex-shrink-0 ml-4 transition-transform ${openFaq === i ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {openFaq === i && (
                  <div className="px-5 pb-4">
                    <p className="text-sm text-text-muted leading-relaxed">{faq.a}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ────────────────────────────────────── */}
      <section className="border-t border-white/5 py-24">
        <div className="max-w-6xl mx-auto px-6">
          <div className="relative rounded-2xl overflow-hidden border border-brand/20 bg-gradient-to-br from-bg-card via-[#0D1035] to-bg-card p-12 text-center">
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-80 h-40 bg-brand opacity-15 blur-[80px]" />
            </div>
            <div className="relative">
              <h2 className="text-4xl font-bold text-text-primary mb-3">
                Start speaking. Stop typing.
              </h2>
              <p className="text-text-muted mb-8 max-w-md mx-auto text-lg">
                Free download. Works on Windows and macOS. Setup takes 60 seconds.
              </p>
              <div className="flex flex-wrap justify-center gap-4 mb-6">
                <a href={DOWNLOAD_WIN}
                  className="inline-flex items-center gap-2.5 bg-brand hover:bg-brand-dark text-white font-semibold px-8 py-4 rounded-xl transition-all hover:scale-[1.02] hover:shadow-[0_0_50px_rgba(79,110,247,0.5)] shadow-[0_0_24px_rgba(79,110,247,0.3)] text-base">
                  <WinIcon className="w-5 h-5" />
                  Download for Windows — Free
                </a>
                <a href={DOWNLOAD_MAC}
                  className="inline-flex items-center gap-2.5 bg-white/8 hover:bg-white/12 border border-white/15 text-text-primary font-semibold px-7 py-4 rounded-xl transition-all text-base">
                  <AppleIcon className="w-5 h-5" />
                  Download for macOS
                </a>
              </div>
              <div className="flex flex-wrap justify-center items-center gap-x-6 gap-y-2 text-sm text-text-muted">
                <span className="flex items-center gap-1.5"><CheckIcon /> No subscription — free Groq key covers daily use</span>
                <span className="flex items-center gap-1.5"><CheckIcon /> No account needed</span>
                <span className="flex items-center gap-1.5"><CheckIcon /> {VERSION} · Auto-updates</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────── */}
      <footer className="border-t border-white/5 py-10">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-brand flex items-center justify-center">
              <MicIcon className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-sm font-semibold text-text-primary">Wispra</span>
            <span className="text-xs text-text-muted">{VERSION}</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-text-muted">
            {([['GitHub', GITHUB_URL], ['Changelog', `${GITHUB_URL}/releases`], ['Support', `${GITHUB_URL}/issues`]] as [string, string][]).map(([label, href]) => (
              <Link key={label} href={href} target="_blank" rel="noopener noreferrer"
                className="hover:text-text-primary transition-colors">
                {label}
              </Link>
            ))}
          </div>
          <p className="text-xs text-text-muted">© 2026 Wispra. Free &amp; open-source.</p>
        </div>
      </footer>
    </>
  )
}
