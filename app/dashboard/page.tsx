import {DashboardClient} from "@/components/dashboard-client";
export default async function Page({searchParams}:{searchParams:Promise<{fixture?:string}>}){const params=await searchParams;return <DashboardClient fixture={params.fixture==="1"}/>}
