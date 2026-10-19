"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Pencil, Search, Trash2 } from "lucide-react";
export default function Tutorials() {
  const [xs, setXs] = useState<any[]>([]),
    [q, setQ] = useState(""),
    [sort, setSort] = useState("newest"),
    [deleting, setDeleting] = useState("");
  async function load() {
    const r = await fetch("/api/tutorials", { cache: "no-store" });
    if (r.ok) setXs(await r.json());
  }
  useEffect(() => {
    load();
  }, []);
  const ys = useMemo(
    () =>
      xs
        .filter((x) => x.name.toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) =>
          sort === "oldest"
            ? a.createdAt.localeCompare(b.createdAt)
            : b.createdAt.localeCompare(a.createdAt),
        ),
    [xs, q, sort],
  );
  async function rename(x: any) {
    const n = prompt("Tutorial name", x.name);
    if (!n || n.trim() === x.name) return;
    const r = await fetch(`/api/tutorial?id=${encodeURIComponent(x.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: n }),
    });
    if (r.ok) load();
    else alert((await r.json()).error || "Could not rename tutorial.");
  }
  async function del(x: any) {
    if (
      !confirm(
        `Delete “${x.name}”? This removes the recording, screenshots, audio, and rendered video from this device.`,
      )
    )
      return;
    setDeleting(x.id);
    const r = await fetch(`/api/tutorial?id=${encodeURIComponent(x.id)}`, {
      method: "DELETE",
    });
    setDeleting("");
    if (r.ok) load();
    else alert((await r.json()).error || "Could not delete tutorial.");
  }
  return (
    <div className="max-w-5xl mx-auto p-10">
      <div className="flex justify-between items-center gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Tutorials</h1>
          <p className="muted mt-1">Stored locally on this device.</p>
        </div>
        <Link className="btn btn-primary" href="/">
          + New Tutorial
        </Link>
      </div>
      <div className="flex gap-3 mt-8">
        <div className="relative max-w-md flex-1">
          <Search size={16} className="absolute left-3 top-3 muted" />
          <input
            className="input pl-9"
            placeholder="Search tutorials…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <select
          className="input max-w-40"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
        </select>
      </div>
      <div className="grid md:grid-cols-2 gap-4 mt-6">
        {ys.length ? (
          ys.map((x) => (
            <div className="card p-5" key={x.id}>
              <div className="font-medium">{x.name}</div>
              <div className="muted text-sm mt-2">
                {x.steps?.length || 0} steps ·{" "}
                {new Date(x.createdAt).toLocaleString()}
              </div>
              <div className="flex gap-2 mt-4">
                <Link className="btn" href={`/tutorial/${x.id}`}>
                  Open
                </Link>
                <button className="btn" onClick={() => rename(x)}>
                  <Pencil size={14} className="inline mr-1" />
                  Rename
                </button>
                <button
                  className="btn btn-danger"
                  disabled={deleting === x.id}
                  onClick={() => del(x)}
                >
                  <Trash2 size={14} className="inline mr-1" />
                  {deleting === x.id ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="card p-10 md:col-span-2 text-center">
            <div className="font-medium">No tutorials yet.</div>
            <div className="muted text-sm mt-1">
              Create your first tutorial by demonstrating a workflow.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
