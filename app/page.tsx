'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import {
  MicIcon, GlobeIcon, SparkleIcon, BoltIcon, LoopIcon, CommandIcon,
  TemplateIcon, VocabIcon, ContextIcon, HistoryIcon, FileAudioIcon,
  ServerIcon, ChartIcon, ExportIcon, ShieldIcon, InjectIcon, ModeIcon, KeyIcon,
} from './icons'

const GITHUB_URL = 'https://github.com/sinhgiang/wispra'
const DOWNLOAD_WIN = 'https://github.com/sinhgiang/wispra/releases/download/v0.2.2/Wispra-Setup-0.2.2.exe'
const DOWNLOAD_MAC = 'https://github.com/sinhgiang/wispra/releases/download/v0.2.2/Wispra-0.2.2-arm64.dmg'
const VERSION = 'v0.2.2'

const DEMO_PHRASES = [
  'Schedule a meeting with the team for Monday at 10 AM.',
  'Dear John, I wanted to follow up on our conversation yesterday.',
  'Add "review pull request #42" to my task list for this afternoon.',
  'The Q3 revenue is up 15% compared to last quarter — great work.',
]

const PAIN_POINTS = [
  {
    audience: 'Professionals',
    pain: 'You think at 400 WPM. You type at 60.',
    solution: 'Wispra closes that gap. Meeting notes, emails, Slack replies — dictated and typed in under a second, in whatever app is focused. No copy-paste, no window switching.',
    color: 'from-brand/10 to-transparent border-brand/20',
    accent: 'text-brand',
  },
  {
    audience: 'Writers & Creators',
    pain: 'The best ideas vanish before your fingers catch up',
    solution: 'Speak at your natural pace. Wispra captures every word, removes filler, fixes grammar — so the first draft is already clean before you see it.',
    color: 'from-purple-500/10 to-transparent border-purple-500/20',
    accent: 'text-purple-400',
  },
  {
    audience: 'Developers & Power Users',
    pain: 'Context switching kills your flow',
    solution: 'One hotkey from anywhere — VS Code, Slack, browser, terminal. Text lands exactly where your cursor is. Clipboard untouched. Focus preserved.',
    color: 'from-emerald-500/10 to-transparent border-emerald-500/20',
    accent: 'text-emerald-400',
  },
]

const FEATURES_CORE = [
  {
    Icon: MicIcon,
    title: 'Global hotkey dictation',
    desc: 'Press Ctrl+Shift+Space from any app, any screen. A floating icon appears near your cursor — speak, release, done.',
  },
  {
    Icon: GlobeIcon,
    title: '100+ language auto-detection',
    desc: 'Dictate in any language — or switch mid-sentence. Wispra detects it automatically. No manual toggle, no language setting to change.',
  },
  {
    Icon: BoltIcon,
    title: 'Under 1 second',
    desc: 'Powered by Groq Whisper Large v3 Turbo — the fastest transcription API available. You finish speaking; text appears instantly.',
  },
  {
    Icon: InjectIcon,
    title: 'Works in any app',
    desc: 'Notepad, Chrome, VS Code, Outlook, Slack, Zalo, Word — any text field, web or desktop. Text is injected directly, clipboard untouched.',
  },
]

const FEATURES_AI = [
  {
    Icon: SparkleIcon,
    title: 'AI cleanup & punctuation',
    desc: 'LLaMA removes filler words (like, um, you know), fixes grammar, and adds full punctuation — all before the text reaches your app.',
  },
  {
    Icon: ModeIcon,
    title: 'Dictation modes',
    desc: 'General, Professional, Casual, Email and more — each with a tailored AI prompt. Switch instantly from the tray menu or create your own.',
  },
  {
    Icon: ContextIcon,
    title: 'Context-aware AI',
    desc: 'Detects which app is focused — Outlook, VS Code, Slack — and adjusts the AI prompt automatically. No mode switching needed.',
  },
  {
    Icon: VocabIcon,
    title: 'Custom vocabulary',
    desc: 'Add proper nouns, brand names, and technical terms that must be spelled exactly: "Elon Musk", "GPT-4o", "Kubernetes". Applied on every transcription.',
  },
]

