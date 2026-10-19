import {NextResponse} from "next/server";
import {stopRecording} from "../../../../lib/recorder";
export const runtime="nodejs";
export async function POST(req:Request){try{const {id}=await req.json();if(!id)return NextResponse.json({error:"Missing tutorial id"},{status:400});const video=await stopRecording(id);return NextResponse.json({ok:true,id,video});}catch(e:any){return NextResponse.json({error:e.message||"Couldn't stop recording."},{status:500})}}
