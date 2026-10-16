export type Guide = {
  slug: string;
  title: string;
  description: string;
  eyebrow: string;
  readTime: string;
  intro: string;
  sections: { heading: string; paragraphs: string[]; steps?: string[] }[];
};

export const guides: Guide[] = [
  {
    slug: "voice-dictation-windows",
    title: "How to use voice dictation across Windows apps",
    description: "A practical setup guide for inserting dictated text into messages, documents, browsers, and other Windows apps with RediFinch.",
    eyebrow: "GETTING STARTED",
    readTime: "4 min read",
    intro: "The useful part of voice typing is staying in the app where you are already working. RediFinch listens while you hold a shortcut, then inserts the finished transcript at your cursor.",
    sections: [
      { heading: "Set up your speech engine", paragraphs: ["Install the Windows preview and open Settings → Engine. Choose the local SenseVoice model if you want transcription on your device after the model download. Or select a supported cloud speech provider and add your own API key.", "The local model requires a first-time download. Cloud engines need an internet connection and may have provider usage charges."], steps: ["Download RediFinch for Windows 10 or 11 (x64).", "In Settings → Engine, choose Local or a cloud provider.", "If you choose Local, download the model before your first recording."] },
      { heading: "Dictate into the field you are using", paragraphs: ["Put your cursor in a message, document, browser form, or another editable Windows app. Hold Ctrl+Win, speak naturally, and release. The recording overlay shows when RediFinch is listening. When transcription finishes, the text is inserted at the cursor.", "You can change mode shortcuts in settings. Separate shortcuts let you move between raw dictation, polishing, translation, and the assistant without opening the app each time."], steps: ["Focus the destination text field.", "Hold the dictation shortcut and speak.", "Release the keys and review the inserted text before sending."] },
      { heading: "Choose how much editing you want", paragraphs: ["Raw output keeps the transcript closest to your speech. Polish mode uses a separately configured writing model to turn a rough thought into clearer text. That processing sends text to the provider you select.", "For names, numbers, and important messages, read the result before publishing. A speech model can mishear words, and a polishing model can change nuance."] },
      { heading: "If text does not appear", paragraphs: ["Check that the destination field still has focus and that the recording overlay appears when you hold the shortcut. If the destination app runs as administrator, Windows may prevent text insertion from a normally privileged RediFinch process. Run both apps at the same privilege level.", "If the shortcut does not start recording, check Windows shortcut conflicts and the mode shortcut settings. The Start Dictation button inside RediFinch can help isolate a shortcut issue from a microphone or provider issue."] },
    ],
  },
  {
    slug: "offline-vs-cloud-dictation",
    title: "Offline vs. cloud dictation: which setup fits your work?",
    description: "Compare local and cloud speech recognition for Windows dictation, including privacy, setup, connectivity, and optional AI editing.",
    eyebrow: "CHOOSING A SETUP",
    readTime: "4 min read",
    intro: "Where speech recognition runs changes the setup experience and the data path. RediFinch lets you choose a local speech model or connect a cloud provider with your own key.",
    sections: [
      { heading: "When local transcription makes sense", paragraphs: ["The built-in SenseVoice option runs speech recognition on your computer after its model has been downloaded. That means the speech-to-text step can work without an internet connection. It is a useful choice when your connection is unreliable or you want audio to stay on your device for transcription.", "Local processing still uses your machine's resources, and the model must be downloaded first. Check the output yourself when accuracy is important."] },
      { heading: "When a cloud engine makes sense", paragraphs: ["Cloud providers offer another set of speech models and may fit your language, accuracy, or speed needs. RediFinch supports several providers through its Engine menu and stores the API key you supply in local app settings.", "Cloud transcription sends audio to the selected provider and depends on your connection. Check that provider's terms, retention policy, and pricing before using it for sensitive work."] },
      { heading: "Keep the whole pipeline in mind", paragraphs: ["A local speech engine does not make every output mode offline. If you enable AI polishing, AI translation, a translation service, or the voice agent, the relevant text or tool results go to the provider you configure.", "For an offline transcription workflow, use the local engine with raw output. For a polished or translated result, decide separately which service should process the text."] },
      { heading: "A quick decision guide", paragraphs: ["Start with local transcription if offline use and control of the audio path matter most. Try a cloud engine if you want to compare model quality for your voice and language. Keep one short test phrase and one realistic paragraph so you can judge each setup on your actual work rather than a generic benchmark."], steps: ["Choose Local or a cloud provider in Settings → Engine.", "Dictate the same sample in both setups.", "Review punctuation, names, latency, and the provider's data policy before settling on one."] },
    ],
  },
  {
    slug: "voice-translation-windows",
    title: "Translate spoken ideas with a Windows shortcut",
    description: "Learn how RediFinch combines speech recognition with translation services or AI translation, and how to switch modes by shortcut.",
    eyebrow: "VOICE TRANSLATION",
    readTime: "3 min read",
    intro: "Speaking a sentence, then moving it between apps to translate it, breaks the flow. RediFinch can transcribe your speech and send the text through a translation service or an AI model before inserting the result.",
    sections: [
      { heading: "Translation service or AI model?", paragraphs: ["Service translation is the direct path: speech becomes text, then a supported translation API processes it. RediFinch includes provider choices such as DeepL, Google, and Azure, plus a compatible custom endpoint.", "AI translation uses a language model you choose. It can be useful when tone and context matter, but the model can also paraphrase. Review names, figures, and meaning before sending important text."] },
      { heading: "Configure the modes", paragraphs: ["In Settings → Output, select a translation mode, choose its provider and model where applicable, and enter your own API key. Custom endpoint fields appear when you choose a custom provider.", "Assign a separate push-to-talk shortcut to each output mode. For example, keep your usual shortcut for dictation and add a modifier for translation so you can switch in place."], steps: ["Configure a speech engine in Settings → Engine.", "Configure Service Translation or AI Translation in Settings → Output.", "Set a distinct shortcut for that mode, then dictate into a text field and review the translated result."] },
      { heading: "Know the data path", paragraphs: ["A local speech model can handle the transcription step offline, but translation through a service or AI provider sends the transcript to that provider. Cloud speech sends audio to the speech provider as well. Choose services with policies that fit the text you plan to dictate."] },
    ],
  },
];
