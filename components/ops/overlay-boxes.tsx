import { cn } from "@/lib/utils"
import type { BoxTone, OverlayBox } from "@/lib/ops/types"

const TONE_BOX: Record<BoxTone, string> = {
  ok: "border-success/90 shadow-success/30",
  critical: "border-destructive shadow-destructive/50 bg-destructive/10",
  warn: "border-warning shadow-warning/40 bg-warning/10",
  zone: "border-dashed border-signal/90 bg-signal/10 shadow-signal/20",
}

const TONE_LABEL: Record<BoxTone, string> = {
  ok: "bg-success text-black",
  critical: "bg-destructive text-white",
  warn: "bg-warning text-black",
  zone: "bg-signal text-black",
}

interface OverlayBoxesProps {
  boxes: OverlayBox[]
  /** When false, only non-compliant boxes carry text labels. */
  showAllLabels?: boolean
  labelSize?: "xs" | "sm"
}

export function OverlayBoxes({ boxes, showAllLabels = true, labelSize = "sm" }: OverlayBoxesProps) {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {boxes.map((box, index) => {
        const showLabel = box.label && (showAllLabels || box.tone !== "ok")
        return (
          <div
            key={`${index}-${box.tone}`}
            className={cn(
              "absolute border-2 shadow-[0_0_12px] transition-[left,top] duration-100 ease-linear",
              TONE_BOX[box.tone],
              box.pulse && "animate-pulse"
            )}
            style={{
              left: `${box.x}%`,
              top: `${box.y}%`,
              width: `${box.w}%`,
              height: `${box.h}%`,
            }}
          >
            {showLabel && (
              <span
                className={cn(
                  "absolute bottom-full left-[-2px] mb-px whitespace-nowrap rounded-sm px-1 font-mono font-semibold leading-tight",
                  labelSize === "xs" ? "text-[8px]" : "text-[10px]",
                  TONE_LABEL[box.tone]
                )}
              >
                {box.label}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
