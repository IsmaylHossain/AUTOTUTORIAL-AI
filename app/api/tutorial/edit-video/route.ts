import { NextResponse } from "next/server";
import { editRecording } from "../../../../lib/video-edits";
import { renderActive } from "../../../../lib/render";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    const {id,cuts,recording}=await req.json();
    if(typeof id!=="string" || !/^[\w-]+$/.test(id)) throw new Error("Invalid project ID.");
    if(renderActive(id)) return NextResponse.json({error:"Finish or cancel rendering before editing video."},{status:409});
    return NextResponse.json({ok:true,...await editRecording(id,cuts,recording)});
  } catch(error:any) { return NextResponse.json({error:error.message||"Video edit failed."},{status:400}); }
}
