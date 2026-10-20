import { ApiCard } from "./api-card"
import { RulesCard } from "./rules-card"
import { SourceCard } from "./source-card"

export function ConfigTab() {
  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="lg:col-span-3">
        <ApiCard />
      </div>
      <div className="flex flex-col gap-6 lg:col-span-2">
        <SourceCard />
        <RulesCard />
      </div>
    </div>
  )
}
