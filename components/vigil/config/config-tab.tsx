import { ModelProfilesCard } from "./model-profiles-card"
import { SamplingCard } from "./sampling-card"
import { RulesCard } from "./rules-card"
import { SensitivityCard } from "./sensitivity-card"
import { SourceCard } from "./source-card"

export function ConfigTab() {
  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="flex flex-col gap-6 lg:col-span-3">
        <ModelProfilesCard />
        <SamplingCard />
        <SensitivityCard />
      </div>
      <div className="flex flex-col gap-6 lg:col-span-2">
        <SourceCard />
        <RulesCard />
      </div>
    </div>
  )
}
