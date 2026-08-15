"use client"

import { Bot } from "lucide-react"
import { IconWithBackground } from "~/ui/components/IconWithBackground"
import { Progress } from "~/ui/components/Progress"

interface WelcomeBackLoadingProps {
  progress: number
  statusLabel: string
}

export const WelcomeBackLoading = ({ progress, statusLabel }: WelcomeBackLoadingProps) => (
  <div className="flex h-full w-full flex-col items-center justify-center bg-default-background px-12 py-12 mobile:px-6 mobile:py-6">
    <div className="flex w-full max-w-[384px] flex-col items-center justify-center gap-8">
      <div className="flex flex-col items-center gap-6">
        <IconWithBackground variant="brand" size="x-large" icon={<Bot />} />
        <div className="flex flex-col items-center gap-2">
          <span className="text-heading-1 font-heading-1 text-default-font text-center mobile:text-heading-2 mobile:font-heading-2">
            Welcome back
          </span>
          <span className="text-body font-body text-subtext-color text-center">
            Getting everything ready for you...
          </span>
        </div>
      </div>
      <div className="flex w-full max-w-[240px] flex-col items-center gap-3">
        <Progress value={progress} />
        {statusLabel && (
          <span className="text-caption font-caption text-subtext-color text-center">
            {statusLabel}
          </span>
        )}
      </div>
    </div>
  </div>
)
