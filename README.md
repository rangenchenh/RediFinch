# Vokluna

**Voice input for the apps you already use.** Hold a shortcut, speak naturally, and Vokluna inserts the result into the focused Windows app. Dictate locally or choose a cloud speech provider; polish or translate the result when you need to.

[Download for Windows](https://github.com/invalidandnull/Vokluna/releases/latest) · [Website](https://website-nu-henna-71.vercel.app/) · [Report an issue](https://github.com/invalidandnull/Vokluna/issues)

## Install

Download the latest `Vokluna-*-x64.exe` from [GitHub Releases](https://github.com/invalidandnull/Vokluna/releases/latest) and run the installer. The current build supports **Windows 10/11 on x64**. It is a preview build and is not code signed.

On first launch, choose an on-device model or enter your own provider key in **Settings**. Local speech recognition downloads its model on demand; cloud recognition needs a key for the selected service.

## What it does

| Feature | Details |
| --- | --- |
| Dictation anywhere | Hold `Ctrl+Win` by default, speak, then release. Text goes into the app that had focus. A tray icon and recording overlay show the current state. |
| Speech engines | Use local SenseVoice or connect OpenAI, Groq, SiliconFlow, Deepgram, ElevenLabs, AssemblyAI, Google Cloud STT, Azure Speech, or Speko Router. |
| Output modes | Insert the raw transcript, polish it with an LLM, translate it with an LLM, or translate it through DeepL, Google, Azure, or a compatible endpoint. |
| Provider and model selection | Choose from built-in provider and model menus, or supply a custom model ID and endpoint where supported. |
| Mode shortcuts | Assign a separate push-to-talk shortcut to each output mode. |
| Voice agent preview | Configure a separate agent model and tool permissions to inspect or operate an existing Chrome session, open URLs, and run approved local commands. |

The local speech engine can work without a network connection after its models are installed. Cloud speech, polish, translation, and agent features send the relevant audio or text to the provider you configure. Vokluna does not bundle provider API keys.

## Quick start

1. Open **Settings → Engine** and choose **Local** or a cloud provider.
2. If using Local, download the model in the app. If using a cloud provider, enter its API key.
3. Focus a text field in another app, hold `Ctrl+Win`, speak, then release.
4. To polish or translate, choose an output mode and configure its provider under **Settings → Output**.

The **Agent** mode uses its own model configuration under **Settings → Agent**. Browser control connects to your running Chrome through Chrome DevTools MCP. Chrome Remote Debugging must be enabled in `chrome://inspect/#remote-debugging`, and Chrome may ask you to allow the connection. The agent's available browser and command tools are controlled separately in Settings. This is an early implementation with a bounded step count, not an unattended general-purpose assistant.

## Build from source

### Requirements

- Windows 10/11 x64
- Node.js 22 or newer and npm
- Git

```powershell
git clone https://github.com/invalidandnull/Vokluna.git
cd Vokluna
npm ci
npm run dev
```

`npm run dev` starts the Next.js renderer and Electron app. To build the renderer and main process, run `npm run build`. To make the Windows installer, run `npm run dist`; the output is written to `release/`.

The website lives in `website/` and has its own dependencies and build:

```powershell
cd website
npm ci
npm run build
```

## Verify a change

```powershell
npm run typecheck
npm run test:keys
npm run test:output
npm run test:models
npm run test:agent
npm run smoke
```

The smoke test checks the native Windows input layer, hotkey helper, and packaged dependencies without opening a GUI.

## Project layout

```text
src/electron/   Electron lifecycle, speech engines, output processing, agent tools, hotkeys, and text insertion
src/app/        Desktop interface and recording overlay
src/components/ Reusable interface components
src/shared/     Types and IPC contract shared by both processes
scripts/        Build, model download, icon generation, and verification scripts
website/        Standalone marketing site
```

## Known limitations

- The native hotkey and text insertion layers are Windows specific.
- Local SenseVoice transcription is segment based; Deepgram supports interim streaming results.
- Windows blocks input injection from a normal process into an elevated app. Run Vokluna at the same privilege level as the target app.
- The voice agent currently operates an existing Chrome session and approved local commands. It does not yet have long-term memory or a general desktop control layer.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the development and review workflow.

## License

Vokluna is released under the [MIT License](LICENSE). Third-party packages and model files retain their own licenses; see their upstream projects and [website/THIRD_PARTY_NOTICES.md](website/THIRD_PARTY_NOTICES.md) for the site's design references.
