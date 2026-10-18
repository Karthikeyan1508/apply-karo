import type { Metadata, Viewport } from "next"
import { Archivo, Geist_Mono, Anek_Devanagari } from "next/font/google"

import "./globals.css"
import { ShaderBackground } from "@/components/shader/shader-background"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

// Archivo is variable on weight and width. The width axis powers the wide display type.
const archivo = Archivo({ subsets: ["latin"], variable: "--font-sans", axes: ["wdth"] })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

// Archivo has no Devanagari, so Hindi text falls back to this, including the "करो" in the name.
const deva = Anek_Devanagari({
  subsets: ["devanagari"],
  weight: ["500", "700", "800"],
  variable: "--font-deva-src",
})

export const metadata: Metadata = {
  title: "Apply करो: speak, and it fills the form",
  description:
    "A voice interviewer that reads any application, asks the right follow-ups, and drafts answers from what you actually said. Nothing is submitted without you.",
}

export const viewport: Viewport = {
  themeColor: "#081800",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("antialiased", fontMono.variable, "font-sans", archivo.variable, deva.variable)}
    >
      <body>
        <ThemeProvider defaultTheme="dark" enableSystem={false}>
          <a
            href="#main"
            className="label-caps sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-3 focus-visible:left-3 focus-visible:z-50 focus-visible:bg-brand focus-visible:px-4 focus-visible:py-2.5 focus-visible:text-brand-foreground"
          >
            Skip to content
          </a>
          <ShaderBackground />
          <TooltipProvider delay={150}>{children}</TooltipProvider>
          <Toaster position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  )
}
