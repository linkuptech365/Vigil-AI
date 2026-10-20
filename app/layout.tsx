import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"

import "./globals.css"
import { GlobalErrorBarrier } from "@/components/ops/global-error-barrier"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import { cn } from "@/lib/utils"

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  title: "Vigil-AI | 多模态视频推理与异常预警平台",
  description:
    "Vigil-AI Sentinel：基于多模态大模型的视频监控分析与异常预警平台，支持暴力冲突、PPE 违规、烟火与越界入侵识别。",
}

export const viewport: Viewport = {
  themeColor: "#0b0f19",
  colorScheme: "dark",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
      className={cn(
        "dark bg-background antialiased",
        fontMono.variable,
        "font-sans",
        geist.variable
      )}
    >
      <body>
        <GlobalErrorBarrier />
        <ThemeProvider forcedTheme="dark" defaultTheme="dark">
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  )
}
