import {UserRound} from "lucide-react";
export function Avatar({tone=0}:{tone?:0|1|2}){const styles=["bg-[#DBE6EC] text-[#3E6274]","bg-[#EEE5DE] text-[#8F6E58]","bg-[#E6E3ED] text-[#685A85]"];return <span aria-hidden="true" className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${styles[tone]}`}><UserRound size={16}/></span>}
