import Link from "next/link";
import { Clapperboard, Library, Settings, Circle } from "lucide-react";

export function Sidebar() {
  return (
    <aside className="w-64 shrink-0 border-r border-[#272e37] bg-[#0e1115] p-5 flex flex-col min-h-screen">
      <div className="mb-9">
        <div className="font-semibold text-lg">AutoTutorial AI</div>
        <div className="text-xs text-slate-500 mt-1">Show it once. Get a tutorial.</div>
      </div>
      <nav className="space-y-1">
        <Link className="flex gap-3 items-center rounded-xl px-3 py-3 hover:bg-[#171c22]" href="/"><Clapperboard size={18}/>New Tutorial</Link>
        <Link className="flex gap-3 items-center rounded-xl px-3 py-3 hover:bg-[#171c22]" href="/tutorials"><Library size={18}/>Tutorials</Link>
        <Link className="flex gap-3 items-center rounded-xl px-3 py-3 hover:bg-[#171c22]" href="/settings"><Settings size={18}/>Settings</Link>
      </nav>
      <div className="mt-auto border border-[#272e37] rounded-xl p-3">
        <div className="text-xs text-slate-500">Local Mode</div>
        <div className="flex items-center gap-2 mt-1 text-sm"><Circle size={9} fill="#45d483" strokeWidth={0}/>Ready</div>
      </div>
    </aside>
  );
}