import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  Monitor,
  ShieldCheck,
} from "lucide-react";

export const metadata = {
  title: "Windows preview — Ready Finch",
  description:
    "Get the current Windows preview of Ready Finch, the voice-first desktop app.",
};

const releaseUrl =
  "https://github.com/invalidandnull/ReadyFinch/releases/tag/v0.1.9";
const installerUrl =
  "https://github.com/invalidandnull/ReadyFinch/releases/download/v0.1.9/ReadyFinch-0.1.9-x64.exe";

export default function DownloadPage() {
  return (
    <main className="download-page">
      <div className="download-shell">
        <a href="/" className="download-back">
          <ArrowLeft size={17} /> Back to Ready Finch
        </a>
        <div className="download-card">
          <div className="download-icon">
            <Download size={29} />
          </div>
          <div className="section-kicker">WINDOWS PREVIEW · V0.1.9</div>
          <h1>
            Bring your voice
            <br />
            <em>to work.</em>
          </h1>
          <p className="download-lead">
            Download the Windows preview and make your voice useful across the
            apps you already use.
          </p>
          <div className="download-availability">
            <div>
              <Monitor size={18} />
              <span>Windows 10 / 11 · x64</span>
            </div>
            <div>
              <ShieldCheck size={18} />
              <span>Configure your own providers inside the app</span>
            </div>
          </div>
          <div className="download-local">
            <span>LATEST WINDOWS BUILD</span>
            <code>ReadyFinch-0.1.9-x64.exe</code>
            <small>
              Windows 10 / 11 · x64 · 120 MB
            </small>
          </div>
          <a className="button button-dark" href={installerUrl}>
            Download Ready Finch for Windows <Download size={17} />
          </a>
        </div>
        <div className="download-foot">
          <Check size={16} /> Open source on GitHub.
          <a href={releaseUrl}>
            View release notes <ArrowRight size={14} />
          </a>
        </div>
      </div>
    </main>
  );
}
