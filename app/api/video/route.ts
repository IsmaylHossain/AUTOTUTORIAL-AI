import {NextResponse} from "next/server";
import fs from "fs";
import {get} from "../../../lib/store";
export const runtime="nodejs";
export async function GET(req:Request){
  const id=new URL(req.url).searchParams.get("id")||""; const t=get(id);
  if(!t?.video||!fs.existsSync(t.video)) return new NextResponse("Not found",{status:404});
  const stat=fs.statSync(t.video); const range=req.headers.get("range"); const type="video/mp4";
  if(!range){const stream=fs.createReadStream(t.video); return new Response(stream as any,{headers:{"Content-Type":type,"Content-Length":String(stat.size),"Accept-Ranges":"bytes","Cache-Control":"no-store"}})}
  const m=/bytes=(\d*)-(\d*)/.exec(range); if(!m) return new NextResponse("Invalid range",{status:416});
  const start=m[1]?Number(m[1]):0; const end=m[2]?Math.min(Number(m[2]),stat.size-1):Math.min(start+1024*1024-1,stat.size-1);
  if(start<0||start>=stat.size||end<start) return new NextResponse("Range not satisfiable",{status:416});
  const stream=fs.createReadStream(t.video,{start,end});
  return new Response(stream as any,{status:206,headers:{"Content-Type":type,"Content-Length":String(end-start+1),"Content-Range":`bytes ${start}-${end}/${stat.size}`,"Accept-Ranges":"bytes","Cache-Control":"no-store"}});
}
