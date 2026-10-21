import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  Monitor,
  ShieldCheck,
} from "lucide-react";
import { pageMetadata } from "../seo";

export const metadata = pageMetadata(
  "Download the Windows preview",
  "Download RediFinch for Windows 10 or 11 and try voice dictation, polishing, translation, and the early assistant preview.",
  "/download/",
);

const releaseUrl =
  "https://github.com/rangenchenh/RediFinch/releases/tag/v0.1.11";
const repositoryUrl = "https://github.com/rangenchenh/RediFinch";
const installerUrl =
  "https://github.com/rangenchenh/RediFinch/releases/download/v0.1.11/RediFinch-0.1.11-x64.exe";

export default function DownloadPage() {
  return (
    <main className="download-page">
      <div className="download-shell">
        <a href="/" className="download-back">
          <ArrowLeft size={17} /> Back to RediFinch
        </a>
        <div className="download-card">
          <div className="download-icon">
            <Download size={29} />
          </div>
          <div className="section-kicker">WINDOWS PREVIEW · V0.1.11</div>
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
            <code>RediFinch-0.1.11-x64.exe</code>
            <small>
              Windows 10 / 11 · x64 · 120 MB
            </small>
          </div>
          <a className="button button-dark" href={installerUrl}>
            Download RediFinch for Windows <Download size={17} />
          </a>
        </div>
        <div className="download-foot">
          <Check size={16} /> <a href={repositoryUrl} target="_blank" rel="noopener noreferrer">Open source on GitHub.</a>
          <a href={releaseUrl}>
            View release notes <ArrowRight size={14} />
          </a>
        </div>
      </div>
    </main>
  );
}