const FEATURES_PRODUCTIVITY = [
  {
    Icon: LoopIcon,
    title: 'Continuous mode',
    desc: 'Auto-restarts recording after each injection for hands-free dictation. Speak, pause, speak again — no need to press the hotkey between sentences.',
  },
  {
    Icon: CommandIcon,
    title: 'Voice commands',
    desc: 'Say "new paragraph", "period", "comma", "delete that" — Wispra executes instead of typing. Undo the last injection with a single phrase.',
  },
  {
    Icon: TemplateIcon,
    title: 'Text templates / snippets',
    desc: 'Map a trigger phrase to any block of text. Say "my email sig" → your full signature is typed. Supports [date] and [time] placeholders.',
  },
  {
    Icon: FileAudioIcon,
    title: 'File transcription',
    desc: 'Drop any audio or video file (MP3, MP4, WAV, M4A, FLAC, WebM…) and get a text transcript in seconds — powered by the same Whisper engine.',
  },
]

const FEATURES_DATA = [
  {
    Icon: HistoryIcon,
    title: 'History with AI summaries',
    desc: 'Every dictation saved with topic tags (#Email, #Meeting, #Tasks). Filter by hashtag or time period. Click "Summarize" for an AI bullet-point digest.',
  },
  {
    Icon: ChartIcon,
    title: 'Usage statistics',
    desc: 'Total dictations, words, minutes, weekly streak, and most active day. See how many hours of typing you saved at 40 WPM.',
  },
  {
    Icon: ExportIcon,
    title: 'Export history',
    desc: 'Download your entire transcript history as TXT, Markdown, or CSV with one click — for archiving, search, or feeding into other tools.',
  },
  {
    Icon: ServerIcon,
    title: 'Local / offline mode',
    desc: 'Connect to Ollama, LocalAI, or LM Studio running on your own machine. Full dictation with zero data leaving your computer.',
  },
]

