import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { launch } from "./launch"

export default Runtime.handler(Commands, (input) =>
  launch({
    directory: input.directory,
    server: input.server,
    standalone: input.standalone,
    session: input.session,
    prompt: input.prompt,
    continue: input.continue,
    auto: input.auto || input.yolo || input.dangerouslySkipPermissions,
  }),
)
