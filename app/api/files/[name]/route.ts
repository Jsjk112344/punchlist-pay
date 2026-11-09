import {promises as fs} from "node:fs";
import {safeUploadPath,mimeForFile} from "@/lib/uploads";
export const runtime="nodejs";
// Serves uploaded proof images by filename only (no paths).
export async function GET(_:Request,{params}:{params:Promise<{name:string}>}){
 const {name}=await params;const file=safeUploadPath(name);
 if(!file)return new Response("Not found",{status:404});
 try{const data=await fs.readFile(file);return new Response(new Uint8Array(data),{headers:{"Content-Type":mimeForFile(name),"Cache-Control":"private, max-age=3600","X-Content-Type-Options":"nosniff"}})}
 catch{return new Response("Not found",{status:404})}
}
