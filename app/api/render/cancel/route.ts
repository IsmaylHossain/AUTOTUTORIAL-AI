import {NextResponse} from "next/server";
import {cancelRender} from "../../../../lib/render";
export const runtime="nodejs";
export async function POST(req:Request){const {id}=await req.json(); if(!id)return NextResponse.json({error:"Missing tutorial id"},{status:400}); return NextResponse.json({ok:cancelRender(id)});}
