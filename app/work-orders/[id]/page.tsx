import {WorkOrderClient} from "@/components/work-order-client";
export default async function Page({params,searchParams}:{params:Promise<{id:string}>,searchParams:Promise<{fixture?:string;play?:string}>}){const [{id},p]=await Promise.all([params,searchParams]);return <WorkOrderClient id={id} fixture={p.fixture==="1"} play={p.play==="1"}/>}
