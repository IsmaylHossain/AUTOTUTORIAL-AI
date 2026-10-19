import {NextResponse} from "next/server";
import {analyze} from "../../../../lib/ai";
import {get,save} from "../../../../lib/store";
export const runtime="nodejs";
export async function POST(req:Request){
  try{const {id}=await req.json(); const t=get(id); if(!t)return NextResponse.json({error:"Not found"},{status:404}); t.status="processing";t.stage="analyzing";t.progress=5;t.message="Retrying AI analysis…";save(t); await analyze(id); return NextResponse.json({ok:true});}
  catch(e:any){return NextResponse.json({error:e.message||"Analysis failed."},{status:500})}
}
