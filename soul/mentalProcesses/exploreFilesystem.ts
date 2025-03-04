
import { ChatMessageRoleEnum, Memory, MentalProcess, indentNicely, useActions, usePerceptions, useProcessManager, useSoulMemory, useSoulStore, z } from "@opensouls/engine";
import externalDialog from "../cognitiveSteps/externalDialog.js";
import { ToolPossibilities, toolChooser } from "../cognitiveFunctions/toolChooser.js";
import readsAFile from "./readsAFile.js";
import chats from "./chat.js";
import { updateNotes } from "../cognitiveFunctions/notes.js";
import internalMonologue from "../cognitiveSteps/internalMonologue.js";
import spokenDialog from "../cognitiveSteps/spokenDialog.js";

const tools: ToolPossibilities = {
  "cd": {
    description: "Change directory to a directory in the filesystem",
    params: z.object({
      directory: z.string().describe("The directory to change to")
    })
  },
  "ls": {
    description: "List the files in the current directory",
  },
  "read": {
    description: "Opens a file in the current directory in an editor that shows the file 100 lines at a time.",
    params: z.object({
      file: z.string().describe("The file to read")
    })
  },
  "stop": {
    description: "Stops exploring the file system and chats with the user (after Philip has a good understanding of the codebase).",
  },
}

interface ListEntry {
  name: string;
  isDirectory: boolean;
}

const exploreFilesystem: MentalProcess = async ({ workingMemory }) => {
  const { speak, dispatch, log } = useActions()
  const { invocationCount } = useProcessManager()
  const { invokingPerception } = usePerceptions()
  const { fetch } = useSoulStore()
  // const latestList = useSoulMemory<ListEntry[]>("latestList", [])

  if (invocationCount === 0) {
    log("dispatching ls")
    dispatch({
      action: "ls",
      content: ""
    })
    return workingMemory.withMonologue("Philip lists the files in the current directory.")
  }
  if (invokingPerception?._metadata?.list) {
    const { list, cwd } = invokingPerception._metadata as unknown as { list: ListEntry[], cwd: string }

    log("got list", list)
    const entries = await Promise.all(list.map(async (entry ) => {
      if (entry.isDirectory) {
        return null
      }
      const res = await fetch(`${cwd}/${entry.name}`)
      if (!res) {
        return null
      }
      return {
        name: entry.name,
        content: res
      }
    }))

    const memories = entries.filter((entry): entry is { name: string; content: string } => Boolean(entry)).map(({ name, content }) => {
      return indentNicely`
        ### ${name}
        ${content}
      `
    })

    log("would supply memories:", memories)
    workingMemory = workingMemory.withMonologue(indentNicely`
      ## ${workingMemory.soulName} remembers already reading the following files in this directory:
      ${memories.join("\n\n")}
    `)
  }

  const [withMonologue, monologue] = await internalMonologue(
    workingMemory,
    `What is ${workingMemory.soulName}'s feelings after reading that list of files? How do these files relate to their goal?`,
    {
      model: "gpt-4-turbo",
    }
  )

  log("making a comment")
  const [withDialog, resp] = await spokenDialog(
    withMonologue,
    `${workingMemory.soulName} thinks out loud about what they are reading.`,
    { model: "gpt-4-turbo" }
  );
  speak(resp);

  await updateNotes(withDialog)

  log("choosing tools")
  const [toolMemory, toolChoice, args] = await toolChooser(withDialog, tools)

  log("Tool choice: ", toolChoice, "Args: ", args)
  if (toolChoice === "read") {
    return [toolMemory, readsAFile]
  }

  // strip off the actual list of files
  const cleanedMemory = toolMemory
    .slice(0, -1)
    .concat(withDialog.slice(-1))
    .withMonologue(indentNicely`
      After looking at the list of files and thinking
      > ${monologue}
      ${workingMemory.soulName} decided to call the tool: ${toolChoice} with the argument ${JSON.stringify(args)}.
    `)


  if (toolChoice === "stop") {
    return [cleanedMemory, chats, { executeNow: true }]
  }

  return cleanedMemory;
}

export default exploreFilesystem;
