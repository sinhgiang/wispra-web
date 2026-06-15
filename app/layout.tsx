import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Wispra — Voice Dictation for Any App',
  description:
    'Press one key. Speak in any language. Wispra types your words into any app — instantly. Free with your own API key.',
  keywords: ['voice dictation', 'speech to text', 'dictation app', 'productivity', 'Whisper', 'AI transcription'],
  openGraph: {
    title: 'Wispra — Voice Dictation for Any App',
    description: 'Press one key. Speak. Text appears instantly in any app.',
    type: 'website',
    url: 'https://wispra.com',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Wispra — Voice Dictation for Any App',
    description: 'Press one key. Speak. Text appears instantly in any app.',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