const FEATURES_PRIVACY = [
  {
    Icon: ShieldIcon,
    title: 'Your API key, your data',
    desc: 'BYOK model — bring your own free Groq key. Audio goes mic → Groq → your app. Wispra never stores or sees your audio.',
  },
  {
    Icon: KeyIcon,
    title: 'No subscription needed',
    desc: "Groq's free tier covers hundreds of minutes per day for most users. No credit card, no monthly fee, no usage cap enforced by Wispra.",
  },
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
            if (i < phrase.length) timerRef.current = setTimeout(step, 26)
            else timerRef.current = setTimeout(() => setPhraseIdx((p) => p + 1), 2600)
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
        {/* macOS-style titlebar */}
        <div className="flex items-center gap-2 mb-4">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-[#FF5F56]" />
            <div className="w-3 h-3 rounded-full bg-[#FFBD2E]" />
            <div className="w-3 h-3 rounded-full bg-[#27C93F]" />
          </div>
          <span className="ml-2 text-text-muted text-xs">any app — Notepad, Chrome, VS Code…</span>
        </div>

        {/* Text area */}
        <div className="bg-[#0A0A1A] rounded-lg p-4 min-h-[76px] font-mono text-sm text-text-primary leading-relaxed mb-4">
          {typed || (!typed && phase !== 'recording')
            ? typed || <span className="text-text-muted">Speak now…</span>
            : null}
          {phase === 'done' && (
            <span className="inline-block w-0.5 h-4 bg-brand ml-0.5 animate-pulse align-middle" />
          )}
        </div>

        {/* Status bar */}
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
                {phase === 'idle' ? 'Wispra — ready' : phase === 'recording' ? 'Recording…' : 'Injected ✓'}
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

function FeatureCard({ Icon, title, desc }: { Icon: React.ComponentType<{ className?: string }>, title: string, desc: string }) {
  return (
    <div className="glow-card bg-bg-card rounded-xl p-5 group">
      <div className="w-10 h-10 rounded-lg bg-brand/10 border border-brand/20 flex items-center justify-center mb-4 group-hover:bg-brand/20 transition-colors">
        <Icon className="w-5 h-5 text-brand" />
      </div>
      <h3 className="text-sm font-semibold text-text-primary mb-1.5">{title}</h3>
      <p className="text-xs text-text-muted leading-relaxed">{desc}</p>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-widest text-brand mb-3">{children}</p>
  )
}

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
          <span className="hidden sm:inline text-xs text-text-muted font-mono bg-white/5 px-2 py-0.5 rounded-full border border-white/8">{VERSION}</span>
        </div>
        <div className="flex items-center gap-3">
          <Link href={GITHUB_URL} target="_blank" rel="noopener noreferrer"
            className="hidden sm:flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary transition-colors">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.28-.01-1.04-.01-2.03-3.34.72-4.04-1.61-4.04-1.61-.54-1.39-1.33-1.76-1.33-1.76-1.09-.74.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.8 1.3 3.48.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 013-.4c1.02 0 2.04.13 3 .4 2.28-1.55 3.29-1.23 3.29-1.23.66 1.66.24 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.48 5.92.43.37.81 1.1.81 2.22 0 1.6-.01 2.9-.01 3.29 0 .32.21.7.82.58A12 12 0 0024 12C24 5.37 18.63 0 12 0z" />
            </svg>
            GitHub
          </Link>
          <a href={DOWNLOAD_WIN}
            className="flex items-center gap-1.5 bg-brand hover:bg-brand-dark text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
            </svg>
            Download
          </a>
        </div>
      </div>
    </nav>
  )
}

