import {NextResponse} from "next/server";
import {resumeRecording} from "../../../../lib/recorder";
export const runtime="nodejs";
export async function POST(req:Request){try{const {id}=await req.json();return NextResponse.json(await resumeRecording(id));}catch(e:any){return NextResponse.json({error:e.message||"Couldn't resume recording."},{status:500})}}
