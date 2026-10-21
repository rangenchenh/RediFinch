<a href="https://redifinch.com/"><img src=".github/assets/readme-cover.png" alt="Abstract blue glass sound wave for RediFinch" width="100%" /></a>

<h1 align="center">RediFinch</h1>

<p align="center">
  <strong>Your words, without the typing.</strong><br />
  Hold a shortcut, speak naturally, and put clear text into the app you are using.
</p>

<p align="center">
  <a href="https://redifinch.com/">Website</a> ·
  <a href="https://github.com/rangenchenh/RediFinch/releases/download/v0.1.11/RediFinch-0.1.11-x64.exe">Download for Windows</a> ·
  <a href="https://github.com/rangenchenh/RediFinch/releases">Releases</a> ·
  <a href="https://github.com/rangenchenh/RediFinch/issues">Report an issue</a>
</p>

<p align="center">
  <a href="https://github.com/rangenchenh/RediFinch/releases/tag/v0.1.11"><img src="https://img.shields.io/badge/preview-v0.1.11-458ff5" alt="Preview v0.1.11" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-458ff5" alt="MIT license" /></a>
  <img src="https://img.shields.io/badge/platform-Windows%2010%2F11-458ff5" alt="Windows 10 and 11" />
</p>

RediFinch combines local or cloud dictation with AI polishing, translation, and an **early voice agent preview** for browser and computer actions you allow.

## Get started

1. Download `RediFinch-0.1.11-x64.exe` from the [v0.1.11 release](https://github.com/rangenchenh/RediFinch/releases/tag/v0.1.11) and run it on **Windows 10 or 11 (x64)**. This preview installer is not code signed.
2. In **Settings → Engine**, select **Local** and download the SenseVoice model, or select a cloud speech provider and enter your own API key.
3. Focus a text field in another app. Hold `Ctrl+Win`, speak, then release to insert the transcript.
4. To polish or translate what you say, configure a provider in **Settings → Output** and select an output mode. You can assign different push-to-talk shortcuts to different modes.

The local model downloads on first setup and can transcribe offline afterward. Cloud features need an internet connection and credentials for the provider you choose.

## What you can do

| Feature | Details |
| --- | --- |
| Dictation | Insert text into the focused app with a hold-to-talk shortcut. A tray icon and recording overlay show the current state. |
| Speech engines | Local SenseVoice; OpenAI, Groq, SiliconFlow, Deepgram, ElevenLabs, AssemblyAI, Google Cloud STT, Azure Speech, and Speko Router. |
| Output modes | Raw transcript, LLM polishing, LLM translation, or translation through DeepL, Google, Azure, or a compatible endpoint. |
| Provider setup | Built-in provider and model menus, with custom model IDs and endpoints where supported. |
| Mode shortcuts | Configure a separate shortcut for each output mode. |
| Voice agent preview | Use a separately configured agent model with selected Chrome and local command tools. See [Agent requirements and permissions](#agent-requirements-and-permissions). |

## Agent requirements and permissions

The **Agent** mode has its own model and tool settings under **Settings → Agent**. Browser tools connect to an existing **Google Chrome 144 or newer** session through Chrome DevTools MCP. Chrome must be running, Remote Debugging must be enabled in `chrome://inspect/#remote-debugging`, and Chrome may ask you to allow the connection.

Enable only the tools you want the agent to use. If **Local PowerShell** is enabled, the model can propose PowerShell commands to run on your computer; **each command requires your approval**. When browser or command tools are enabled, page snapshots and short command results can be sent to your configured Agent model provider. Agent runs have a bounded step count. This preview does not yet provide long-term memory or general desktop control.

## Data and security

- The local speech engine can work offline after its model is installed. Cloud speech, polishing, translation, and agent features send relevant audio, text, or tool results to the provider you configure. RediFinch does not bundle provider API keys.
- Provider keys are saved with other app settings in plain JSON at `%APPDATA%\RediFinch\settings.json`. Do not share this file or attach it to issue reports.
- Windows cannot inject text from a normal process into an elevated app. Run RediFinch at the same privilege level as the app receiving text.

## Build from source

You need **Windows 10/11 x64**, **Node.js 22 or newer**, npm, and Git.

```powershell
git clone https://github.com/rangenchenh/RediFinch.git
cd RediFinch
npm ci
npm run dev
```

`npm run dev` starts the Next.js renderer and Electron app. `npm run build` builds the renderer and main process. `npm run dist` creates the Windows installer in `release/`.

The marketing site is a separate project:

```powershell
cd website
npm ci
npm run build
```

## Verify a change

Run the checks relevant to your change. The smoke test needs build artifacts, so build first on a fresh clone.

```powershell
npm run typecheck
npm run test:keys
npm run test:output
npm run test:models
npm run test:agent
npm run test:speko
npm run test:groq
npm run build
npm run smoke
```

`npm run smoke` checks the build artifacts and native dependencies without opening the GUI. `npm run test:chrome` is an optional integration test: it requires a running Chrome session with Remote Debugging enabled, opens a local test tab, and closes it afterward.

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

- Native hotkeys and text insertion are Windows specific.
- Local SenseVoice transcription is segment based; Deepgram supports interim streaming results.
- The voice agent works with an existing Chrome session and approved local commands. It is an early preview rather than an unattended general-purpose assistant.

## Help and contributing

If something fails, [open an issue](https://github.com/rangenchenh/RediFinch/issues) with your Windows version, RediFinch version, steps to reproduce, and the provider or mode involved. Remove API keys and private content before sharing logs or screenshots. Focused issues and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

RediFinch is released under the [MIT License](LICENSE). Third-party packages and model files retain their own licenses; see their upstream projects and [website/THIRD_PARTY_NOTICES.md](website/THIRD_PARTY_NOTICES.md) for the site's design references.
