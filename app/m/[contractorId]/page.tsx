import {MobileClient} from "@/components/mobile-client";
export default async function Page({params,searchParams}:{params:Promise<{contractorId:string}>,searchParams:Promise<{fixture?:string;job?:string}>}){const [{contractorId},p]=await Promise.all([params,searchParams]);return <MobileClient contractorId={contractorId} fixture={p.fixture==="1"} initialJob={p.job}/>}
