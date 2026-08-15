import { installHost } from "~/lib/debug/try-prompt/host"
import { registry } from "~/lib/debug/try-prompt/agents"
import { run } from "~/lib/debug/try-prompt/runner"

const recorder = installHost()
process.exitCode = await run(process.argv.slice(2), recorder, registry)
