import { DemoCard } from "./demo-card"
import { ModelProfilesCard } from "./model-profiles-card"
import { SamplingCard } from "./sampling-card"
import { RulesCard } from "./rules-card"
import { SensitivityCard } from "./sensitivity-card"
import { SourceCard } from "./source-card"
import { StreamsCard } from "./streams-card"
import { VisionCard } from "./vision-card"

export function ConfigTab() {
  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="flex flex-col gap-6 lg:col-span-3">
        <DemoCard />
        <ModelProfilesCard />
        <VisionCard />
        <SamplingCard />
        <SensitivityCard />
      </div>
      <div className="flex flex-col gap-6 lg:col-span-2">
        <StreamsCard />
        <SourceCard />
        <RulesCard />
      </div>
    </div>
  )
}
