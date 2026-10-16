'use client';

import { House, Settings2, Sparkles } from 'lucide-react';
import { BrandMark } from './brand-mark';

export function AppSidebar({ active, mode, engine }: { active: 'home' | 'settings' | 'assistant'; mode?: string; engine?: string }) {
  return (
    <aside className="flex w-[190px] shrink-0 flex-col border-r border-[#e8e8e6] bg-[#f7f7f6] px-3 py-4 dark:border-white/10 dark:bg-[#171716]">
      <div className="drag-region mb-11 flex items-center gap-2.5 px-2.5">
        <div className="flex size-7 items-center justify-center rounded-[7px] bg-[#e9e9e7] text-[#121214] dark:bg-[#ededeb]"><BrandMark /></div>
        <span className="text-[15px] font-semibold tracking-[-0.025em]">Saykin</span>
      </div>
      <div className="text-muted-foreground px-2.5 text-[10px] font-semibold tracking-[0.11em] uppercase">Workspace</div>
      <nav className="mt-2 space-y-0.5" aria-label="Primary navigation">
        <a href="/" aria-current={active === 'home' ? 'page' : undefined} className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors ${active === 'home' ? 'bg-[#e9e9e7] text-foreground dark:bg-muted' : 'text-muted-foreground hover:bg-[#ededeb] hover:text-foreground dark:hover:bg-muted'}`}><House className="size-4" /> Dictation</a>
        <a href="/assistant/" aria-current={active === 'assistant' ? 'page' : undefined} className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors ${active === 'assistant' ? 'bg-[#e9e9e7] text-foreground dark:bg-muted' : 'text-muted-foreground hover:bg-[#ededeb] hover:text-foreground dark:hover:bg-muted'}`}><Sparkles className="size-4" /> Assistant</a>
        <a href="/settings/" aria-current={active === 'settings' ? 'page' : undefined} className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors ${active === 'settings' ? 'bg-[#e9e9e7] text-foreground dark:bg-muted' : 'text-muted-foreground hover:bg-[#ededeb] hover:text-foreground dark:hover:bg-muted'}`}><Settings2 className="size-4" /> Settings</a>
      </nav>
      <div className="mt-auto border-t border-[#e8e8e6] px-2.5 pt-4 dark:border-white/10">
        <div className="text-muted-foreground mb-2 text-[10px] font-semibold tracking-[0.11em] uppercase">Current mode</div>
        <p className="truncate text-[12px] font-medium">{mode ?? 'Transcribe'}</p>
        <p className="text-muted-foreground mt-0.5 truncate text-[11px]" title={engine}>{engine ?? 'On-device'}</p>
      </div>
    </aside>
  );
}
