import {NextResponse} from "next/server";
import {pauseRecording} from "../../../../lib/recorder";
export const runtime="nodejs";
export async function POST(req:Request){try{const {id}=await req.json();return NextResponse.json(await pauseRecording(id));}catch(e:any){return NextResponse.json({error:e.message||"Couldn't pause recording."},{status:500})}}
