import {NextResponse} from "next/server";
import {recoverRecording} from "../../../../lib/recorder";
export const runtime="nodejs";
export async function POST(req:Request){try{const {id}=await req.json();const r=recoverRecording(id);return NextResponse.json(r);}catch(e:any){return NextResponse.json({error:e.message||"Couldn't recover recording."},{status:500})}}