export default function Page() {
  return (
    <>
      <Nav />

      {/* ── HERO ─────────────────────────────────────────── */}
      <section className="relative min-h-screen flex items-center pt-16 overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/3 left-1/4 w-96 h-96 bg-brand opacity-10 rounded-full blur-[120px]" />
          <div className="absolute top-1/4 right-1/4 w-72 h-72 bg-purple-600 opacity-8 rounded-full blur-[100px]" />
        </div>
        <div className="relative max-w-6xl mx-auto px-6 py-20 grid lg:grid-cols-2 gap-16 items-center">
          <div>
            <div className="inline-flex items-center gap-2 text-xs font-medium text-brand bg-brand/10 border border-brand/20 px-3 py-1.5 rounded-full mb-6">
              <span className="w-1.5 h-1.5 bg-brand rounded-full animate-pulse" />
              Free with your Groq API key
            </div>
            <h1 className="text-5xl lg:text-6xl font-bold leading-tight mb-6">
              <span className="gradient-text">Say it.</span>
              <br />
              <span className="text-text-primary">It types.</span>
            </h1>
            <p className="text-lg text-text-muted leading-relaxed mb-8 max-w-md">
              One global hotkey from any app. Speak naturally in any language.
              Wispra transcribes, AI-polishes, and types the result — in under a second, wherever your cursor is.
            </p>
            <div className="flex flex-wrap gap-3 mb-8">
              <a href={DOWNLOAD_WIN}
                className="inline-flex items-center gap-2 bg-brand hover:bg-brand-dark text-white font-semibold px-6 py-3 rounded-xl transition-all hover:scale-105 hover:shadow-[0_0_32px_rgba(79,110,247,0.4)] shadow-[0_0_16px_rgba(79,110,247,0.2)]">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
                </svg>
                Download for Windows
              </a>
              <a href={DOWNLOAD_MAC}
                className="inline-flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-text-primary font-semibold px-6 py-3 rounded-xl transition-all">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
                </svg>
                Download for macOS
              </a>
            </div>
            <div className="flex flex-wrap items-center gap-5 text-sm text-text-muted">
              {['Windows 10/11', 'macOS 12+', 'Free Groq API key'].map((t) => (
                <span key={t} className="flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-[#27C93F] flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  {t}
                </span>
              ))}
            </div>
          </div>
          <div className="flex justify-center lg:justify-end">
            <DemoCard />
          </div>
        </div>
      </section>

      {/* ── PAIN POINTS ──────────────────────────────────── */}
      <section className="border-t border-white/5 py-20">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-12">
            <SectionLabel>Who is Wispra for?</SectionLabel>
            <h2 className="text-3xl font-bold text-text-primary">Built for the way you actually work</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {PAIN_POINTS.map((p) => (
              <div key={p.audience} className={`rounded-xl border bg-gradient-to-br p-6 ${p.color}`}>
                <p className={`text-xs font-semibold uppercase tracking-widest mb-3 ${p.accent}`}>{p.audience}</p>
                <p className="text-base font-semibold text-text-primary mb-3">"{p.pain}"</p>
                <p className="text-sm text-text-muted leading-relaxed">{p.solution}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CORE FEATURES ────────────────────────────────── */}
      <section className="border-t border-white/5 py-20">
        <div className="max-w-6xl mx-auto px-6">
          <SectionLabel>Core</SectionLabel>
          <h2 className="text-3xl font-bold text-text-primary mb-10">Dictation that actually works</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {FEATURES_CORE.map((f) => <FeatureCard key={f.title} {...f} />)}
          </div>
        </div>
      </section>

      {/* ── AI FEATURES ──────────────────────────────────── */}
      <section className="border-t border-white/5 py-20">
        <div className="max-w-6xl mx-auto px-6">
          <SectionLabel>AI</SectionLabel>
          <h2 className="text-3xl font-bold text-text-primary mb-4">Smarter than speech-to-text</h2>
          <p className="text-text-muted mb-10 max-w-xl">
            Raw transcription is just the start. Wispra layers AI cleanup, mode-based prompts, and app context on top — so what gets typed is already polished.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {FEATURES_AI.map((f) => <FeatureCard key={f.title} {...f} />)}
          </div>
        </div>
      </section>

      {/* ── PRODUCTIVITY FEATURES ────────────────────────── */}
      <section className="border-t border-white/5 py-20">
        <div className="max-w-6xl mx-auto px-6">
          <SectionLabel>Productivity</SectionLabel>
          <h2 className="text-3xl font-bold text-text-primary mb-4">Built for heavy daily use</h2>
          <p className="text-text-muted mb-10 max-w-xl">
            From hands-free continuous dictation to voice-triggered text snippets — every feature designed to stay out of your way.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {FEATURES_PRODUCTIVITY.map((f) => <FeatureCard key={f.title} {...f} />)}
          </div>
        </div>
      </section>

      {/* ── DATA FEATURES ────────────────────────────────── */}
      <section className="border-t border-white/5 py-20">
        <div className="max-w-6xl mx-auto px-6">
          <SectionLabel>History & Data</SectionLabel>
          <h2 className="text-3xl font-bold text-text-primary mb-10">Every word, always yours</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {FEATURES_DATA.map((f) => <FeatureCard key={f.title} {...f} />)}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ─────────────────────────────────── */}
      <section className="border-t border-white/5 py-20">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <SectionLabel>How it works</SectionLabel>
            <h2 className="text-3xl font-bold text-text-primary">Ready in under a minute</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8 relative">
            {[
              { n: '1', Icon: KeyIcon, title: 'Install + add your Groq key', desc: 'Download the installer, open Settings, and paste in your free Groq API key. Takes 60 seconds.' },
              { n: '2', Icon: MicIcon, title: 'Press the hotkey and speak', desc: 'Ctrl+Shift+Space from any app. A floating icon appears. Speak naturally in any language.' },
              { n: '3', Icon: InjectIcon, title: 'Text appears instantly', desc: 'AI polishes your words and types them directly into whatever field is focused. Done.' },
            ].map((step, i) => (
              <div key={i} className="relative text-center">
                {i < 2 && (
                  <div className="hidden md:block absolute top-6 left-[calc(50%+28px)] right-[calc(-50%+28px)] h-px bg-gradient-to-r from-brand/30 to-brand/5" />
                )}
                <div className="w-12 h-12 rounded-full bg-brand/15 border border-brand/30 flex items-center justify-center mx-auto mb-5">
                  <step.Icon className="w-5 h-5 text-brand" />
                </div>
                <div className="text-xs font-bold text-brand mb-2">Step {step.n}</div>
                <h3 className="text-base font-semibold text-text-primary mb-2">{step.title}</h3>
                <p className="text-text-muted text-sm leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRIVACY / BYOK ───────────────────────────────── */}
      <section className="border-t border-white/5 py-20">
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid md:grid-cols-2 gap-5">
            {FEATURES_PRIVACY.map((f) => (
              <div key={f.title} className="glow-card bg-bg-card rounded-xl p-6 group flex gap-4 items-start">
                <div className="w-10 h-10 rounded-lg bg-brand/10 border border-brand/20 flex items-center justify-center flex-shrink-0 group-hover:bg-brand/20 transition-colors">
                  <f.Icon className="w-5 h-5 text-brand" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-text-primary mb-1">{f.title}</h3>
                  <p className="text-xs text-text-muted leading-relaxed">{f.desc}</p>
                  {f.title.includes('API') && (
                    <a href="https://console.groq.com" target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-brand hover:underline mt-2">
                      Get a free Groq API key →
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── DOWNLOAD CTA ─────────────────────────────────── */}
      <section className="border-t border-white/5 py-24">
        <div className="max-w-6xl mx-auto px-6">
          <div className="relative rounded-2xl overflow-hidden border border-brand/20 bg-gradient-to-br from-bg-card via-[#0D1035] to-bg-card p-12 text-center">
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute inset-0 bg-brand opacity-5" />
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-32 bg-brand opacity-20 blur-[60px]" />
            </div>
            <div className="relative">
              <h2 className="text-3xl lg:text-4xl font-bold text-text-primary mb-3">Start dictating today</h2>
              <p className="text-text-muted mb-8 max-w-md mx-auto">
                Free download. Works on Windows and macOS. No account — just your free Groq API key.
              </p>
              <div className="flex flex-wrap justify-center gap-4">
                <a href={DOWNLOAD_WIN}
                  className="inline-flex items-center gap-2.5 bg-brand hover:bg-brand-dark text-white font-semibold px-7 py-3.5 rounded-xl transition-all hover:scale-105 hover:shadow-[0_0_40px_rgba(79,110,247,0.5)] shadow-[0_0_20px_rgba(79,110,247,0.25)]">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
                  </svg>
                  Download for Windows
                </a>
                <a href={DOWNLOAD_MAC}
                  className="inline-flex items-center gap-2.5 bg-white/8 hover:bg-white/12 border border-white/15 text-text-primary font-semibold px-7 py-3.5 rounded-xl transition-all">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
                  </svg>
                  Download for macOS
                </a>
              </div>
              <p className="text-text-muted text-sm mt-5">{VERSION} · Auto-updates · Windows 10/11 · macOS 12+</p>
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
            <span className="text-sm text-text-muted">Wispra</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-text-muted">
            {[['GitHub', GITHUB_URL], ['Changelog', `${GITHUB_URL}/releases`], ['Support', `${GITHUB_URL}/issues`]].map(([label, href]) => (
              <Link key={label} href={href!} target="_blank" rel="noopener noreferrer" className="hover:text-text-primary transition-colors">
                {label}
              </Link>
            ))}
          </div>
        </div>
      </footer>
    </>
  )
}
